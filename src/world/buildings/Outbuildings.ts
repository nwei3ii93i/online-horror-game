import * as THREE from 'three/webgpu';
import { BuildingKit, BuildingOutput, KitWall } from '../architecture/BuildingKit';
import { buildSlab, buildStairs, WindowOpts } from '../architecture/Elements';
import { buildRoof, buildGableInfill, RoofInfo } from '../architecture/Roofs';
import { wallFrame, WallFrame, FaceSpec, Opening } from '../architecture/Walls';
import type { MeshBuilder } from '../architecture/MeshBuilder';
import type { Physics } from '../../physics/Physics';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import { RNG } from '../../core/Random';
import {
  V, defineMaterials, TUNNEL_MATS, spanFromInner, leafOpening, pipe, flange, puddle, heap, scatterBlocks,
  pipeRailing, timberRailing, ladderStair, voidEdges, boardRun, hayBale, leaningWheel, cartWheel, wallPatch, drainGrate,
} from './BuildingDetails';

/**
 * Outbuildings of Gut Waldegg (Mühlviertel, Upper Austria):
 *  - workshop / garage (1950s, rendered brick, rusty corrugated roof, timber gate, covered car)
 *  - barn ("Stadl": timber frame on a granite plinth, weathered vertical boards with gaps,
 *    threshing floor, hay loft with ladder-stair, the fourteen diesel cans)
 *  - pump house (1958, rendered, steel doors; basement with pump, pressure vessel, the stopped
 *    but still warm generator, diesel tank; one dim working bulb; the service tunnel ends here)
 *
 * INTEGRATION — nothing calls these yet. Add to the code base like this:
 *
 *   World.build()  (src/world/World.ts), after the manor:
 *     const h = (x: number, z: number) => this.terrain.heightAt(x, z);
 *     this.add(buildWorkshop(this.physics, this.materials, h));
 *     this.add(buildBarn(this.physics, this.materials, h));
 *     this.add(buildPumpHouse(this.physics, this.materials, h));
 *     this.add(buildTunnels(this.physics, this.materials, h));   // from './buildings/Tunnels'
 *   (World.add() already collects doors, lights, rooms and interior spans; applyInteriorMap()
 *    then rasterises the new spans – call order in Game.load() stays as it is.)
 *
 *   Game.load()  (src/Game.ts):
 *     preload:   this.assets.preload([...MANOR_PROP_IDS, ...OUTBUILDING_PROP_IDS, ...VAN_CARGO])
 *     furnish:   placeOutbuildingProps(this.props);              // right after placeManorProps(this.props)
 *     documents: placeDocuments([...MANOR_DOCS, ...OUTBUILDING_DOCS], this.physics, this.interaction, ...)
 *   imports:    OUTBUILDING_PROP_IDS / placeOutbuildingProps from './world/props/OutbuildingProps',
 *               OUTBUILDING_DOCS from './world/story/OutbuildingDocs'.
 *
 * Text decals (signs, stencils, the generator label, the 1993 calendar, numbers on the diesel
 * cans) are NOT drawn here; each has an anchor (see BuildingOutput.anchors, ids below). Anchor
 * `ry` is the yaw that turns a decal's local +Z onto the wall normal (PlaneGeometry: rotation.y = ry).
 *   workshop: 'workshop_sign', 'workshop_bench'
 *   barn:     'barn_diesel_cans', 'barn_hatch'
 *   pumphouse:'pumphouse_sign', 'pumphouse_calendar', 'generator_label'
 */

type HeightFn = (x: number, z: number) => number;
type Side = 's' | 'e' | 'n' | 'w';
type Win = { o: Opening; opts: Partial<WindowOpts> };
type DoorHole = { o: Opening; frame?: string | null; architrave?: boolean };
interface SideOpenings { windows?: Win[]; doors?: DoorHole[]; openings?: Opening[] }
interface Rect4 { X0: number; Z0: number; X1: number; Z1: number }

const DEG = Math.PI / 180;

/** Centre lines of a rectangular shell of thickness T and the "distance along the wall" of each side. */
function shellLines(r: Rect4, T: number) {
  const WX0 = r.X0 + T / 2, WX1 = r.X1 - T / 2, WZ0 = r.Z0 + T / 2, WZ1 = r.Z1 - T / 2;
  return {
    WX0, WX1, WZ0, WZ1,
    ends: {
      s: [[WX0, WZ1], [WX1, WZ1]], e: [[WX1, WZ1], [WX1, WZ0]], n: [[WX1, WZ0], [WX0, WZ0]], w: [[WX0, WZ0], [WX0, WZ1]],
    } as Record<Side, [[number, number], [number, number]]>,
    /** s → distance from the start of that side's wall (walls run clockwise, outside on the right). */
    at: { s: (x: number) => x - WX0, e: (z: number) => WZ1 - z, n: (x: number) => WX1 - x, w: (z: number) => z - WZ0 } as Record<Side, (v: number) => number>,
  };
}

/** Four walls of a rectangle, clockwise seen from above (RIGHT side = outside), both ends extended over the corners. */
function rectShell(kit: BuildingKit, r: Rect4, T: number, y0: number, y1: number, faces: { left: KitWall['left']; right: KitWall['right']; cap: string },
  sides: Partial<Record<Side, SideOpenings>> = {}, extra: Partial<KitWall> = {}): Record<Side, WallFrame> {
  const L = shellLines(r, T);
  const out = {} as Record<Side, WallFrame>;
  for (const k of ['s', 'e', 'n', 'w'] as Side[]) {
    const o = sides[k] ?? {};
    out[k] = kit.wall({
      a: L.ends[k][0], b: L.ends[k][1], y0, y1, t: T, ext0: T / 2, ext1: T / 2,
      left: faces.left, right: faces.right, cap: faces.cap, skirting: false,
      windows: o.windows, doors: o.doors, openings: o.openings, ...extra,
    });
  }
  return out;
}

const winO = (at: number, width: number, bottom: number, top: number, opts: Partial<WindowOpts>): Win =>
  ({ o: { at, width, bottom, top, kind: 'window' }, opts: { exterior: 1, ...opts } });

