# Waldegg multiplayer relay

A small authoritative WebSocket server for 2–6 players per room. Each room runs one
`HostCore` (`src/net/HostCore.ts`) – the **same** code the browser runs in-process for
solo play – so rules, validation and world reducers are identical in both modes.

## Run

```bash
npm install                       # ws + tsx are in package.json
npx tsx server/server.ts          # listens on ws://0.0.0.0:8787
PORT=9000 npx tsx server/server.ts
```

Suggested `package.json` scripts:

```json
"server": "tsx server/server.ts",
"server:dev": "tsx watch server/server.ts",
"test:net": "tsx server/selftest.ts",
"typecheck:server": "tsc -p server --noEmit"
```

Then open the game with `?room=CRYPT&name=Anna` (optionally `&server=ws://host:8787`). See
`src/net/INTEGRATION.md`.

### Environment

| variable          | default   | meaning                                                      |
| ----------------- | --------- | ------------------------------------------------------------ |
| `PORT`            | `8787`    | listen port                                                  |
| `HOST`            | `0.0.0.0` | bind address                                                 |
| `SEED`            | `1987`    | world seed for new rooms (unless the creator requests one)  |
| `MAX_ROOMS`       | `200`     | concurrent rooms                                             |
| `RESUME_GRACE_MS` | `20000`   | how long a dropped player's slot is kept for reconnects      |
| `LOG`             | `1`       | `0` = quiet                                                  |

`GET /health` returns JSON with uptime and per-room player counts.

## Behaviour

* Rooms are keyed by code (`A-Z 0-9 _ -`, case-insensitive), created on first join and
  removed when the last player leaves. Max 6 players; the 7th gets `error room_full`
  (close code 4001).
* Clients must send `hello` within 5 s. Protocol version mismatches are rejected (4000).
* Heartbeat: WebSocket ping every 10 s, dead sockets are terminated. Clients also send
  JSON `ping`s every 2 s (latency + clock sync).
* Dropped players keep their slot for `RESUME_GRACE_MS`; the client reconnects with
  backoff and resumes the same id/colour with its token. An orderly `bye` leaves at once.
* Input validation and limits (per connection): finite numbers only, positions/angles
  quantised, max 15 m/s horizontal / 40 m/s vertical between pose samples (except the
  first sample, flagged teleports every ≥ 3 s, and a resync after 2.5 s), token-bucket
  rate limits (poses 30/s, actions 20/s, sounds 8/s, all messages 120/s), 64 KB max frame,
  ≤ 8192 entities per room, ≤ 2 KB per entity state, ≤ 1 KB action payload.
* Pose snapshots are broadcast at 20 Hz, only for players with new samples; each sample
  carries the sender's own timestamp (host clock) for smooth interpolation.

State is in memory only – restarting the server ends all rooms (clients then reconnect
into fresh rooms and re-declare their world defaults).

## Game rules on the server

The default reducers (`door:`, `item:`, `light:`, `note:`, `switch:`) are registered when
`HostCore` is imported. Game-specific rules must live in a DOM-free module that is imported
both by the game and at the top of `server/server.ts`.

## Self-test

```bash
npx tsx server/selftest.ts
```

Runs HostCore in-process (fake clock), the interpolation buffer, solo sessions over the
loopback, the real server on a random port with raw `ws` clients, and full `Session`s over
WebSocket including drop + resume. Prints PASS/FAIL per check; exit code 1 on failure.

## Deploying

Single Node process, no database. For `https` pages put it behind a TLS-terminating proxy
(Caddy/nginx) and connect with `wss://`. Example Caddy: `relay.example.com { reverse_proxy localhost:8787 }`.
