# Audio integration (src/audio)

Everything is synthesised at load time: there are no audio files. The engine runs silently
when Web Audio is missing, blocked or not yet unlocked. No call throws.

## 1. Create and init during loading

```ts
import { AudioEngine, AmbienceDirector, playFootstep, playLanding } from './audio';

this.audio = new AudioEngine({ masterVolume: settings.values.masterVolume });
// Start this early and in parallel with textures and terrain. It renders in Web Workers
// (with a time-sliced main-thread fallback), so the page stays responsive.
const audioP = this.audio.init((p) => loading.set(..., `Synthesising sound (${Math.round(p * 100)}%)`));
await Promise.all([texP, terrainP, physP, audioP]);
this.ambience = new AmbienceDirector(this.audio);
```

`init()` never rejects. It resolves after about 1–2 s and uses about 35–40 MB of AudioBuffers.

## 2. Unlock on the first user gesture

Browsers keep the AudioContext suspended until the user interacts with the page. Call
`audio.resume()` from the click or keydown that starts the game or grabs pointer lock. The
engine also adds its own one-time `pointerdown`/`keydown` listener as a fallback. One-shots
requested while audio is suspended are dropped, so they cannot all fire at once on unlock.
Loops start and are heard once audio resumes.

Settings: call `audio.setMasterVolume(v)`, `audio.setMuted(b)` and
`audio.setBusVolume('ambience' | 'sfx' | 'ui' | 'music', v)` when they change.

## 3. Per frame (in a system `update(dt)`, after the camera has moved)

```ts
const cam = engine.camera;
cam.getWorldDirection(fwd);              // reuse Vector3s
up.set(0, 1, 0).applyQuaternion(cam.quaternion);
audio.setListener(cam.position, fwd, up);
ambience.update(dt, {
  listener: cam.position,
  indoor,                                // 0..1, smoothed (interior map / room volume)
  environment,                           // see table below (loose names like "cellar" also work)
  rain: worldUniforms.rainIntensity.value,
  wind: worldUniforms.windStrength.value,
  time: engine.time,
  isNearTrees,                           // optional: forest density around the player
  stress, exertion,                      // optional 0..1: heartbeat / laboured breathing
});
audio.update(dt);                        // occlusion round-robin, cleanup
```

The director forwards `environment` to `audio.setEnvironment()`, which crossfades the reverb
over 1.5 s. Set `ambience.manageEnvironment = false` to drive the reverb yourself.

| Where the player is                  | environment  |
|--------------------------------------|--------------|
| open meadow, yard, cemetery, roads   | `outdoor`    |
| inside the forest                    | `forest`     |
| ordinary rooms, caretaker house      | `room_small` |
| living or dining rooms, greenhouse   | `room_large` |
| manor entrance hall, stairwell, chapel | `hall`     |
| cellar or basement                   | `basement`   |
| tunnels                              | `tunnel`     |
| barn, workshop                       | `barn`       |
| attic                                | `attic`      |

## 4. Occlusion (optional, recommended)

```ts
const d = new THREE.Vector3();
const mask = groups(GROUP.PLAYER, GROUP.STATIC);          // walls only: not terrain, not props
audio.setOcclusionProvider((from, to) => {
  d.subVectors(to, from);
  const len = d.length();
  if (len < 0.5) return 0;
  d.divideScalar(len);
  const hit = physics.raycast(from, d, len - 0.3, mask);    // 0 = clear … 1 = fully blocked
  if (!hit) return 0;
  // second ray from the source side: thick or multiple walls → stronger occlusion
  const back = physics.raycast(to, d.negate(), len - 0.3, mask);
  return back && len - back.toi - hit.toi > 0.6 ? 0.9 : 0.65;
});
```

The provider is called once when a positional sound starts. After that it is called round-robin
for each active positional voice, about 5 times per second, and the result is smoothed. It is
combined with `PlayOptions.occlusion` and `handle.setOcclusion()` using max().

## 5. Gameplay sounds

```ts
player.onFootstep = (e) => playFootstep(audio, e.surface, e.position, e.intensity, e.stance, wet);
player.onLand = (speed, surface) => playLanding(audio, surface, player.position, speed, wet);
audio.play('door_open_creak', { position: doorPos });
audio.play('flashlight_click');                       // no position = head-locked
const gen = audio.play('generator_loop', { position: genPos, loop: true });
gen.setOcclusion(0.5); gen.setVolume(0.6, 1); gen.stop(2);
ambience.triggerStinger('subtle');                    // rare. Returns false while on cooldown
```

Surface tags: `terrain:<forest|meadow|mud|gravel|asphalt|rock|moss>` (also accepts `_`, `-`, `/`
or the bare layer name), and `wood`, `wood_old`, `stone`, `tile`, `concrete`, `metal`,
`carpet`, `hay`, `glass`, `water`. Pass `wet = worldUniforms.wetness.value > 0.3`.

Every sound has default gain, distance, reverb send and pitch spread (`SOUND_DEFS`). The
`PlayOptions` fields scale or override these defaults. Long loops played without `position`
can use `{ wide: true }` for a decorrelated stereo bed. Multiplayer: play other players'
footsteps with their positions in the same way.
