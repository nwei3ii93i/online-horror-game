# Waldegg

A grounded, photoreal horror exploration world that runs entirely in the browser:
an abandoned estate (manor, caretaker's house, barn, workshop, greenhouse, chapel and
cemetery, cellars and a service tunnel) deep in a Mühlviertel forest at night.
Built for single-player and 2–6 player co-op on the same world code.

**Status: work in progress** – this branch is updated continuously.

## Run locally

Requirements: Node.js 20+ (22 recommended), a current Chrome/Edge (WebGPU) or any
browser with WebGL2 (automatic fallback).

```bash
git clone <this repo>
cd online-horror-game
git checkout claude/admiring-lamport-kqc6vh
npm install
npm run dev
```

Open http://localhost:5173 and click into the window to start.

The first start synthesises all PBR materials procedurally in Web Workers
(10–40 s depending on CPU and quality); the result is cached in IndexedDB, later
starts are fast.

### Controls

| Key | Action |
| --- | --- |
| WASD | walk |
| Shift | run (stamina) |
| C | crouch → crawl (through crawl spaces) |
| F | flashlight |
| E | use / open / unlock |
| Q | lean (peek) |
| Esc | release mouse |

### Useful URL parameters

| Parameter | Effect |
| --- | --- |
| `?quality=low\|medium\|high\|ultra` | quality preset (default high) |
| `?webgl` | force the WebGL2 backend instead of WebGPU |
| `?noclip` | free flight (debug) |
| `?cam=x,y,z,yawDeg,pitchDeg` | start at a camera position (debug / screenshots) |
| `?vol=0&ao=0&taa=0&bloom=0` | toggle individual post effects |
| `?exposure=1.4` | override exposure |

Example: `http://localhost:5173/?quality=medium&cam=4,1.7,4,8,3` starts in the courtyard
looking at the manor.

## Tech

- TypeScript, Vite, three.js r186 `WebGPURenderer` (WebGPU first, WebGL2 fallback) with TSL node materials
- Rapier (WASM) physics: kinematic character controller, height-field terrain, door bodies
- All textures are procedural PBR sets (albedo/height, normal/roughness/AO) generated in workers
- Post: GTAO, raymarched volumetric fog lit by moon (cascaded shadows) and flashlight, TRAA, bloom, AgX, film grain
- Deterministic world generation from a seed, so every client builds the identical estate
