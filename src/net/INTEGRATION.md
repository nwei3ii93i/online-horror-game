# Integrating the session layer (`src/net`)

Solo and multiplayer use **one code path**. The game always talks to a `Session`:

| mode   | factory                                    | authoritative host                                   |
| ------ | ------------------------------------------ | ---------------------------------------------------- |
| solo   | `Session.solo(name, { seed })`             | `HostCore` in-process via `LocalTransport` (offline) |
| online | `Session.connect(url, room, name)`         | the same `HostCore`, inside `server/server.ts`       |

Gameplay never mutates replicated state directly. It calls `session.act(...)` and reacts to
`session.world.subscribe(...)`. In solo the "network" is a zero-latency loopback, so the
optimistic prediction, the host's verdict and the subscribers all behave exactly like online.

```
 Game ──act()/declare()/sendLocalState()/emitSound()──▶ Session ──Transport──▶ HostCore
  ▲                                                       │                     (rules = same reducers)
  └── world.subscribe / on('entity'|'sound'|…) / sampleRemote() ◀── welcome/entity/ack/states/sound
```

## 1. Create the session before building the world (`main.ts`)

The host decides the seed (the room creator's seed online), so build the world from
`session.seed`:

```ts
import { Session } from './net';

const params = new URLSearchParams(location.search);
const name = params.get('name') ?? localStorage.getItem('waldegg.name') ?? 'Wanderer';
const room = params.get('room');                       // ?room=CRYPT → multiplayer
const session = room
  ? await Session.connect(params.get('server') ?? `ws://${location.hostname}:8787`, room, name,
      { seed: Number(params.get('seed') ?? 1987) })    // seed only used if this client creates the room
  : await Session.solo(name, { seed: Number(params.get('seed') ?? 1987) });

const game = new Game(app, settings, { seed: session.seed, automation: params, session });
```

`Session.connect` rejects with a readable `Error` when the server is unreachable, the room
is full (6 players), the room code is invalid or the protocol version differs – show it on
the loading screen and offer solo.

(Pages served over `https://` need `wss://` – put the relay behind a TLS proxy.)

## 2. At load time (`Game.load`)

1. **Declare the default state of every interactive entity** of the seeded world, once the
   world has been built. Every client builds the same world from the seed, so they all
   declare the same defaults; the host keeps the first one and ignores the rest. A late
   joiner already has the live states from the welcome snapshot – `declare` never
   overwrites an existing state.

   ```ts
   session.declareAll({
     'door:manor_front': { open: false, angle: 0, locked: false },
     'door:cellar':      { open: false, angle: 0, locked: true, key: 'cellar_key' },
     'item:cellar_key':  { taken: false, p: [12.3, 0.9, -4.1] },
     'light:hall':       { on: false },
   });
   ```

2. **Subscribe and apply the current state** (subscribers only fire on *changes*, so also
   apply what is already there – important for late joiners and reconnects):

   ```ts
   const applyDoor = (id: string, s?: Readonly<EntityState>) => doors.get(id)?.setTarget(s?.open ? Number(s.angle) : 0, s?.locked === true);
   session.world.subscribe(applyDoor, 'door:');
   for (const [id, s] of session.world.entries()) if (id.startsWith('door:')) applyDoor(id, s);
   ```

3. **Remote players (online only)** – create before the first frame is rendered. It adds a
   fixed pool of 5 SpotLights that is never changed afterwards (changing the light count
   recompiles every node material):

   ```ts
   import { RemotePlayers } from './net';
   import { LAYER_VOLUMETRIC } from './render/PostFX';

   if (session.mode === 'online') {
     this.remotePlayers = new RemotePlayers(scene, {
       // volumetricLayer: LAYER_VOLUMETRIC,   // optional: remote beams in the fog (costs 5 lights in the raymarch)
     });
   }
   ```

   Remote flashlights do not cast shadows (cost), so they can leak through thin walls.

## 3. Every frame (`registerSystems → update`)

```ts
const p = this.player;
session.sendLocalState({                 // rate-limited to 20 Hz internally, only sent on change (1 Hz keep-alive)
  p: p.position,                         // feet position (THREE.Vector3 or [x,y,z])
  vel: p.velocity,
  yaw: p.yaw, pitch: p.pitch,
  stance: p.stance,                      // 'stand' | 'crouch' | 'crawl'
  light: this.flashlight.on,
});
this.remotePlayers?.update(dt, session, session.renderTime(), p.position);
```

`session.renderTime()` is host time minus an adaptive interpolation delay (≥ 100 ms), so
remote players are rendered smoothly between received samples. `session.sampleRemote(id, t)`
gives the interpolated pose for gameplay use (e.g. AI that reacts to other players).

After `player.teleport(...)` send one state with `teleport: true` – the host otherwise
rejects jumps faster than 15 m/s horizontally (40 m/s vertically) and only resyncs after
~2.5 s. (Debug noclip flying at 25 m/s will be rejected online – that is intended.)