/** Lowest / highest terrain over a rectangle (sampled every metre plus the corners). */
function groundRange(heightAt: HeightFn, r: Rect4, margin = 0.5): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let x = r.X0 - margin; x <= r.X1 + margin + 1e-6; x += Math.max(0.5, (r.X1 - r.X0 + 2 * margin) / 24)) {
    for (let z = r.Z0 - margin; z <= r.Z1 + margin + 1e-6; z += Math.max(0.5, (r.Z1 - r.Z0 + 2 * margin) / 24)) {
      const h = heightAt(x, z);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
}

/** Downpipe from a gutter end into the wall and down to a shoe at the ground. */
function downpipe(mb: MeshBuilder, gx: number, gy: number, gz: number, wx: number, wz: number, ground: number, mat = 'rust_metal'): void {
  pipe(mb, mat, [V(gx, gy, gz), V(gx, gy - 0.25, gz), V(wx, gy - 0.6, wz), V(wx, ground + 0.32, wz), V(wx + (wx - gx) * 0.0, ground + 0.08, wz + Math.sign(gz - wz) * 0.22)], 0.045, 8);
  for (let y = ground + 0.6; y < gy - 0.8; y += 1.4) {
    mb.box('iron_black', wx, y, wz, 0.12, 0.025, 0.12);
  }
}

/**
 * Rafters (and optionally collar ties) under a pitched roof, kept strictly below the inner
 * roof surface. Rafters run in z from both eave lines to the centre line z = (z0+z1)/2; on hip
 * ends they follow the lower hip planes automatically (innerHeight is evaluated at the centre).
 */
function roofRafters(mb: MeshBuilder, roof: RoofInfo, r: { x0: number; z0: number; x1: number; z1: number }, spacing: number, size: number, mat: string, collars: number | null, eaveY: number): void {
  const cz = (r.z0 + r.z1) / 2;
  let k = 0;
  for (let x = r.x0 + 0.3; x <= r.x1 - 0.3 + 1e-6; x += spacing, k++) {
    const top = roof.innerHeight(x, cz);
    for (const ze of [r.z0, r.z1]) {
      const a = V(x, roof.innerHeight(x, ze) - size * 0.6, ze);
      const b = V(x, top - size * 0.6, cz);
      if (b.y - a.y > 0.2) mb.beam(mat, a, b, size, size * 0.6, V(1, 0, 0));
    }
    if (collars !== null && k % 2 === 0) {
      const y = eaveY + (top - eaveY) * collars;
      const slope = (top - roof.innerHeight(x, r.z0)) / (cz - r.z0);
      if (slope <= 0) continue;
      const d = (top - (y + size * 0.5)) / slope - 0.02;
      if (d > 0.3) mb.box(mat, x, y, cz, size * 0.5, size * 0.8, 2 * d, { uv: 'local' });
    }
  }
}

/** Diagonal hip rafters from the wall-plate corners to the ridge ends of a hip roof. */
function hipRafters(mb: MeshBuilder, roof: RoofInfo, r: { x0: number; z0: number; x1: number; z1: number }, size: number, mat: string): void {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const hd = (r.z1 - r.z0) / 2;
  const rx0 = Math.min(cx, r.x0 + hd), rx1 = Math.max(cx, r.x1 - hd);
  for (const [x, z, rx] of [[r.x0, r.z0, rx0], [r.x0, r.z1, rx0], [r.x1, r.z0, rx1], [r.x1, r.z1, rx1]]) {
    const a = V(x + Math.sign(cx - x) * 0.05, roof.innerHeight(x + Math.sign(cx - x) * 0.05, z + Math.sign(cz - z) * 0.05) - size * 0.7, z + Math.sign(cz - z) * 0.05);
    const b = V(rx, roof.innerHeight(rx, cz) - size * 0.7, cz);
    mb.beam(mat, a, b, size * 0.6, size, V(0, 1, 0));
  }
}

// =============================================================================================
// WORKSHOP / GARAGE
// =============================================================================================

export const WORKSHOP = {
  X0: -33, Z0: -4, X1: -22, Z1: 4,
  FLOOR: 0.05, T: 0.32, EAVE: 3.15,
  PITCH: 22 * DEG, OVERHANG: 0.45,
} as const;

/** Josef's workbench along the west wall (documents and the vice lie on it). */
export const WORKSHOP_BENCH = { x0: WORKSHOP.X0 + WORKSHOP.T + 0.01, x1: WORKSHOP.X0 + WORKSHOP.T + 0.76, z0: -3.15, z1: 0.45, top: WORKSHOP.FLOOR + 0.9 } as const;

/** Big gate in the east gable (car bay). */
export const WORKSHOP_GATE = { zc: 1.55, width: 3.0, height: 2.75 } as const;

export function buildWorkshop(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  const W = WORKSHOP;
  defineMaterials(materials, {
    ws_render: { tex: 'plaster_ext', scale: 4, exterior: true, groundDirt: 1.2, color: '#d4cec0' },
    ws_socle: { tex: 'concrete', scale: 3, exterior: true, groundDirt: 1, mossUp: 0.4, color: '#959189' },
    ws_wall_int: { tex: 'plaster_int', scale: 3, color: '#aea89b' },
    ws_dado: { tex: 'oil_dado', scale: 2, color: '#8b9387' },
    ws_floor: { tex: 'concrete', scale: 3, color: '#8a8680' },
    ws_corr_under: { tex: 'corrugated', scale: 2, color: '#6a645c' },
    ws_gate: { tex: 'painted_wood_green', scale: 1, exterior: true, groundDirt: 1 },
    ws_pegboard: { tex: 'cardboard', scale: 0.8, color: '#8a6e4a', vertexColors: true },
    ws_outline: { color: '#cfcab8', roughness: 0.8 },
    ws_steel: { color: '#5f5e5a', roughness: 0.42, metalness: 0.85 },
    ws_handle_red: { color: '#7a2a20', roughness: 0.45 },
    ws_jar: { color: '#3f4236', roughness: 0.12 },
    oil_stain: { color: '#14120e', roughness: 0.22 },
    exposed_brick: { tex: 'brick', scale: 2.08, exterior: true, groundDirt: 1 },
  });
  const facade: FaceSpec = { mat: 'ws_render', dado: { mat: 'ws_socle', h: 0.3 } };
  const inner: FaceSpec = { mat: 'ws_wall_int', dado: { mat: 'ws_dado', h: 1.25 } };
  const kit = new BuildingKit('workshop', physics, facade);
  const mb = kit.mb;
  const rng = new RNG('workshop');
  const F = W.FLOOR, E = W.EAVE;
  const IX0 = W.X0 + W.T, IX1 = W.X1 - W.T, IZ0 = W.Z0 + W.T, IZ1 = W.Z1 - W.T;
  const g = groundRange(heightAt, W, 1);
  const BASE = Math.min(g.min, F) - 0.45;
  const L = shellLines(W, W.T);

  // ------------------------------------------------------------------ room & floor
  kit.room({ id: 'ws_main', location: 'workshop', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: F, y1: E - 0.2, floor: 'ws_floor', ceiling: null, wall: inner, skirting: null, env: 'room_large', floorSurface: 'concrete' });
  kit.buildRoomSurfaces();

  // ------------------------------------------------------------------ walls
  rectShell(kit, W, W.T, BASE, F, { left: null, right: 'ws_socle', cap: 'ws_socle' }, {}, { noTop: true, surface: 'stone' });
  const gate = WORKSHOP_GATE;
  const gS0 = L.at.e(gate.zc + gate.width / 2), gS1 = L.at.e(gate.zc - gate.width / 2);
  const sideDoorX = -23.5;
  const metalWin = { frameMat: 'painted_metal_ext', sashMat: 'painted_metal_ext', sillIn: null, sillOut: 'painted_metal_ext', muntins: true } as const;
  const walls = rectShell(kit, W, W.T, F, E, { left: inner, right: facade, cap: 'ws_render' }, {
    s: { windows: [
      winO(L.at.s(-27.6), 1.2, 1.05, 2.25, { style: 'single', broken: 0.35, ...metalWin }),
      winO(L.at.s(-24.6), 1.2, 1.05, 2.25, { style: 'single', broken: 0.2, ...metalWin }),
    ] },
    e: {
      doors: [{ o: { at: (gS0 + gS1) / 2, width: gate.width, bottom: 0, top: gate.height, kind: 'hole' }, frame: 'rough_timber' }],
      windows: [winO(L.at.e(-2.4), 0.9, 1.15, 2.15, { style: 'small', broken: 0.5, ...metalWin })],
    },
    n: {
      doors: [{ o: { at: L.at.n(sideDoorX), width: 1.0, bottom: 0, top: 2.1, kind: 'door' }, frame: 'painted_wood_brown' }],
      windows: [
        winO(L.at.n(-29.4), 1.3, 1.15, 2.25, { style: 'single', broken: 0.25, ...metalWin }),
        winO(L.at.n(-26.0), 1.3, 1.15, 2.25, { style: 'single', broken: 0.6, ...metalWin }),
      ],
    },
  }, { noTop: true, surface: 'stone' });

  // gable triangles (rendered brick) and the roof
  const roofDef = { type: 'gable_x' as const, x0: W.X0, z0: W.Z0, x1: W.X1, z1: W.Z1, eaveY: E, pitch: W.PITCH, overhang: W.OVERHANG, thickness: 0.12, tileMat: 'corrugated', innerMat: 'ws_corr_under', fasciaMat: 'painted_wood_brown_ext', ridgeMat: 'rust_metal', gutterMat: 'rust_metal', rafters: null };
  const roof: RoofInfo = buildRoof(mb, roofDef, physics);
  roofRafters(mb, roof, { x0: W.X0, z0: W.Z0, x1: W.X1, z1: W.Z1 }, 1.1, 0.14, 'rough_timber', null, E);
  buildGableInfill(mb, 'z', L.WX1, W.Z0, W.Z1, E, roof.ridgeY, W.T, 'ws_render', 'ws_wall_int', 1);
  buildGableInfill(mb, 'z', L.WX0, W.Z0, W.Z1, E, roof.ridgeY, W.T, 'ws_render', 'ws_wall_int', -1);

  // ------------------------------------------------------------------ doors
  const lining = 0.054;
  const gc = (gS0 + gS1) / 2;
  const gl = leafOpening(gS0 + lining, gc - 0.003, 0, gate.height);
  const gr = leafOpening(gS1 - lining, gc + 0.003, 0, gate.height);
  kit.doorInWall('door:workshop_gate_s', walls.e, gl.o, { style: 'ledged', mat: 'ws_gate', handle: 'none', seed: 21, thickness: 0.05 }, gl.hingeSide, 1, { sound: 'wood' });
  kit.doorInWall('door:workshop_gate_n', walls.e, gr.o, { style: 'ledged', mat: 'ws_gate', handle: 'ring', handleMat: 'iron_black', seed: 22, thickness: 0.05 }, gr.hingeSide, 1, { sound: 'wood', open: 1.45 });
  const sd = L.at.n(sideDoorX);
  const sdl = leafOpening(sd - 0.5 + lining, sd + 0.5 - lining, 0, 2.1);
  kit.doorInWall('door:workshop_side', walls.n, sdl.o, { style: 'ledged', mat: 'painted_wood_brown_ext', handle: 'lever', handleMat: 'iron_black', seed: 23 }, sdl.hingeSide, -1, { sound: 'wood' });

  // ------------------------------------------------------------------ roof structure inside
  const tieX = [-31.0, -28.5, -26.0, -23.5];
  for (const x of tieX) {
    mb.box('rough_timber', x, E - 0.1, 0, 0.14, 0.2, IZ1 - IZ0 + 0.2, { uv: 'local', uvOffset: [x, 0] });
    // king post up to the ridge with two struts
    const top = roof.innerHeight(x, 0) - 0.07;
    mb.box('rough_timber', x, (E + top) / 2, 0, 0.12, top - E, 0.12, { uv: 'local', uvRotate: true });
    for (const s of [-1, 1]) mb.beam('rough_timber', V(x, E + 0.1, s * 0.12), V(x, roof.innerHeight(x, s * 2.0) - 0.08, s * 2.0), 0.08, 0.1, V(1, 0, 0));
  }
  if (physics) physics.addBox({ cx: (W.X0 + W.X1) / 2, cy: E - 0.1, cz: 0, hx: (IX1 - IX0) / 2, hy: 0.1, hz: 0.07, surface: 'wood' });

  // ------------------------------------------------------------------ workbench and pegboard (west wall)
  const B = WORKSHOP_BENCH;
  const bt = B.top;
  mb.withColor([0.85, 0.8, 0.74], () => {
    mb.box('furniture_oak', (B.x0 + B.x1) / 2, bt - 0.03, (B.z0 + B.z1) / 2, B.x1 - B.x0, 0.06, B.z1 - B.z0, { uv: 'local' });
  });
  mb.box('rough_timber', B.x1 - 0.03, bt - 0.12, (B.z0 + B.z1) / 2, 0.04, 0.12, B.z1 - B.z0 - 0.04, { uv: 'local' });
  for (const lx of [B.x0 + 0.06, B.x1 - 0.07]) for (const lz of [B.z0 + 0.06, (B.z0 + B.z1) / 2, B.z1 - 0.06]) {
    mb.box('rough_timber', lx, (F + bt - 0.06) / 2, lz, 0.08, bt - 0.06 - F, 0.08, { uv: 'local', uvRotate: true });
  }
  for (const lz of [B.z0 + 0.06, (B.z0 + B.z1) / 2, B.z1 - 0.06]) mb.box('rough_timber', (B.x0 + B.x1) / 2, F + 0.22, lz, B.x1 - B.x0 - 0.1, 0.06, 0.05, { uv: 'local' });
  for (let k = 0; k < 5; k++) mb.box('rough_timber', B.x0 + 0.1 + k * 0.13, F + 0.265, (B.z0 + B.z1) / 2, 0.12, 0.025, B.z1 - B.z0 - 0.1, { uv: 'local', uvOffset: [k * 0.7, 0] });
  physics?.addBox({ cx: (B.x0 + B.x1) / 2, cy: (F + bt) / 2, cz: (B.z0 + B.z1) / 2, hx: (B.x1 - B.x0) / 2, hy: (bt - F) / 2, hz: (B.z1 - B.z0) / 2, surface: 'wood' });
  // clutter on the bench: tins, a coffee can of nails, a pencil stub (carpenter's pencil)
  mb.cylinder('rust_metal_int', B.x0 + 0.18, bt, 0.15, 0.06, 0.06, 0.13, 10);
  mb.cylinder('rust_metal_int', B.x0 + 0.12, bt, 0.32, 0.045, 0.045, 0.09, 10);
  mb.pushTRS(B.x0 + 0.4, bt + 0.006, -2.15, 0.6);
  mb.box('painted_wood_brown', 0, 0, 0, 0.012, 0.012, 0.17);
  mb.pop();

  // pegboard with Josef's painted tool outlines; the hatchet and one hammer are missing
  const faceX = IX0 + 0.034;
  const pz0 = -3.0, pz1 = 0.3, py0 = 1.08, py1 = 2.38;
  mb.pushTRS(faceX, 0, 0, Math.PI / 2); // local x = −z(world), local z = +x(world) out of the board
  const lx0 = -pz1, lx1 = -pz0;
  mb.box('ws_pegboard', (lx0 + lx1) / 2, (py0 + py1) / 2, -0.004, lx1 - lx0, py1 - py0, 0.008, { uv: 'local' });
  for (const [x, y, w, h] of [[(lx0 + lx1) / 2, py0 - 0.015, lx1 - lx0 + 0.06, 0.03], [(lx0 + lx1) / 2, py1 + 0.015, lx1 - lx0 + 0.06, 0.03], [lx0 - 0.015, (py0 + py1) / 2, 0.03, py1 - py0], [lx1 + 0.015, (py0 + py1) / 2, 0.03, py1 - py0]]) {
    mb.box('furniture_wood', x, y, -0.006, w, h, 0.022, { uv: 'local' });
  }
  for (let x = lx0 + 0.03; x < lx1 - 0.02; x += 0.05) for (let y = py0 + 0.03; y < py1 - 0.02; y += 0.05) {
    mb.quad('black_soot', [x - 0.003, y - 0.003, 0.0005], [x + 0.003, y - 0.003, 0.0005], [x + 0.003, y + 0.003, 0.0005], [x - 0.003, y + 0.003, 0.0005], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const outline = (x: number, y: number, w: number, h: number) => mb.quad('ws_outline', [x - w / 2, y - h / 2, 0.0012], [x + w / 2, y - h / 2, 0.0012], [x + w / 2, y + h / 2, 0.0012], [x - w / 2, y + h / 2, 0.0012], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const pin = (x: number, y: number) => mb.rod('ws_steel', V(x, y, 0), V(x, y + 0.01, 0.05), 0.003, 0.003, 4);
  // hand saw
  outline(2.6, 1.76, 0.72, 0.18);
  mb.box('ws_steel', 2.5, 1.75, 0.008, 0.55, 0.13, 0.002, { uv: 'local' });
  mb.box('furniture_wood', 2.86, 1.77, 0.014, 0.13, 0.12, 0.025, { uv: 'local' });
  pin(2.86, 1.84);
  // missing hatchet: outline only
  outline(2.2, 2.08, 0.05, 0.34);
  outline(2.2, 2.21, 0.16, 0.08);
  // hammers (one missing)
  for (const [x, present] of [[1.95, true], [1.75, false], [1.58, true]] as [number, boolean][]) {
    outline(x, 1.62, 0.035, 0.32);
    outline(x, 1.79, 0.12, 0.05);
    if (!present) continue;
    mb.box('furniture_wood', x, 1.6, 0.016, 0.026, 0.3, 0.02, { uv: 'local' });
    mb.box('ws_steel', x, 1.785, 0.022, 0.11, 0.032, 0.032);
    pin(x - 0.03, 1.76); pin(x + 0.03, 1.76);
  }
  // open-ended spanners
  for (let k = 0; k < 6; k++) {
    const x = 1.3 - k * 0.09, len = 0.3 - k * 0.03;
    outline(x, 2.05 - len / 2, 0.034, len + 0.03);
    mb.box('ws_steel', x, 2.05 - len / 2, 0.007, 0.022, len, 0.006);
    mb.box('ws_steel', x - 0.014, 2.05 + 0.008, 0.007, 0.01, 0.03, 0.006);
    mb.box('ws_steel', x + 0.014, 2.05 + 0.008, 0.007, 0.01, 0.03, 0.006);
    pin(x, 2.075);
  }
  // screwdrivers
  for (let k = 0; k < 5; k++) {
    const x = 0.68 - k * 0.085, len = 0.1 + (k % 3) * 0.05;
    outline(x, 2.1 - len / 2 + 0.03, 0.035, len + 0.13);
    mb.cylinder(k % 2 ? 'ws_handle_red' : 'plastic_bakelite', x, 2.08, 0.022, 0.014, 0.012, 0.1, 8);
    mb.rod('ws_steel', V(x, 2.08, 0.022), V(x, 2.08 - len, 0.022), 0.003, 0.003, 4);
    pin(x, 2.19);
  }
  // pliers
  for (const x of [0.12, -0.04]) {
    outline(x, 1.62, 0.07, 0.22);
    for (const s of [-1, 1]) {
      mb.pushTRS(x, 1.62, 0.008, 0, 1, 1, 1, 0, s * 0.12);
      mb.box('ws_steel', 0, 0, 0, 0.016, 0.21, 0.008);
      mb.box('ws_handle_red', 0, -0.05, 0.002, 0.02, 0.1, 0.012);
      mb.pop();
    }
    pin(x, 1.74);
  }
  // shelf with jars of screws above the board
  mb.box('furniture_wood', (lx0 + lx1) / 2, 2.47, 0.1, lx1 - lx0, 0.025, 0.2, { uv: 'local' });
  for (const x of [lx0 + 0.3, lx1 - 0.3]) mb.box('iron_black', x, 2.42, 0.08, 0.02, 0.1, 0.16);
  for (let k = 0; k < 9; k++) {
    const x = lx0 + 0.2 + k * 0.33 + rng.range(-0.05, 0.05);
    const tin = rng.chance(0.4);
    mb.cylinder(tin ? 'rust_metal_int' : 'ws_jar', x, 2.4825, 0.1 + rng.range(-0.03, 0.03), tin ? 0.05 : 0.045, tin ? 0.05 : 0.045, tin ? 0.11 : 0.13, 10);
    if (!tin) mb.cylinder('rust_metal_int', x, 2.4825 + 0.13, 0.1, 0.047, 0.047, 0.015, 10);
  }
  mb.pop();

  // ------------------------------------------------------------------ fluorescent fittings (dead) and conduit
  for (const [x, z] of [[-28.5, -0.6], [-23.5, 1.0]]) {
    mb.box('painted_metal', x, E - 0.225, z, 0.09, 0.05, 1.25);
    mb.rod('porcelain', V(x, E - 0.265, z - 0.6), V(x, E - 0.265, z + 0.6), 0.014, 0.014, 8);
    kit.light({ id: `light:workshop_tube_${x < -25 ? 'w' : 'e'}`, position: V(x, E - 0.3, z), kind: 'tube', working: false, flicker: 0, room: 'ws_main' });
  }
  const cz = IZ0 + 0.018;
  pipe(mb, 'painted_metal', [V(-24.6, F + 1.4, cz), V(-24.6, E - 0.33, cz), V(-23.5, E - 0.33, cz), V(-23.5, E - 0.215, IZ0 + 0.1), V(-23.5, E - 0.215, 0.4)], 0.011, 6);
  pipe(mb, 'painted_metal', [V(-24.6, E - 0.33, cz), V(-28.5, E - 0.33, cz), V(-28.5, E - 0.215, IZ0 + 0.1), V(-28.5, E - 0.215, -1.2)], 0.011, 6);
  mb.box('painted_metal', -22.75, F + 1.3, IZ0 + 0.03, 0.08, 0.12, 0.06);
  pipe(mb, 'painted_metal', [V(-22.75, F + 1.36, cz), V(-22.75, E - 0.33, cz), V(-23.5, E - 0.33, cz)], 0.011, 6);

  // ------------------------------------------------------------------ floor details
  drainGrate(mb, -27.2, F, -1.2);
  for (const [x, z, rx, rz] of [[-27.0, 1.6, 0.6, 0.35], [-25.2, 1.2, 0.3, 0.25], [-31.6, -1.6, 0.25, 0.4], [-27.25, -1.15, 0.32, 0.24], [-23.0, 2.2, 0.22, 0.3]]) {
    puddle(mb, 'oil_stain', x, z, F + 0.002, rx, rz, rng);
  }

  // ------------------------------------------------------------------ exterior
  // concrete apron in front of the gate and a step at the side door
  const apronTop = F - 0.012;
  const ge = heightAt(-21.0, gate.zc);
  mb.box('ws_socle', -22.0 + 0.8, (apronTop + Math.min(ge, F) - 0.25) / 2, gate.zc, 1.6, apronTop - (Math.min(ge, F) - 0.25), gate.width + 0.5, { skip: ['ny', 'nx'] });
  physics?.addBox({ cx: -21.2, cy: apronTop - 0.15, cz: gate.zc, hx: 0.8, hy: 0.15, hz: (gate.width + 0.5) / 2, surface: 'concrete' });
  const se = heightAt(sideDoorX, -4.4);
  mb.box('ws_socle', sideDoorX, (apronTop + se - 0.2) / 2, -4.0 - 0.25, 1.2, apronTop - se + 0.2, 0.5, { skip: ['ny', 'pz'] });
  physics?.addBox({ cx: sideDoorX, cy: apronTop - 0.1, cz: -4.25, hx: 0.6, hy: 0.1, hz: 0.25, surface: 'concrete' });
  // painted sign over the gate (text is a decal at anchor 'workshop_sign')
  mb.box('painted_wood_white_ext', W.X1 + 0.013, E - 0.1, gate.zc, 0.025, 0.34, 1.6, { uv: 'local' });
  for (const z of [gate.zc - 0.7, gate.zc + 0.7]) mb.box('iron_black', W.X1 + 0.03, E - 0.1, z, 0.012, 0.012, 0.012);
  kit.anchor('workshop_sign', W.X1 + 0.027, E - 0.1, gate.zc, Math.PI / 2);
  // enamel lamp over the gate (dead)
  mb.beam('iron_black', V(W.X1, E + 0.25, gate.zc), V(W.X1 + 0.45, E + 0.15, gate.zc), 0.025, 0.025);
  mb.pushTRS(W.X1 + 0.47, E - 0.02, gate.zc);
  mb.lathe('painted_metal_ext', [[0.17, 0], [0.16, 0.015], [0.09, 0.08], [0.03, 0.12]], 16);
  mb.pop();
  // render fallen off in places
  for (const [x, y, z, nx, nz, w, h] of [[-30.5, 0.9, W.Z1 + 0.004, 0, 1, 0.35, 0.22], [-25.6, 2.6, W.Z1 + 0.004, 0, 1, 0.25, 0.15], [-31.2, 1.6, W.Z0 - 0.004, 0, -1, 0.45, 0.3], [W.X0 - 0.004, 1.2, 1.8, -1, 0, 0.5, 0.35], [W.X0 - 0.004, 2.5, -2.2, -1, 0, 0.3, 0.2], [W.X1 + 0.004, 0.75, -1.2, 1, 0, 0.3, 0.2]]) {
    wallPatch(mb, 'exposed_brick', V(x, y, z), V(nx, 0, nz), w, h, rng);
  }
  // downpipes (gutters run along the north and south eaves)
  const tan = Math.tan(W.PITCH), vT = 0.12 / Math.cos(W.PITCH);
  const gy = E - W.OVERHANG * tan - vT - 0.02;
  downpipe(mb, W.X1 + W.OVERHANG - 0.15, gy, W.Z1 + W.OVERHANG + 0.09, W.X1 - 0.18, W.Z1 + 0.06, heightAt(W.X1 - 0.18, W.Z1 + 0.2));
  downpipe(mb, W.X0 - W.OVERHANG + 0.15, gy, W.Z0 - W.OVERHANG - 0.09, W.X0 + 0.18, W.Z0 - 0.06, heightAt(W.X0 + 0.18, W.Z0 - 0.2));

  // ------------------------------------------------------------------ spans & anchors
  kit.span(spanFromInner(IX0, IZ0, IX1, IZ1, F - 0.1, (x, z) => roof.innerHeight(x, z)));
  kit.anchor('workshop_bench', (B.x0 + B.x1) / 2, bt, (B.z0 + B.z1) / 2, Math.PI / 2, 'ws_main');

  void rng;
  const group = mb.build(materials, { name: 'workshop' });
  return kit.output(group);
}

// =============================================================================================
// BARN (Stadl)
// =============================================================================================

export const BARN = {
  X0: -55, Z0: -49, X1: -31, Z1: -36,
  FLOOR: 0.1, PLINTH: 0.85, PLATE: 6.15, LOFT: 3.3,
  PITCH: 45 * DEG, OVERHANG: 0.7,
  /** Threshing floor (Tenne) between the bay frames at x = −39 / −35, doors in the south wall. */
  TENNE_X0: -38.9, TENNE_X1: -35.1,
} as const;

export function buildBarn(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  const Bn = BARN;
  defineMaterials(materials, {
    barn_earth: { tex: 'mud', scale: 3, color: '#7a7163', roughness: 1 },
    barn_tenne: { tex: 'floor_boards_dark', scale: 2, color: '#958b80' },
    barn_loft: { tex: 'floor_boards', scale: 2, color: '#8c8070' },
    hay_int: { tex: 'hay', scale: 1 },
    twine: { color: '#8a7a50', roughness: 0.9 },
    rope: { color: '#6e6250', roughness: 0.95 },
  });
  const kit = new BuildingKit('barn', physics, { mat: 'stone_wall' });
  const mb = kit.mb;
  const rng = new RNG('barn');
  const F = Bn.FLOOR, PL = Bn.PLINTH, PT = Bn.PLATE, LO = Bn.LOFT;
  const g = groundRange(heightAt, Bn, 1);
  const BASE = Math.min(g.min, F) - 0.45;

  // plinth: 0.5 m granite, outer face 3 cm outside the footprint line (keeps it outdoors in the interior map)
  const PO = 0.03, PTk = 0.5;
  const P = { X0: Bn.X0 - PO, Z0: Bn.Z0 - PO, X1: Bn.X1 + PO, Z1: Bn.Z1 + PO };
  const BIX0 = P.X0 + PTk, BIX1 = P.X1 - PTk, BIZ0 = P.Z0 + PTk, BIZ1 = P.Z1 - PTk;
  const PL_ = shellLines(P, PTk);
  const tx0 = Bn.TENNE_X0, tx1 = Bn.TENNE_X1;
  const westDoor = { z0: -44.55, z1: -43.45, h: 2.1 };

  // ------------------------------------------------------------------ rooms & floors
  const loftY1 = 12;
  kit.room({ id: 'barn_west', location: 'barn', x0: BIX0, z0: BIZ0, x1: tx0, z1: BIZ1, y0: F, y1: LO - 0.45, floor: 'barn_earth', ceiling: null, wall: 'stone_wall_int', skirting: null, env: 'barn', floorSurface: 'gravel' });
  kit.room({ id: 'barn_tenne', location: 'barn', x0: tx0, z0: BIZ0, x1: tx1, z1: BIZ1, y0: F, y1: loftY1, floor: 'barn_tenne', ceiling: null, wall: 'stone_wall_int', skirting: null, env: 'barn', floorSurface: 'wood_old' });
  kit.room({ id: 'barn_east', location: 'barn', x0: tx1, z0: BIZ0, x1: BIX1, z1: BIZ1, y0: F, y1: LO - 0.45, floor: 'barn_earth', ceiling: null, wall: 'stone_wall_int', skirting: null, env: 'barn', floorSurface: 'gravel' });
  kit.room({ id: 'barn_loft_w', location: 'barn', x0: Bn.X0, z0: Bn.Z0, x1: tx0, z1: Bn.Z1, y0: LO, y1: loftY1, floor: null, ceiling: null, wall: 'barn_boards_int', skirting: null, env: 'barn', floorSurface: 'wood_old' });
  kit.room({ id: 'barn_loft_e', location: 'barn', x0: tx1, z0: Bn.Z0, x1: Bn.X1, z1: Bn.Z1, y0: LO, y1: loftY1, floor: null, ceiling: null, wall: 'barn_boards_int', skirting: null, env: 'barn', floorSurface: 'wood_old' });
  kit.buildRoomSurfaces();

  // ------------------------------------------------------------------ granite plinth
  rectShell(kit, P, PTk, BASE, PL, { left: 'stone_wall_int', right: 'stone_wall', cap: 'stone_wall' }, {
    s: { openings: [{ at: PL_.at.s((tx0 + tx1) / 2 ), width: tx1 - tx0 - 0.2, bottom: F - BASE, top: PL - BASE, kind: 'hole' }] },
    w: { openings: [{ at: PL_.at.w((westDoor.z0 + westDoor.z1) / 2), width: westDoor.z1 - westDoor.z0, bottom: F - BASE, top: PL - BASE, kind: 'hole' }] },
  }, { surface: 'stone' });
  for (const [x, z] of [[P.X0, P.Z0], [P.X1, P.Z0], [P.X0, P.Z1], [P.X1, P.Z1]]) {
    const cx = x + Math.sign((Bn.X0 + Bn.X1) / 2 - x) * (PTk / 2), czz = z + Math.sign((Bn.Z0 + Bn.Z1) / 2 - z) * (PTk / 2);
    mb.box('stone_wall', cx, PL - 0.17, czz, PTk + 0.04, 0.36, PTk + 0.04, { uv: 'local', uvOffset: [x, z] });
  }

  // ------------------------------------------------------------------ roof
  const roof = buildRoof(mb, { type: 'gable_x', x0: Bn.X0, z0: Bn.Z0, x1: Bn.X1, z1: Bn.Z1, eaveY: PT, pitch: Bn.PITCH, overhang: Bn.OVERHANG, thickness: 0.24, tileMat: 'roof_tiles', innerMat: 'rough_timber', fasciaMat: 'rough_timber_ext', gutterMat: 'rust_metal', rafters: null }, physics);
  roofRafters(mb, roof, { x0: Bn.X0, z0: Bn.Z0, x1: Bn.X1, z1: Bn.Z1 }, 1.0, 0.16, 'rough_timber', 0.72, PT);
  const vT = 0.24 / Math.cos(Bn.PITCH);

  // ------------------------------------------------------------------ timber frame
  const FO = 0.012, POST = 0.2;
  const fo = -(FO + POST / 2); // frame centre offset (outward positive)
  const T = 'rough_timber';
  const sillTop = PL + 0.18;
  // posts along each wall (world coordinate along the wall)
  const postsS = [-54.888, -53, -51, -49, -47, -45, -43, -41, tx0, tx1, -33, -31.112];
  const postsN = [-54.888, -53, -51, -49, -47, -45, -43, -41, -39, -37, -35, -33, -31.112];
  const postsW = [-48.888, -46.75, westDoor.z0 - 0.1, westDoor.z1 + 0.1, -41.0, -38.5, -36.112];
  const postsE = [-48.888, -46.6, -44.4, -43.2, -41.8, -39.5, -37.8, -36.112];
  const zS = Bn.Z1 + fo, zN = Bn.Z0 - fo, xW = Bn.X0 - fo, xE = Bn.X1 + fo;
  const post = (x: number, z: number, y0 = sillTop, y1 = PT - 0.2) => mb.box(T, x, (y0 + y1) / 2, z, POST, y1 - y0, POST, { uv: 'local', uvRotate: true, uvOffset: [x * 0.37, z * 0.21] });
  for (const x of postsS) post(x, zS);
  for (const x of postsN) post(x, zN);
  for (const z of postsW) post(xW, z);
  for (const z of postsE) post(xE, z);
  // sill beams (interrupted at the door openings), plates
  const beamX = (x0: number, x1: number, z: number, yc: number, h: number, d = POST) => mb.box(T, (x0 + x1) / 2, yc, z, x1 - x0, h, d, { uv: 'local', uvOffset: [z, yc] });
  const beamZ = (z0: number, z1: number, x: number, yc: number, h: number, d = POST) => mb.box(T, x, yc, (z0 + z1) / 2, d, h, z1 - z0, { uv: 'local', uvOffset: [x, yc] });
  beamX(Bn.X0 + 0.012, tx0 - 0.1, zS, PL + 0.09, 0.18); beamX(tx1 + 0.1, Bn.X1 - 0.012, zS, PL + 0.09, 0.18);
  beamX(Bn.X0 + 0.012, Bn.X1 - 0.012, zN, PL + 0.09, 0.18);
  beamZ(Bn.Z0 + 0.212, westDoor.z0 - 0.2, xW, PL + 0.09, 0.18); beamZ(westDoor.z1 + 0.2, Bn.Z1 - 0.212, xW, PL + 0.09, 0.18);
  beamZ(Bn.Z0 + 0.212, Bn.Z1 - 0.212, xE, PL + 0.09, 0.18);
  beamX(Bn.X0 + 0.012, Bn.X1 - 0.012, zS, PT - 0.1, 0.2); beamX(Bn.X0 + 0.012, Bn.X1 - 0.012, zN, PT - 0.1, 0.2);
  beamZ(Bn.Z0 + 0.212, Bn.Z1 - 0.212, xW, PT - 0.1, 0.2); beamZ(Bn.Z0 + 0.212, Bn.Z1 - 0.212, xE, PT - 0.1, 0.2);
  // rails between posts (loft girt on the long walls carries the tie beams), door headers
  const tenneHead = F + 4.02;
  const railsBetween = (pts: number[], fixed: number, alongX: boolean, ys: number[], skip: (a: number, b: number, y: number) => boolean) => {
    const s = pts.slice().sort((p, q) => p - q);
    for (let i = 0; i < s.length - 1; i++) for (const y of ys) {
      const a = s[i] + POST / 2, b = s[i + 1] - POST / 2;
      if (b - a < 0.05 || skip(a, b, y)) continue;
      if (alongX) mb.box(T, (a + b) / 2, y, fixed - Math.sign(fixed - (Bn.Z0 + Bn.Z1) / 2) * 0.02, b - a, y > 2.6 && y < 3.2 ? 0.21 : 0.14, 0.14, { uv: 'local', uvOffset: [a, y] });
      else mb.box(T, fixed - Math.sign(fixed - (Bn.X0 + Bn.X1) / 2) * 0.02, y, (a + b) / 2, 0.14, 0.14, b - a, { uv: 'local', uvOffset: [a, y] });
    }
  };
  railsBetween(postsS, zS, true, [LO - 0.335, 4.75], (a, b, y) => a >= tx0 - 0.2 && b <= tx1 + 0.2 && y < tenneHead + 0.4);
  railsBetween(postsN, zN, true, [LO - 0.335, 4.75], () => false);
  railsBetween(postsW, xW, false, [2.35, 4.6], (a, b, y) => a >= westDoor.z0 - 0.25 && b <= westDoor.z1 + 0.25 && y < 2.5);
  railsBetween(postsE, xE, false, [2.35, 4.6], (a, b, y) => a >= -43.2 && b <= -41.8 && y > 3.3 && y < 5.0);
  beamX(tx0 + 0.1, tx1 - 0.1, zS, tenneHead + 0.1, 0.2);                       // Tenne door header
  beamZ(westDoor.z0 - 0.0, westDoor.z1 + 0.0, xW, F + westDoor.h + 0.09, 0.16);  // west door header
  beamZ(-43.1, -41.9, xE, F + 3.4, 0.14); beamZ(-43.1, -41.9, xE, F + 4.86, 0.14); // hay hatch frame
  // braces at corners and door posts
  const brace = (x0: number, z0: number, x1: number, z1: number) => mb.beam(T, V(x0, PT - 1.35, z0), V(x1, PT - 0.2, z1), 0.12, 0.12);
  brace(-54.888, zS, -53.75, zS); brace(-31.112, zS, -32.25, zS); brace(-54.888, zN, -53.75, zN); brace(-31.112, zN, -32.25, zN);
  brace(tx0, zS, tx0 + 0.9, zS); brace(tx1, zS, tx1 - 0.9, zS);
  brace(xW, -48.888, xW, -47.75); brace(xW, -36.112, xW, -37.25); brace(xE, -48.888, xE, -47.75); brace(xE, -36.112, xE, -37.25);
  // gable studs up to the rafters
  for (const [x, zs] of [[xW, postsW], [xE, postsE]] as [number, number[]][]) for (const z of zs) {
    if (Math.abs(z - Bn.Z0) < 0.3 || Math.abs(z - Bn.Z1) < 0.3) continue;
    const top = roof.innerHeight(x, z) - 0.1;
    if (top - PT < 0.3) continue;
    mb.box(T, x, (PT + top) / 2, z, POST * 0.8, top - PT, POST * 0.8, { uv: 'local', uvRotate: true });
  }

  // ------------------------------------------------------------------ bay frames, loft, purlins
  const bays = [-51, -47, -43, -39, -35];
  const tieBot = LO - 0.44, tieTop = LO - 0.23;
  for (const x of bays) {
    // tie beam across the barn at loft level, centre post on a stone footing
    mb.box(T, x, (tieBot + tieTop) / 2, (Bn.Z0 + Bn.Z1) / 2, 0.22, tieTop - tieBot, Bn.Z1 - Bn.Z0 - 0.04, { uv: 'local', uvOffset: [x, 0] });
    mb.box('stone_slab', x, F + 0.06, -42.5, 0.34, 0.12, 0.34);
    post(x, -42.5, F + 0.12, tieBot);
    physics?.addBox({ cx: x, cy: (F + tieBot) / 2, cz: -42.5, hx: 0.12, hy: (tieBot - F) / 2, hz: 0.12, surface: 'wood' });
    // purlin posts standing on the tie beam
    for (const z of [-46.0, -39.0]) {
      const top = roof.innerHeight(x, z) - 0.16 - 0.24;
      mb.box(T, x, (tieTop + top) / 2, z, 0.18, top - tieTop, 0.18, { uv: 'local', uvRotate: true });
      mb.beam(T, V(x, top - 0.9, z + Math.sign(z + 42.5) * 0.9 * 0 + 0.0), V(x + 0.8, top, z), 0.1, 0.1);
      physics?.addBox({ cx: x, cy: (tieTop + top) / 2, cz: z, hx: 0.09, hy: (top - tieTop) / 2, hz: 0.09, surface: 'wood' });
    }
  }
  for (const z of [-46.0, -39.0]) {
    const top = roof.innerHeight(-43, z) - 0.16;
    mb.box(T, (Bn.X0 + Bn.X1) / 2, top - 0.12, z, Bn.X1 - Bn.X0 - 0.3, 0.24, 0.2, { uv: 'local', uvOffset: [z, 0] });
  }
  // loft joists (along x, resting on the tie beams), floor boards, fascia at the Tenne edges
  const lofts: [number, number][] = [[Bn.X0 + 0.212, tx0 + 0.01], [tx1 - 0.01, Bn.X1 - 0.212]];
  for (const [x0, x1] of lofts) {
    for (let z = Bn.Z0 + 0.6; z <= Bn.Z1 - 0.55; z += 0.75) mb.box(T, (x0 + x1) / 2, tieTop + 0.1, z, x1 - x0, 0.2, 0.12, { uv: 'local', uvOffset: [z, 0] });
    buildSlab(mb, x0, Bn.Z0 + 0.212, x1, Bn.Z1 - 0.212, LO, 0.03, 'barn_loft', 'barn_loft', undefined);
    physics?.addBox({ cx: (x0 + x1) / 2, cy: LO - 0.1, cz: (Bn.Z0 + Bn.Z1) / 2, hx: (x1 - x0) / 2, hy: 0.1, hz: (Bn.Z1 - Bn.Z0 - 0.424) / 2, surface: 'wood_old' });
  }
  for (const x of [tx0 + 0.02, tx1 - 0.02]) mb.box(T, x, LO - 0.14, (Bn.Z0 + Bn.Z1) / 2, 0.04, 0.28, Bn.Z1 - Bn.Z0 - 0.424, { uv: 'local' });
  // railings at the loft edges (gap where the ladder arrives)
  const ladderZ = -47.3;
  timberRailing(mb, physics, [[tx0 + 0.05, Bn.Z0 + 0.3], [tx0 + 0.05, ladderZ - 0.45]], LO, T);
  timberRailing(mb, physics, [[tx0 + 0.05, ladderZ + 0.45], [tx0 + 0.05, Bn.Z1 - 0.3]], LO, T);
  timberRailing(mb, physics, [[tx1 - 0.05, Bn.Z0 + 0.3], [tx1 - 0.05, Bn.Z1 - 0.3]], LO, T);
  // ladder-stair from the threshing floor to the west loft (46°)
  const lRise = LO - F, lSteps = 14, lRun = 0.22;
  ladderStair(mb, physics, { x: tx0 + 0.01 + lSteps * lRun, z: ladderZ, y: F, dir: Math.PI / 2, width: 0.62, rise: lRise, steps: lSteps, run: lRun, mat: T, rail: 'left', surface: 'wood_old' });

  // ------------------------------------------------------------------ board cladding (gaps let light through)
  const gableTop = (x: number) => (s: number, zAt: (s: number) => number) => roof.innerHeight(x, zAt(s)) + vT * 0.55;
  const boardsCommon = { outMat: 'barn_boards', inMat: 'barn_boards_int', rng, missing: 0.02 };
  boardRun(mb, { ...boardsCommon, a: [Bn.X0, Bn.Z1], b: [Bn.X1, Bn.Z1], y0: PL, top: () => PT - 0.08, openings: [{ s0: tx0 + 0.1 - Bn.X0, s1: tx1 - 0.1 - Bn.X0, y0: 0, y1: tenneHead + 0.2 }] });
  boardRun(mb, { ...boardsCommon, a: [Bn.X1, Bn.Z0], b: [Bn.X0, Bn.Z0], y0: PL, top: () => PT - 0.08 });
  const gW = gableTop(Bn.X0), gE = gableTop(Bn.X1);
  boardRun(mb, { ...boardsCommon, a: [Bn.X0, Bn.Z0], b: [Bn.X0, Bn.Z1], y0: PL, top: (s) => gW(s, (q) => Bn.Z0 + q), openings: [{ s0: westDoor.z0 - Bn.Z0, s1: westDoor.z1 - Bn.Z0, y0: 0, y1: F + westDoor.h + 0.17 }] });
  boardRun(mb, { ...boardsCommon, a: [Bn.X1, Bn.Z1], b: [Bn.X1, Bn.Z0], y0: PL, top: (s) => gE(s, (q) => Bn.Z1 - q), openings: [{ s0: Bn.Z1 - (-41.9), s1: Bn.Z1 - (-43.1), y0: F + 3.47, y1: F + 4.79 }] });
  if (physics) {
    const wallBox = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) => physics.addBox({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: Math.max(0.05, (x1 - x0) / 2), hy: (y1 - y0) / 2, hz: Math.max(0.05, (z1 - z0) / 2), surface: 'wood' });
    wallBox(Bn.X0, Bn.Z1 - 0.1, tx0, Bn.Z1, PL, PT); wallBox(tx1, Bn.Z1 - 0.1, Bn.X1, Bn.Z1, PL, PT); wallBox(tx0, Bn.Z1 - 0.1, tx1, Bn.Z1, tenneHead, PT);
    wallBox(Bn.X0, Bn.Z0, Bn.X1, Bn.Z0 + 0.1, PL, PT);
    wallBox(Bn.X0, Bn.Z0, Bn.X0 + 0.1, westDoor.z0, PL, PT); wallBox(Bn.X0, westDoor.z1, Bn.X0 + 0.1, Bn.Z1, PL, PT); wallBox(Bn.X0, westDoor.z0, Bn.X0 + 0.1, westDoor.z1, F + westDoor.h, PT);
    wallBox(Bn.X1 - 0.1, Bn.Z0, Bn.X1, Bn.Z1, PL, PT);
  }

  // ------------------------------------------------------------------ doors
  const fS = wallFrame({ a: [Bn.X0, Bn.Z1], b: [Bn.X1, Bn.Z1], y0: F, y1: F + 4.3, t: 0.156 });
  const tc = (tx0 + tx1) / 2 - Bn.X0;
  const dl = leafOpening(tx0 + 0.05 - Bn.X0, tc - 0.003, 0, 4.035);
  const dr = leafOpening(tx1 - 0.05 - Bn.X0, tc + 0.003, 0, 4.035);
  const barnLeaf = { style: 'ledged' as const, mat: 'barn_boards', handle: 'ring' as const, handleMat: 'iron_black', thickness: 0.05 };
  kit.doorInWall('door:barn_gate_w', fS, dl.o, { ...barnLeaf, seed: 31 }, dl.hingeSide, 1, { sound: 'wood' });
  kit.doorInWall('door:barn_gate_e', fS, dr.o, { ...barnLeaf, seed: 32 }, dr.hingeSide, 1, { sound: 'wood', open: 1.25 });
  const fW = wallFrame({ a: [Bn.X0, Bn.Z0], b: [Bn.X0, Bn.Z1], y0: F, y1: F + 2.4, t: 0.156 });
  const wd = leafOpening(westDoor.z1 + 0.05 - Bn.Z0, westDoor.z0 - 0.05 - Bn.Z0, 0, westDoor.h + 0.035);
  kit.doorInWall('door:barn_west', fW, wd.o, { style: 'ledged', mat: 'barn_boards', handle: 'ring', handleMat: 'iron_black', seed: 33 }, wd.hingeSide, 1, { sound: 'wood', open: 0.5 });
  // hay hatch in the east gable, hanging open (static)
  mb.pushTRS(Bn.X1 + 0.03, F + 3.48, -43.1, Math.PI / 2 - 1.9);
  for (let k = 0; k < 6; k++) mb.box('barn_boards', 0.1 + k * 0.2, 0.65, 0, 0.19, 1.3, 0.03, { uv: 'local', uvRotate: true, uvOffset: [k * 0.25, 0] });
  for (const y of [0.2, 1.1]) mb.box('barn_boards', 0.6, y, -0.03, 1.15, 0.12, 0.03, { uv: 'local' });
  mb.pop();
  kit.anchor('barn_hatch', Bn.X1 + 0.03, F + 4.1, -42.5, Math.PI / 2);
  // hoist beam with pulley and rope above the hatch
  const hoistY = roof.innerHeight(Bn.X1, -42.5) - 0.5;
  mb.box(T, Bn.X1 + 0.3, hoistY, -42.5, 1.3, 0.2, 0.18, { uv: 'local' });
  mb.pushTRS(Bn.X1 + 0.8, hoistY - 0.2, -42.5, Math.PI / 2);
  mb.rod('rust_metal', V(0, 0, -0.03), V(0, 0, 0.03), 0.11, 0.11, 14);
  mb.pop();
  mb.rod('rope', V(Bn.X1 + 0.69, hoistY - 0.2, -42.5), V(Bn.X1 + 0.7, F + 2.6, -42.48), 0.012, 0.012, 5);
  mb.rod('rope', V(Bn.X1 + 0.91, hoistY - 0.2, -42.5), V(Bn.X1 + 0.9, F + 4.2, -42.52), 0.012, 0.012, 5);

  // ------------------------------------------------------------------ hay
  const bales = new RNG('barn-bales');
  for (let x = Bn.X0 + 0.75; x < -41.6; x += 0.95) for (let row = 0; row < 3; row++) for (let layer = 0; layer < 3; layer++) {
    if (layer === 2 && bales.chance(0.35)) continue;
    if (row === 2 && bales.chance(0.25)) continue;
    hayBale(mb, 'hay_int', 'twine', x + bales.range(-0.03, 0.03), LO + layer * 0.37, Bn.Z0 + 0.55 + row * 0.5, 0, bales);
  }
  if (physics) physics.addBox({ cx: (Bn.X0 + 0.3 + -41.6) / 2, cy: LO + 0.55, cz: Bn.Z0 + 0.95, hx: (-41.6 - Bn.X0 - 0.3) / 2, hy: 0.55, hz: 0.75, surface: 'hay' });
  for (const [x, z, rx, rz, h] of [[-46.5, -41.0, 1.8, 1.4, 0.7], [-51.5, -40.5, 1.4, 1.6, 0.9], [-33.2, -38.5, 1.1, 0.9, 0.55]] as number[][]) heap(mb, 'hay_int', x, LO, z, rx, rz, h, bales, 14, 4);
  heap(mb, 'hay_int', -37.2, F, -46.3, 0.9, 0.7, 0.35, bales, 12, 3);
  for (let i = 0; i < 4; i++) hayBale(mb, 'hay_int', 'twine', -34.2 + i * 0.95, LO, -48.4, 0, bales);
  hayBale(mb, 'hay_int', 'twine', -36.4, F, -40.6, 0.7, bales);
  hayBale(mb, 'hay_int', 'twine', -36.2, F + 0.37, -40.55, 0.5, bales);

  // ------------------------------------------------------------------ old farm gear (ground floor, west bays)
  // hay wagon (Leiterwagen), front wheel missing, axle on a block
  const wx = -46.8, wz = -44.6;
  mb.pushTRS(wx, F, wz, 0.04);
  for (let k = 0; k < 6; k++) mb.box('rough_timber', 0, 0.78, -0.5 + k * 0.2, 3.4, 0.03, 0.19, { uv: 'local', uvOffset: [k * 0.3, 0] });
  for (const s of [-1, 1]) {
    mb.beam('rough_timber', V(-1.75, 0.82, s * 0.62), V(1.75, 0.82, s * 0.62), 0.06, 0.07);
    mb.beam('rough_timber', V(-1.75, 1.45, s * 0.78), V(1.75, 1.45, s * 0.78), 0.06, 0.06);
    for (let k = 0; k <= 9; k++) mb.beam('rough_timber', V(-1.65 + k * 0.367, 0.82, s * 0.62), V(-1.65 + k * 0.367, 1.45, s * 0.78), 0.035, 0.035);
  }
  mb.box('rough_timber', 1.15, 0.62, 0, 0.12, 0.12, 1.1); mb.box('rough_timber', -1.15, 0.55, 0, 0.12, 0.12, 1.1);
  mb.box('rust_metal_int', -1.15, 0.5, 0, 0.06, 0.06, 1.5);
  mb.box('rust_metal_int', 1.15, 0.38, 0, 0.06, 0.06, 1.3);
  mb.box('rough_timber', 1.15, 0.17, -0.45, 0.3, 0.34, 0.25);        // block under the bare axle
  mb.beam('rough_timber', V(1.3, 0.42, 0), V(3.1, 0.06, 0.25), 0.07, 0.07);  // drawbar on the ground
  for (const s of [-1, 1]) { mb.pushTRS(-1.15, 0.5, s * 0.72, 0); cartWheel(mb, 'rough_timber', 'rust_metal_int', 0.5); mb.pop(); }
  mb.pushTRS(1.15, 0.4, 0.62, 0); cartWheel(mb, 'rough_timber', 'rust_metal_int', 0.4); mb.pop();
  mb.pop();
  physics?.addBox({ cx: wx, cy: F + 0.75, cz: wz, hx: 1.8, hy: 0.75, hz: 0.8, ry: 0.04, surface: 'wood' });
  // loose wheels against the north plinth wall and one lying flat
  leaningWheel(mb, 'rough_timber', 'rust_metal_int', -53.3, F, BIZ0 + 0.16, 0, 0.18, 0.55);
  leaningWheel(mb, 'rough_timber', 'rust_metal_int', -52.1, F, BIZ0 + 0.2, 0.15, 0.22, 0.6, 3, new RNG(7));
  mb.pushTRS(-49.4, F + 0.07, -47.6, 0.3, 1, 1, 1, Math.PI / 2); cartWheel(mb, 'rough_timber', 'rust_metal_int', 0.48); mb.pop();
  // rubble of old roof tiles in a corner, broom marks of nothing
  scatterBlocks(mb, 'roof_tiles', -54.3, -37.4, -53.0, -36.6, F, 14, rng, [0.24, 0.02, 0.4]);

  // ------------------------------------------------------------------ east bay: the diesel can rack (14 cans, numbered by Josef)
  const rx0 = -34.75, rx1 = -31.85, rz = BIZ0 + 0.27;
  for (const y of [F + 0.06, F + 0.665]) mb.box(T, (rx0 + rx1) / 2, y, rz, rx1 - rx0, 0.03, 0.44, { uv: 'local' });
  for (const x of [rx0 + 0.03, (rx0 + rx1) / 2, rx1 - 0.03]) mb.box(T, x, F + 0.6, rz, 0.06, 1.2, 0.42, { uv: 'local', uvRotate: true });
  for (const y of [F + 0.02, F + 0.64]) for (const z of [rz - 0.19, rz + 0.19]) mb.box(T, (rx0 + rx1) / 2, y, z, rx1 - rx0, 0.04, 0.05);
  physics?.addBox({ cx: (rx0 + rx1) / 2, cy: F + 0.6, cz: rz, hx: (rx1 - rx0) / 2, hy: 0.6, hz: 0.22, surface: 'wood' });
  kit.anchor('barn_diesel_cans', (rx0 + rx1) / 2, F + 0.68, rz + 0.1, 0, 'barn_east');
  // chopping block
  mb.cylinder('rough_timber', -33.2, F, -41.2, 0.3, 0.28, 0.5, 12, 'top', 'furniture_wood');
  physics?.addBox({ cx: -33.2, cy: F + 0.25, cz: -41.2, hx: 0.28, hy: 0.25, hz: 0.28, surface: 'wood' });
  heap(mb, 'rough_timber', -33.5, F, -40.4, 0.5, 0.35, 0.08, rng, 10, 2); // chips

  // ------------------------------------------------------------------ exterior
  const apronY = F - 0.035;
  const ae = Math.min(heightAt((tx0 + tx1) / 2, Bn.Z1 + 1.0), F) - 0.2;
  mb.box('stone_slab', (tx0 + tx1) / 2, (apronY + ae) / 2, Bn.Z1 + PO + 0.55, tx1 - tx0, apronY - ae, 1.1, { skip: ['ny', 'nz'], uv: 'local' });
  physics?.addBox({ cx: (tx0 + tx1) / 2, cy: apronY - 0.1, cz: Bn.Z1 + PO + 0.55, hx: (tx1 - tx0) / 2, hy: 0.1, hz: 0.55, surface: 'stone' });
  const we = Math.min(heightAt(Bn.X0 - 0.5, -44), F) - 0.2;
  mb.box('stone_slab', Bn.X0 - PO - 0.25, (F - 0.02 + we) / 2, -44, 0.5, F - 0.02 - we, 1.3, { skip: ['ny', 'px'], uv: 'local' });
  physics?.addBox({ cx: Bn.X0 - PO - 0.25, cy: F - 0.12, cz: -44, hx: 0.25, hy: 0.1, hz: 0.65, surface: 'stone' });
  const tanB = Math.tan(Bn.PITCH);
  const gyB = PT - Bn.OVERHANG * tanB - vT - 0.02;
  downpipe(mb, Bn.X1 + Bn.OVERHANG - 0.15, gyB, Bn.Z1 + Bn.OVERHANG + 0.09, Bn.X1 - 0.25, Bn.Z1 + 0.09, heightAt(Bn.X1 - 0.25, Bn.Z1 + 0.3));
  downpipe(mb, Bn.X0 - Bn.OVERHANG + 0.15, gyB, Bn.Z1 + Bn.OVERHANG + 0.09, Bn.X0 + 0.25, Bn.Z1 + 0.09, heightAt(Bn.X0 + 0.25, Bn.Z1 + 0.3));
  downpipe(mb, Bn.X0 - Bn.OVERHANG + 0.15, gyB, Bn.Z0 - Bn.OVERHANG - 0.09, Bn.X0 + 0.25, Bn.Z0 - 0.09, heightAt(Bn.X0 + 0.25, Bn.Z0 - 0.3));

  // ------------------------------------------------------------------ spans
  // boards are centred on the footprint lines, which are interior-map grid lines: inner faces in, outer faces out
  kit.span({ x0: Bn.X0, z0: Bn.Z0, x1: Bn.X1, z1: Bn.Z1, floorY: F - 0.1, ceil: (x, z) => roof.innerHeight(x, z) });

  const group = mb.build(materials, { name: 'barn' });
  return kit.output(group);
}

// =============================================================================================
// PUMP HOUSE
// =============================================================================================

export const PUMPHOUSE = {
  X0: -30, Z0: -53, X1: -25, Z1: -48,
  FLOOR: 0.2, B: -2.05, T: 0.38, EAVE: 2.95,
  PITCH: 32 * DEG, OVERHANG: 0.4,
  /** Opening to the service tunnel in the basement's south wall. */
  TUNNEL_DOOR: { x0: -28.3, x1: -27.2, top: 1.85 },
} as const;

/** Basement fittings used by props/documents. */
export const PUMPHOUSE_FIT = {
  generator: { x: -29.12, z: -51.25, pallet: 0.12 },
  crate: { x: -29.1, z: -52.36 },
  stairVoid: { x0: -26.25, z0: -51.6, x1: -25.38, z1: -49.2 },
} as const;

export function buildPumpHouse(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  const Ph = PUMPHOUSE;
  defineMaterials(materials, TUNNEL_MATS);
  defineMaterials(materials, {
    ph_render: { tex: 'plaster_ext', scale: 4, exterior: true, groundDirt: 1.2, color: '#cdc6b6' },
    ph_socle: { tex: 'concrete', scale: 3, exterior: true, groundDirt: 1, mossUp: 0.3, color: '#8f8b83' },
    ph_wall_int: { tex: 'plaster_int', scale: 3, color: '#bdb8ab' },
    ph_dado: { tex: 'oil_dado', scale: 2, color: '#7c8781' },
    ph_base_int: { tex: 'concrete', scale: 3, color: '#b3aea4' },
    ph_floor: { tex: 'concrete', scale: 3, color: '#86827b' },
    ph_tank: { tex: 'painted_metal', scale: 1, color: '#5b6858', vertexColors: true },
    ph_vessel: { tex: 'painted_metal', scale: 1, color: '#4b5f6b', vertexColors: true },
    ph_steel: { tex: 'painted_metal', scale: 1, color: '#6c706c', vertexColors: true },
    ph_door: { tex: 'painted_metal', scale: 1, color: '#56604f', exterior: true },
    enamel_plate: { color: '#e6e0ce', roughness: 0.22, exterior: true },
    soot_stain: { color: '#161412', roughness: 0.9 },
    gauge_face: { color: '#d8d4c4', roughness: 0.3 },
  });
  const facade: FaceSpec = { mat: 'ph_render', dado: { mat: 'ph_socle', h: 0.3 } };
  const kit = new BuildingKit('pumphouse', physics, facade);
  const mb = kit.mb;
  const rng = new RNG('pumphouse');
  const F = Ph.FLOOR, B = Ph.B, E = Ph.EAVE;
  const IX0 = Ph.X0 + Ph.T, IX1 = Ph.X1 - Ph.T, IZ0 = Ph.Z0 + Ph.T, IZ1 = Ph.Z1 - Ph.T;
  const L = shellLines(Ph, Ph.T);
  const SV = PUMPHOUSE_FIT.stairVoid;
  const TD = Ph.TUNNEL_DOOR;
  const ground = groundRange(heightAt, Ph, 0.6);

  // ------------------------------------------------------------------ rooms (basement + ground floor)
  kit.room({ id: 'ph_basement', location: 'pumphouse', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: B, y1: 0, floor: 'ph_floor', ceiling: 'concrete_int', ceilVoids: [SV], wall: 'ph_base_int', skirting: null, env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'ph_ground', location: 'pumphouse', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: F, y1: E, floor: 'ph_floor', ceiling: null, voids: [SV], slab: F, wall: 'ph_wall_int', skirting: null, env: 'room_small', floorSurface: 'concrete' });
  kit.buildRoomSurfaces();
  voidEdges(mb, 'concrete_int', SV, F, F, ['n', 's', 'w']);

  // ------------------------------------------------------------------ walls
  // basement walls (shaft in a terrain hole): lower outer band is buried / visible from the tunnel
  const baseIn: FaceSpec = { mat: 'ph_base_int', dado: { mat: 'tunnel_wall_damp', h: 0.55 } };
  const baseOut: FaceSpec = { mat: 'ph_socle', dado: { mat: 'tunnel_wall', h: Math.min(-0.12, ground.min - 0.06) - B } };
  const bw = rectShell(kit, Ph, Ph.T, B, F, { left: baseIn, right: baseOut, cap: 'ph_base_int' }, {
    s: { doors: [{ o: { at: L.at.s((TD.x0 + TD.x1) / 2), width: TD.x1 - TD.x0, bottom: 0, top: TD.top, kind: 'hole' }, frame: 'rust_metal_int', architrave: false }] },
  }, { noTop: true, surface: 'concrete' });
  const mainDoorX = -28.2;
  const barred = { style: 'small' as const, frameMat: 'painted_metal_ext', sashMat: 'painted_metal_ext', sillIn: null, muntins: true };
  const gw = rectShell(kit, Ph, Ph.T, F, E, { left: { mat: 'ph_wall_int', dado: { mat: 'ph_dado', h: 1.2 } }, right: facade, cap: 'ph_render' }, {
    s: { doors: [{ o: { at: L.at.s(mainDoorX), width: 1.0, bottom: 0, top: 2.1, kind: 'hole' }, frame: 'ph_steel', architrave: false }] },
    e: { windows: [winO(L.at.e(-50.4), 0.7, 1.2, 2.0, { ...barred, broken: 0.4 })] },
    n: { windows: [winO(L.at.n(-27.6), 0.8, 1.2, 2.0, { ...barred, broken: 0.2 })] },
    w: { windows: [winO(L.at.w(-49.7), 0.7, 1.2, 2.0, { ...barred, broken: 0.7 })] },
  }, { noTop: true, surface: 'stone' });
  // iron bars in the outer reveals
  const bars = (f: WallFrame, at: number, w: number, b: number, t: number) => {
    for (let k = 1; k <= 4; k++) {
      const s = at - w / 2 + (k * w) / 5;
      const p = (y: number) => V(f.ax + f.dx * s + f.rx * (Ph.T / 2 - 0.04), y, f.az + f.dz * s + f.rz * (Ph.T / 2 - 0.04));
      mb.rod('iron_black', p(f.y0 + b), p(f.y0 + t), 0.011, 0.011, 6);
    }
  };
  bars(gw.e, L.at.e(-50.4), 0.7, 1.2, 2.0); bars(gw.n, L.at.n(-27.6), 0.8, 1.2, 2.0); bars(gw.w, L.at.w(-49.7), 0.7, 1.2, 2.0);

  // roof (hip; a hair longer in x so the ridge never degenerates)
  const roof = buildRoof(mb, { type: 'hip', x0: Ph.X0 - 0.01, z0: Ph.Z0, x1: Ph.X1 + 0.01, z1: Ph.Z1, eaveY: E, pitch: Ph.PITCH, overhang: Ph.OVERHANG, thickness: 0.18, tileMat: 'roof_tiles', innerMat: 'rough_timber', fasciaMat: 'painted_wood_brown_ext', gutterMat: 'rust_metal', rafters: null }, physics);
  const roofRect = { x0: Ph.X0 - 0.01, z0: Ph.Z0, x1: Ph.X1 + 0.01, z1: Ph.Z1 };
  roofRafters(mb, roof, roofRect, 0.8, 0.12, 'rough_timber', null, E);
  hipRafters(mb, roof, roofRect, 0.14, 'rough_timber');
  for (const z of [-51.5, -49.5]) mb.box('rough_timber', (Ph.X0 + Ph.X1) / 2, E - 0.08, z, IX1 - IX0 + 0.2, 0.16, 0.12, { uv: 'local' });

  // ------------------------------------------------------------------ doors
  const md = L.at.s(mainDoorX);
  const mdl = leafOpening(md - 0.5 + 0.054, md + 0.5 - 0.054, 0, 2.1);
  kit.doorInWall('door:pumphouse_main', gw.s, mdl.o, { style: 'flush', mat: 'ph_door', handle: 'lever', handleMat: 'iron_black', thickness: 0.05 }, mdl.hingeSide, -1, { sound: 'metal' });
  const td = L.at.s((TD.x0 + TD.x1) / 2), tw = TD.x1 - TD.x0;
  const tdl = leafOpening(td - tw / 2 + 0.054, td + tw / 2 - 0.054, 0, TD.top);
  kit.doorInWall('door:pumphouse_tunnel', bw.s, tdl.o, { style: 'flush', mat: 'rust_metal_int', handle: 'lever', handleMat: 'rust_metal_int', thickness: 0.05 }, tdl.hingeSide, -1, { sound: 'metal', open: 0.22 });

  // ------------------------------------------------------------------ stair down the shaft + railing
  const sRise = F - B, sSteps = 11, sRun = 0.21;
  buildStairs(mb, { x: (SV.x0 + SV.x1) / 2 + 0.03, z: SV.z1 - sSteps * sRun, y: B, dir: Math.PI, width: 0.78, rise: sRise, steps: sSteps, run: sRun, treadMat: 'ph_steel', riserMat: 'ph_steel', stringerMat: 'rust_metal_int', rail: 'right', railMat: 'iron_black', surface: 'metal' }, physics);
  pipeRailing(mb, physics, [[SV.x0 - 0.03, SV.z1 + 0.02], [SV.x0 - 0.03, SV.z0 - 0.03], [IX1, SV.z0 - 0.03]], F, 'iron_black', 1.0);

  // ------------------------------------------------------------------ basement equipment
  // diesel tank on timber bearers (west wall), sight gauge, hand pump, fuel line to the generator
  const tk = { x0: IX0 + 0.05, x1: IX0 + 0.6, z0: -50.45, z1: -49.25, y0: B + 0.1, y1: B + 0.85 };
  for (const z of [tk.z0 + 0.2, tk.z1 - 0.2]) mb.box('rough_timber', (tk.x0 + tk.x1) / 2, B + 0.05, z, 0.62, 0.1, 0.1, { uv: 'local' });
  mb.box('ph_tank', (tk.x0 + tk.x1) / 2, (tk.y0 + tk.y1) / 2, (tk.z0 + tk.z1) / 2, tk.x1 - tk.x0, tk.y1 - tk.y0, tk.z1 - tk.z0, { uv: 'local' });
  for (const z of [tk.z0 + 0.4, tk.z1 - 0.4]) mb.box('ph_tank', (tk.x0 + tk.x1) / 2, (tk.y0 + tk.y1) / 2, z, tk.x1 - tk.x0 + 0.012, tk.y1 - tk.y0 + 0.012, 0.03);
  mb.cylinder('ph_steel', tk.x0 + 0.2, tk.y1, tk.z1 - 0.18, 0.055, 0.055, 0.06, 10);
  mb.box('ph_steel', tk.x0 + 0.3, tk.y1 + 0.06, tk.z0 + 0.25, 0.12, 0.12, 0.12);
  mb.beam('iron_black', V(tk.x0 + 0.3, tk.y1 + 0.13, tk.z0 + 0.25), V(tk.x0 + 0.3, tk.y1 + 0.2, tk.z0 + 0.5), 0.02, 0.02);
  mb.rod('chrome', V(tk.x1 + 0.02, tk.y0 + 0.06, tk.z1 - 0.12), V(tk.x1 + 0.02, tk.y1 - 0.05, tk.z1 - 0.12), 0.008, 0.008, 6);
  for (const y of [tk.y0 + 0.06, tk.y1 - 0.05]) mb.box('brass', tk.x1 + 0.01, y, tk.z1 - 0.12, 0.03, 0.025, 0.025);
  physics?.addBox({ cx: (tk.x0 + tk.x1) / 2, cy: (B + tk.y1) / 2, cz: (tk.z0 + tk.z1) / 2, hx: (tk.x1 - tk.x0) / 2, hy: (tk.y1 - B) / 2, hz: (tk.z1 - tk.z0) / 2, surface: 'metal' });
  const G = PUMPHOUSE_FIT.generator;
  pipe(mb, 'rubber_black', [V(tk.x1 + 0.01, tk.y0 + 0.08, tk.z0 + 0.1), V(tk.x1 + 0.12, B + 0.04, tk.z0 - 0.15), V(G.x + 0.1, B + 0.03, G.z + 0.3), V(G.x + 0.2, B + 0.25, G.z + 0.42)], 0.009, 6, 0.06);
  // pallet under the generator (the generator itself is the prop 'portable_generator')
  const pl = { x0: G.x - 0.36, x1: G.x + 0.36, z0: G.z - 0.46, z1: G.z + 0.46 };
  for (const x of [pl.x0 + 0.05, G.x, pl.x1 - 0.05]) mb.box('rough_timber', x, B + 0.045, G.z, 0.09, 0.09, pl.z1 - pl.z0, { uv: 'local', uvRotate: true });
  for (let k = 0; k < 7; k++) mb.box('rough_timber', G.x, B + 0.1, pl.z0 + 0.06 + k * ((pl.z1 - pl.z0 - 0.12) / 6), pl.x1 - pl.x0, 0.022, 0.1, { uv: 'local', uvOffset: [k * 0.4, 0] });
  physics?.addBox({ cx: G.x, cy: B + 0.06, cz: G.z, hx: 0.36, hy: 0.06, hz: 0.46, surface: 'wood' });
  // exhaust: up the west wall, through the ground-floor slab and out through the wall
  const exX = IX0 + 0.12, exZ = G.z;
  pipe(mb, 'rust_metal_int', [V(G.x - 0.26, B + G.pallet + 0.4, exZ), V(exX, B + G.pallet + 0.4, exZ), V(exX, F + 0.55, exZ), V(Ph.X0 - 0.22, F + 0.55, exZ), V(Ph.X0 - 0.22, F + 0.3, exZ)], 0.035, 8);
  flange(mb, 'rust_metal_int', V(exX, F + 0.005, exZ), V(0, 1, 0), 0.06, 0.012);
  flange(mb, 'rust_metal', V(Ph.X0 - 0.005, F + 0.55, exZ), V(1, 0, 0), 0.07, 0.012);
  wallPatch(mb, 'soot_stain', V(Ph.X0 - 0.004, F + 0.95, exZ - 0.05), V(-1, 0, 0), 0.32, 0.55, rng);
  wallPatch(mb, 'soot_stain', V(IX0 + 0.003, F + 1.15, exZ), V(1, 0, 0), 0.12, 0.45, rng);
  // pressure vessel (Windkessel) with gauge and valve
  const wk = { x: -28.2, z: -52.25, y: B + 0.1 };
  mb.box('concrete_int', wk.x, B + 0.05, wk.z, 0.64, 0.1, 0.64);
  mb.pushTRS(wk.x, wk.y, wk.z);
  mb.lathe('ph_vessel', [[0.0, 0.0], [0.26, 0.0], [0.28, 0.04], [0.28, 1.3], [0.25, 1.4], [0.15, 1.47], [0.0, 1.5]], 18);
  mb.pop();
  physics?.addBox({ cx: wk.x, cy: wk.y + 0.75, cz: wk.z, hx: 0.29, hy: 0.8, hz: 0.29, surface: 'metal' });
  mb.rod('ph_steel', V(wk.x, wk.y + 1.1, wk.z + 0.28), V(wk.x, wk.y + 1.1, wk.z + 0.36), 0.012, 0.012, 6);
  mb.rod('ph_steel', V(wk.x, wk.y + 1.1, wk.z + 0.36), V(wk.x, wk.y + 1.1, wk.z + 0.39), 0.055, 0.055, 14);
  mb.quad('gauge_face', [wk.x - 0.045, wk.y + 1.055, wk.z + 0.392], [wk.x + 0.045, wk.y + 1.055, wk.z + 0.392], [wk.x + 0.045, wk.y + 1.145, wk.z + 0.392], [wk.x - 0.045, wk.y + 1.145, wk.z + 0.392], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  mb.box('black_soot', wk.x + 0.012, wk.y + 1.105, wk.z + 0.394, 0.03, 0.004, 0.002);
  // pump set on a concrete plinth: motor (finned), coupling, volute; suction into the well
  const pp = { x0: -27.7, x1: -26.7, z: -52.27, y: B + 0.22 };
  mb.box('concrete_int', (pp.x0 + pp.x1) / 2, B + 0.11, pp.z, pp.x1 - pp.x0, 0.22, 0.55, { uv: 'local' });
  physics?.addBox({ cx: (pp.x0 + pp.x1) / 2, cy: B + 0.35, cz: pp.z, hx: 0.5, hy: 0.35, hz: 0.28, surface: 'metal' });
  const my = pp.y + 0.19;
  mb.rod('ph_vessel', V(pp.x0 + 0.08, my, pp.z), V(pp.x0 + 0.5, my, pp.z), 0.15, 0.15, 16);
  for (let k = 0; k < 6; k++) flange(mb, 'ph_vessel', V(pp.x0 + 0.13 + k * 0.065, my, pp.z), V(1, 0, 0), 0.168, 0.012, 16);
  for (const dz of [-0.11, 0.11]) mb.box('ph_vessel', pp.x0 + 0.29, pp.y + 0.02, pp.z + dz, 0.3, 0.04, 0.05);
  mb.box('ph_steel', pp.x0 + 0.29, my + 0.17, pp.z, 0.12, 0.06, 0.1);
  mb.rod('ph_steel', V(pp.x0 + 0.5, my, pp.z), V(pp.x0 + 0.62, my, pp.z), 0.06, 0.06, 10);
  mb.rod('ph_steel', V(pp.x0 + 0.62, my, pp.z), V(pp.x0 + 0.78, my, pp.z), 0.18, 0.18, 16);
  const vx = pp.x0 + 0.7;
  pipe(mb, 'ph_steel', [V(vx, my + 0.15, pp.z), V(vx, my + 0.5, pp.z), V(wk.x + 0.28, my + 0.5, pp.z)], 0.045, 10);
  flange(mb, 'ph_steel', V(vx, my + 0.24, pp.z), V(0, 1, 0), 0.075);
  const well = { x: -27.0, z: -51.35 };
  pipe(mb, 'ph_steel', [V(vx, my, pp.z + 0.15), V(vx, my, well.z), V(well.x, B + 0.05, well.z)], 0.045, 10);
  mb.cylinder('iron_black', well.x, B, well.z, 0.33, 0.33, 0.012, 20);
  for (let k = -2; k <= 2; k++) mb.box('black_soot', well.x + k * 0.1, B + 0.013, well.z, 0.012, 0.002, 0.5 - Math.abs(k) * 0.08);
  puddle(mb, 'tunnel_water', -26.9, -51.75, B + 0.003, 0.45, 0.3, rng);
  puddle(mb, 'tunnel_water', -27.6, -49.6, B + 0.003, 0.25, 0.2, rng);
  drainGrate(mb, -27.75, B, -50.4, 0.25);
  // pipes arriving from the tunnel: water main (riser to the vessel) and the cut heating loop (blind flanges)
  const xin = -26.77, xout = -26.95, zw = Ph.Z1;
  pipe(mb, 'rust_metal_int', [V(xin, B + 0.4, zw - 0.02), V(xin, B + 0.4, -49.15), V(xin, -0.12, -49.15), V(xin, -0.12, -51.8), V(wk.x, -0.12, -51.8), V(wk.x, -0.12, wk.z), V(wk.x, wk.y + 1.49, wk.z)], 0.06, 10);
  flange(mb, 'rust_metal_int', V(xin, B + 1.0, -49.15), V(0, 1, 0), 0.1);
  mb.rod('iron_black', V(xin, B + 1.0, -49.15), V(xin + 0.18, B + 1.0, -49.15), 0.012, 0.012, 5);
  flange(mb, 'iron_black', V(xin + 0.19, B + 1.0, -49.15), V(1, 0, 0), 0.09, 0.012);
  for (const x of [xin, xout]) {
    mb.rod('pipe_lagging', V(x, B + 1.5, zw - 0.02), V(x, B + 1.5, IZ1 - 0.2), 0.075, 0.075, 10);
    flange(mb, 'rust_metal_int', V(x, B + 1.5, IZ1 - 0.2), V(0, 0, 1), 0.085, 0.02);
    flange(mb, 'rust_metal_int', V(x, B + 1.5, IZ1 - 0.23), V(0, 0, 1), 0.085, 0.02);
  }
  // Josef's 1993 generator cable: from the tunnel lintel along the ceiling to the switch box
  const cbl = 'rubber_black';
  const boxZ = -50.0;
  pipe(mb, cbl, [V(-28.2, -0.17, zw - 0.02), V(-28.2, -0.04, IZ1 - 0.1), V(-28.2, -0.04, boxZ), V(IX0 + 0.03, -0.04, boxZ), V(IX0 + 0.03, B + 1.72, boxZ)], 0.009, 5, 0.05);
  for (let z = IZ1 - 0.3; z > boxZ; z -= 0.55) mb.box('rust_metal_int', -28.2, -0.025, z, 0.03, 0.02, 0.015);
  pipe(mb, cbl, [V(IX0 + 0.05, B + 1.2, boxZ + 0.05), V(IX0 + 0.06, B + 0.6, boxZ - 0.2), V(G.x + 0.05, B + 0.62, G.z + 0.4)], 0.009, 5, 0.08);

  // ------------------------------------------------------------------ ground floor fittings
  const tb = { x0: -29.35, x1: -28.3, z0: IZ0 + 0.02, z1: IZ0 + 0.62 };
  mb.box('furniture_wood', (tb.x0 + tb.x1) / 2, F + 0.76, (tb.z0 + tb.z1) / 2, tb.x1 - tb.x0, 0.04, tb.z1 - tb.z0, { uv: 'local' });
  for (const x of [tb.x0 + 0.04, tb.x1 - 0.04]) for (const z of [tb.z0 + 0.04, tb.z1 - 0.04]) mb.box('furniture_wood', x, F + 0.37, z, 0.05, 0.74, 0.05);
  physics?.addBox({ cx: (tb.x0 + tb.x1) / 2, cy: F + 0.39, cz: (tb.z0 + tb.z1) / 2, hx: (tb.x1 - tb.x0) / 2, hy: 0.39, hz: (tb.z1 - tb.z0) / 2, surface: 'wood' });
  kit.anchor('pumphouse_calendar', (tb.x0 + tb.x1) / 2, F + 1.6, IZ0 + 0.004, 0, 'ph_ground');

  // ------------------------------------------------------------------ exterior: step, sign, downpipe
  const de = Math.min(heightAt(mainDoorX, Ph.Z1 + 0.4), F) - 0.15;
  mb.box('ph_socle', mainDoorX, (F - 0.01 + de) / 2, Ph.Z1 + 0.28, 1.4, F - 0.01 - de, 0.56, { skip: ['ny', 'nz'] });
  physics?.addBox({ cx: mainDoorX, cy: F - 0.11, cz: Ph.Z1 + 0.28, hx: 0.7, hy: 0.1, hz: 0.28, surface: 'concrete' });
  mb.box('enamel_plate', -26.6, F + 1.75, Ph.Z1 + 0.006, 0.52, 0.26, 0.008, { skip: ['nz'] });
  kit.anchor('pumphouse_sign', -26.6, F + 1.75, Ph.Z1 + 0.011, 0);
  const tanP = Math.tan(Ph.PITCH), vTP = 0.18 / Math.cos(Ph.PITCH);
  downpipe(mb, Ph.X1 + Ph.OVERHANG + 0.09, E - Ph.OVERHANG * tanP - vTP - 0.02, Ph.Z1 + Ph.OVERHANG - 0.15, Ph.X1 + 0.08, Ph.Z1 - 0.2, heightAt(Ph.X1 + 0.2, Ph.Z1 - 0.2));

  // ------------------------------------------------------------------ light, anchors, spans
  kit.light({ id: 'light:pumphouse_bulb', position: V(-27.7, -0.32, -50.7), kind: 'bulb', working: true, flicker: 0.5, color: 0xffb466, intensity: 1.6, room: 'ph_basement' });
  kit.light({ id: 'light:pumphouse_ground', position: V(-27.6, E - 0.45, -50.5), kind: 'bulb', working: false, flicker: 0, room: 'ph_ground' });
  kit.anchor('generator_label', IX0 + 0.004, B + 1.05, G.z, Math.PI / 2, 'ph_basement');
  kit.span(spanFromInner(IX0, IZ0, IX1, IZ1, B - 0.05, (x, z) => roof.innerHeight(x, z)));

  const group = mb.build(materials, { name: 'pumphouse' });
  return kit.output(group);
}
