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

The first start prepares all PBR materials in Web Workers (photoscans are packed,
the remaining procedural sets synthesised; 10–40 s depending on CPU and quality). The
procedural part is cached in IndexedDB, later starts are fast.

### Photoscanned assets

`public/assets/` holds CC0 photoscans from [Poly Haven](https://polyhaven.com) (≈40
texture sets for plaster, brick, floors, roof tiles, bark and forest ground, ≈90 props
and furniture). They are already in the repo; to re-download or change them edit
`tools/assets.config.json` and run `npm run assets` (add `--force` to refresh). Without
the folder the game falls back to its procedural materials.

### Controls

| Key | Action |
| --- | --- |
| WASD | walk |
| Shift | run (stamina) |
| C | crouch → crawl (through crawl spaces) |
| F | flashlight |
| E | use / open / unlock / read / pick up |
| Tab | (while reading) German original ↔ English transcript |
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
| `?nophoto` / `?noprops` | procedural materials only / no furniture (comparison, debugging) |

You start next to the group's van on the service road below the estate. Example:
`http://localhost:5173/?quality=medium&cam=4,1.7,4,8,3` starts in the courtyard looking at
the manor.

## What's in the world

You arrive on the service road below the chained estate gate (the way in is a breach in the
wall further east). The estate: the manor (cellars, sealed coal cellar, attic, U-stair with
half landing), the caretaker's house (cellar, crawl space, attic) with woodshed and mailbox,
workshop, barn, pump house with the generator, the service tunnel and coal gallery under the
grounds, the glasshouse, the chapel with crypt, the overgrown cemetery and a hunting stand at
the old pasture. 30+ readable documents tell the story; the manor key hangs on the caretaker's
key board.

## Tech

- TypeScript, Vite, three.js r186 `WebGPURenderer` (WebGPU first, WebGL2 fallback) with TSL node materials
- Rapier (WASM) physics: kinematic character controller, height-field terrain, door bodies
- PBR materials: CC0 photoscans packed into the engine's two-texture layout (albedo/height, normal/roughness/AO) with procedural fallbacks generated in workers; photoscanned GLB props
- Generator-powered lamps: a fixed pool of point lights with static cube shadows follows the nearest working fixtures (flicker, dropouts)
- Post: GTAO, raymarched volumetric fog lit by moon (cascaded shadows) and flashlight, TRAA, bloom, AgX, film grain
- Deterministic world generation from a seed, so every client builds the identical estate