## 4. World interactions (gameplay code)

All mutations of replicated state go through `act(entity, op, data?)`:

```ts
// door
const id = `door:${door.id}`;
if (!session.predict(id, 'open')) { sfx.play('door_locked', door.position); return; }  // instant feedback
session.act(id, 'open', { angle: door.angleAwayFrom(player.position) });             // visuals follow via subscribe

// key / item pickup
const ok = await session.act('item:cellar_key', 'take');    // false if someone else was faster
if (ok) inventory.add('cellar_key');

// unlock with an item the player holds
await session.act('door:cellar', 'unlock', { key: 'cellar_key' });

// drop
session.act('item:lantern', 'drop', { p: [x, y, z] });

// one-off replicated "event" without state (e.g. reading a note): accepted, no state change
session.act('note:diary_3', 'read');
```

* `act` applies the predicted result to `session.world` **synchronously** (subscribers fire
  immediately), sends the action and resolves with the host's verdict. On rejection (e.g.
  another player locked the door a moment earlier) the world rolls back to the
  authoritative state and subscribers fire again. Drive visuals from `world.subscribe`, not
  from the promise.
* `session.on('entity', e)` fires for authoritative changes only, with `e.by` = the player
  who caused it (`session.localId` for your own, `'host'` for e.g. items released when their
  holder left). Use it for "Anna opened the cellar door" messages or to play remote sounds
  (`if (e.by !== session.localId) sfx.creak(...)`).
* Built-in rules (`src/net/reducers.ts`):
  * `door:*` `{open, angle, locked, key?}` – `open {angle?}` (rejected while locked), `close`,
    `toggle {angle?}`, `lock {key?}` (only when closed), `unlock {key?}` (`data.key` must match
    `state.key` if the door has one).
  * `item:*` `{taken, by?, p?}` – `take` (first wins), `drop {p}` (holder only); items held by a
    player who leaves are dropped at their last position.
  * `light:*` `{on}` – `on`, `off`, `toggle`;  `switch:*` `{on}` – `toggle` (+ `on`/`off`);
    `note:*` – `read` (no state change).
* Entity ids: `type:name`, `type` = `[a-z][a-z0-9_]*`, name = `[A-Za-z0-9_.:-/#]{1,96}`.
  States are small JSON objects (≤ 2 KB serialised), action `data` ≤ 1 KB.

### Custom rules

Register reducers in a **DOM-free / three-free** module that both the game and the relay
import, otherwise the relay rejects the unknown entity type:

```ts
// src/gameplay/worldRules.ts
import { registerReducer } from '../net/WorldState';
registerReducer('valve:', (cur, op, data, ctx) => {
  const s = { turns: 0, ...cur };
  if (op === 'turn') return { ...s, turns: Math.min(5, Number(s.turns) + 1) };
  return null;                    // null = rejected
});
```

Import it once from `main.ts` *and* add `import '../src/gameplay/worldRules';` to
`server/server.ts`. Reducers must be pure and deterministic (use `ctx.t` / `ctx.playerId`,
never `Math.random()` or `Date.now()`), and must not mutate `cur` (it is frozen).
`registry.get('door:')` returns the existing reducer if you want to wrap/extend it.

## 5. Sounds

Only loud, deliberate noises are replicated (footsteps are not – each client synthesises
remote footsteps from the remote gait if desired):

```ts
session.emitSound('door_slam', door.position, 0.9);                     // others hear it
session.on('sound', (e) => audio.playAt(e.id, e.p, e.v));               // e.by = who made it
```

Max ~8 sounds/s per player; ids match `[A-Za-z0-9_.:-/]{1,48}`.

## 6. Session events / UI

```ts
session.on('playerJoined', (p) => toast(`${p.name} joined`));            // initial roster: session.players
session.on('playerLeft',   (e) => toast(`${e.player.name} left`));
session.on('disconnected', (e) => e.willReconnect ? showReconnecting() : showDisconnected(e.reason));
session.on('reconnected',  () => hideReconnecting());                    // same player id if resumed within 20 s
```

* `session.localId`, `session.self` (`{id, name, color}`), `session.players` (Map of
  `RemotePlayerState` with `info` and `latest` pose), `session.roster()`.
* `session.latency` (RTT ms, 0 in solo), `session.serverNow()` (host clock),
  `session.interpolationDelay`.
* `session.connected` is false while reconnecting; `act()` then resolves `false` and
  `sendLocalState()` is a no-op. On reconnect the world is reloaded from the host's snapshot
  (subscribers fire for every difference).
* `session.close()` on quit (solo: shuts the in-process host down).

## 7. Determinism

Everything not replicated must derive from `session.seed` (terrain, layout, props, ambient
randomness that affects gameplay). Anything that changes during play and must be seen by
everybody is an entity driven through `act`.
