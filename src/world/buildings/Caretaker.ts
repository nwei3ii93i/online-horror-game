import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import { BuildingKit, BuildingOutput, KitWall } from '../architecture/BuildingKit';
import { buildSlab, buildWindow, WindowOpts } from '../architecture/Elements';
import { buildRoof, buildChimney, RoofInfo } from '../architecture/Roofs';
import { wallFrame, buildSkirting, Opening, WallFrame, FaceSpec } from '../architecture/Walls';
import { MeshBuilder, BoxMats } from '../architecture/MeshBuilder';
import { balustrade } from './Manor';
import { BUILDINGS, PATHS, POI, Rect, smoothPolyline } from '../Layout';
import type { Physics } from '../../physics/Physics';
import type { MaterialLibrary, MatSpec } from '../../materials/MaterialLibrary';
import { worldUniforms } from '../../render/WorldUniforms';
import { RNG } from '../../core/Random';

/**
 * Hausmeisterhaus (caretaker's house) of Gut Waldegg, ~1925, with the estate gate, the roadside
 * mailbox and the woodshed. Josef Hrubý lived here until he died in January 2004; Marie still
 * keeps the place going (warm stove, a working bulb, fresh candles, the 2019 calendar).
 *
 * House: granite rubble, lime-rendered, single storey + attic under a steep (47°) gable roof,
 * small Kastenfenster in granite surrounds, a 1960s lean-to porch (Vorbau) with a corrugated
 * roof, a cellar under the whole house and a crawl space under the porch.
 * Footprint x ∈ [27, 35], z ∈ [1, 10] (Layout.BUILDINGS.caretaker, terrain hole). Main block
 * z ∈ [1, 8], porch x ∈ [29.9, 32.9] × z ∈ [8, 10], the rest of the strip z ∈ [8, 10] is a
 * granite-paved terrace ("Gred") so nothing floats over the terrain hole.
 *
 * Levels: cellar −2.00 | ground floor 0.45 (ceiling 2.85) | attic 3.07 | wall plate 3.90 |
 * ridge 7.65. Porch floor 0.30, crawl space −1.45…−0.70 (opening 0.75 m, crawl on all fours).
 *
 * Ground floor: kitchen (Wohnküche, NW: Sparherd, key board, calendar, ladder-stair to the
 * attic), larder (NE: steep stair down to the cellar), hall (Vorhaus), living room (SW: tiled
 * stove, corner bench, Herrgottswinkel with a red votive light), bedroom (SE).
 * Doors: porch door LOCKED (key 'key_caretaker'); kitchen back door (north) stands ajar.
 *
 * Grounds (same output group, own sub-meshes for culling):
 *  - Gate at POI.gate across the service road: granite pillars, wrought-iron double gate chained
 *    and padlocked (static meshes + one blocking collider), enamel sign, dry-stone walls ~15 m
 *    each side that crumble away into the forest (a collapsed 2 m breach ~7 m east of the gate
 *    is the intended way in), rusted mailbox on a post outside the gate (anchor 'road_mailbox').
 *  - Woodshed at POI.woodshed: open-fronted timber lean-to, stacked firewood, chopping block.
 *
 * ============================================================================ INTEGRATION
 *  World.build()  (src/world/World.ts), after the manor:
 *      import { buildCaretaker } from './buildings/Caretaker';
 *      this.add(buildCaretaker(this.physics, this.materials, (x, z) => this.terrain.heightAt(x, z)));
 *    (World.add() collects doors, lights, rooms and spans; applyInteriorMap() picks the spans up.)
 *  Game.load()  (src/Game.ts):
 *      import { CARETAKER_PROP_IDS, caretakerProps } from './world/props/CaretakerProps';
 *      import { caretakerDocs } from './world/story/CaretakerDocs';
 *      const h = (x: number, z: number) => this.terrain.heightAt(x, z);
 *      preload:   this.assets.preload([...MANOR_PROP_IDS, ...CARETAKER_PROP_IDS, ...VAN_CARGO])
 *      furnish:   a SEPARATE PropPlacer, because the manor prop culling (propCullTimer) hides
 *                 this.props.group further than 22 m from the manor:
 *                   this.caretakerProps = new PropPlacer(this.assets, this.physics);
 *                   for (const [id, x, y, z, ry = 0, o = {}] of caretakerProps(h)) this.caretakerProps.place(id, x, y, z, ry, o);
 *                   scene.add(this.caretakerProps.group);   // cull by distance to BUILDINGS.caretaker if wanted
 *      documents: scene.add(placeDocuments(caretakerDocs(h), this.physics, this.interaction, (d) => this.reader.open(d)));
 *    (CARETAKER_PROPS / CARETAKER_DOCS are the same lists with the outdoor heights baked for the
 *     default seed 1987 – caretakerProps(h) / caretakerDocs(h) are exact for any seed.)
 *  Anchors in the output: 'key_manor_front' (empty hook on the kitchen key board – hang the
 *    manor key pickup there), 'road_mailbox' (delivery note inside the open mailbox),
 *    'gate_sign', 'caretaker_stove' (warm stove: crackle / heat), 'caretaker_votive' (lit red
 *    votive light), 'caretaker_crawlspace', 'woodshed_block'.
 *  Vegetation: Forest/GroundCover only keep BUILDINGS (+4 m) free. CARETAKER_GROUNDS_BLOCKERS
 *    lists the gate, wall and woodshed rectangles to add to their blocker lists.
 */

// ============================================================================ layout constants
const B = BUILDINGS.caretaker;
const PITCH = (47 * Math.PI) / 180;
const TAN = Math.tan(PITCH);
const PORCH_PITCH = (10 * Math.PI) / 180;

export const CARETAKER = {
  /** Main block outer faces (z1 = 8; the footprint continues to z = 10 with porch + terrace). */
  X0: B.x0, X1: B.x1, Z0: B.z0, Z1: 8, ZF: B.z1,
  C0: B.cellarY, CC: 0.15, G0: B.floorY, Gc: 2.85, A0: 3.07, EAVE: 3.9,
  RIDGE: 3.9 + TAN * (8 - B.z0) / 2,
  T: 0.5, PITCH, OH: 0.5,
  PORCH: { x0: 29.9, x1: 32.9, z0: 8, z1: 10, y: 0.3, eave: 2.5, pitch: PORCH_PITCH, t: 0.25 },
  CRAWL: { x0: 30.15, x1: 32.65, z0: 8, z1: 9.75, y0: -1.45, y1: -0.7 },
} as const;

const C = CARETAKER;
const T = C.T;
const WX0 = C.X0 + T / 2, WX1 = C.X1 - T / 2, WZ0 = C.Z0 + T / 2, WZ1 = C.Z1 - T / 2;   // wall centre lines
const IX0 = C.X0 + T, IX1 = C.X1 - T, IZ0 = C.Z0 + T, IZ1 = C.Z1 - T;                   // inner faces
const MZ = 4.4;            // central (spine) wall under the ridge
const KX = 32.05;          // kitchen | larder and hall | bedroom partition
const HX = 30.675;         // living | hall partition
const G0 = C.G0, Gc = C.Gc, C0 = C.C0, CC = C.CC, A0 = C.A0;
const P = C.PORCH;
const PT = P.t;
const PWX0 = P.x0 + PT / 2, PWX1 = P.x1 - PT / 2, PWZ1 = P.z1 - PT / 2;
const PIX0 = P.x0 + PT, PIX1 = P.x1 - PT, PIZ1 = P.z1 - PT;
const CHIM = { x: 29.8, z: 4.46, sx: 0.5, sz: 0.4 };              // chimney stack (straddles the ridge)
const STAIR_VOID: Rect = { x0: 33.58, z0: 1.72, x1: IX1, z1: 4.275 };   // larder → cellar
const HATCH: Rect = { x0: IX0, z0: 2.3, x1: 28.3, z1: 4.275 };           // kitchen → attic

/** Furniture tops and fixed spots shared with CaretakerProps / CaretakerDocs. */
export const CARETAKER_SPOTS = {
  kitchenTable: { x: 29.75, z: 1.92, w: 1.1, d: 0.74, top: G0 + 0.78 },
  woodBox: { x: 28.8, z: 4.01, w: 0.44, d: 0.46, top: G0 + 0.57 },
  stove: { x: CHIM.x, z: CHIM.z - CHIM.sz / 2 - 0.3, top: G0 + 0.84 },
  livingTable: { x: 28.55, z: 6.45, w: 1.0, d: 0.8, top: G0 + 0.78 },
  /** Cellar jar shelf on the north cellar wall; board tops at C0 + b + 0.0125. */
  jarShelf: { x0: 28.0, x1: 31.2, z0: IZ0, depth: 0.32, boards: [0.4, 0.85, 1.3, 1.75] },
  /** Larder shelf against the larder's west wall; board tops at G0 + b + 0.0125. */
  larderShelf: { x0: KX + 0.075, depth: 0.3, z0: 2.6, z1: 4.2, boards: [0.45, 0.95, 1.45, 1.9] },
  calendar: { x: 29.925, y: 1.72, z: IZ0 },
  keyBoard: { x: 31.7, y: 1.6, z: IZ0 },
  crawl: { x: 31.4, z: 8.95 },
} as const;

// ============================================================================ ground frames
/** A yawed frame on the ground plane: local +z maps to (sin yaw, cos yaw), local +x to (cos yaw, −sin yaw). */
export interface Frame2 { ox: number; oz: number; yaw: number }

export function frameToWorld(f: Frame2, lx: number, lz: number): [number, number] {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.ox + lx * c + lz * s, f.oz - lx * s + lz * c];
}

/** Gate frame: origin POI.gate on the road, local x across the road, local +z outward (towards the valley). */
export const GATE_FRAME: Frame2 = (() => {
  const road = PATHS.find((p) => p.id === 'road');
  let tx = -0.545, tz = -0.839;
  if (road) {
    const pts = smoothPolyline(road.points, 8);   // same smoothing as TerrainData.applyPaths
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
      if (l2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((POI.gate.x - ax) * vx + (POI.gate.z - az) * vz) / l2));
      const d = Math.hypot(ax + vx * t - POI.gate.x, az + vz * t - POI.gate.z);
      if (d < best) { best = d; const l = Math.sqrt(l2); tx = vx / l; tz = vz / l; }
    }
  }
  // road points run from the valley up to the courtyard → tangent points inward; +z = outward
  return { ox: POI.gate.x, oz: POI.gate.z, yaw: Math.atan2(-tx, -tz) };
})();

/** Woodshed frame: open front (local +z) faces south-west towards the caretaker's back yard. */
export const SHED_FRAME: Frame2 = { ox: POI.woodshed.x, oz: POI.woodshed.z, yaw: -Math.PI / 4 };

/** Gate-local position of the mailbox post (right-hand side of the road, outside the gate). */
export const MAILBOX_LOCAL = { lx: 2.95, lz: 2.35 } as const;
/** Woodshed-local chopping block (in front of the shed). */
export const CHOP_BLOCK = { lx: 0.75, lz: 2.05, r: 0.3, h: 0.5 } as const;

const MB_W = 0.36, MB_D = 0.24, MB_H = 0.4, MB_POST = 1.02;

/** World pose of the delivery note inside the mailbox (and of the 'road_mailbox' anchor). */
export function mailboxNotePose(heightAt: (x: number, z: number) => number): { x: number; y: number; z: number; rot: number } {
  const [x, z] = frameToWorld(GATE_FRAME, MAILBOX_LOCAL.lx, MAILBOX_LOCAL.lz);
  const yaw = GATE_FRAME.yaw - Math.PI / 2;
  // a little towards the open front flap
  const fx = Math.sin(yaw) * 0.03, fz = Math.cos(yaw) * 0.03;
  return { x: x + fx, y: heightAt(x, z) + MB_POST + 0.008, z: z + fz, rot: yaw + Math.PI / 2 + 0.12 };
}

/** Height of the chopping block's top face. */
export function chopBlockTop(heightAt: (x: number, z: number) => number): number {
  const [x, z] = frameToWorld(SHED_FRAME, CHOP_BLOCK.lx, CHOP_BLOCK.lz);
  return heightAt(x, z) - 0.05 + CHOP_BLOCK.h;
}

/** Axis-aligned rectangles around the gate walls and the woodshed (for tree / ground-cover blockers). */
export const CARETAKER_GROUNDS_BLOCKERS: Rect[] = (() => {
  const out: Rect[] = [];
  const box = (f: Frame2, pts: [number, number][], m: number) => {
    const w = pts.map(([lx, lz]) => frameToWorld(f, lx, lz));
    out.push({ x0: Math.min(...w.map((p) => p[0])) - m, z0: Math.min(...w.map((p) => p[1])) - m, x1: Math.max(...w.map((p) => p[0])) + m, z1: Math.max(...w.map((p) => p[1])) + m });
  };
  for (const s of [-1, 1]) {
    const line = wallLine(s as 1 | -1);
    for (let i = 0; i < line.length - 1; i++) box(GATE_FRAME, [line[i], line[i + 1]], 1.2);
  }
  box(GATE_FRAME, [[-3, -1], [3, -1], [3, 3.2], [-3, 3.2]], 0.5);
  box(SHED_FRAME, [[-3.4, -1.5], [3.4, -1.5], [3.4, 2.8], [-3.4, 2.8]], 0.5);
  return out;
})();

/** Gate-local polyline of the boundary wall on side s (−1 west, +1 east), starting at the pillar. */
function wallLine(s: 1 | -1): [number, number][] {
  const bend = 0.26;
  const a: [number, number] = [s * 2.65, 0];
  const b: [number, number] = [s * 9.6, 0];
  const c: [number, number] = [s * (9.6 + 5.6 * Math.cos(bend)), -5.6 * Math.sin(bend)];
  return [a, b, c];
}

// ============================================================================ materials
const FACADE: FaceSpec = { mat: 'ct_plaster_ext', dado: { mat: 'ct_granite', h: 0.45 } };

const MATS: Record<string, MatSpec> = {
  ct_plaster_ext: { tex: 'plaster_ext', scale: 4, exterior: true, groundDirt: 1, color: '#e6e1d4' },
  ct_plaster_grey_ext: { tex: 'plaster_ext_grey', scale: 4, exterior: true, groundDirt: 1, color: '#d4d0c4' },
  ct_granite: { tex: 'stone_slab', scale: 1.6, exterior: true, groundDirt: 0.7, mossUp: 0.45, color: '#b4b0a6' },
  ct_granite_int: { tex: 'stone_slab', scale: 1.6, color: '#a8a49a' },
  ct_whitewash: { tex: 'plaster_int', scale: 3, color: '#dcd8cc' },
  ct_cellar_wash: { tex: 'plaster_int', scale: 3, color: '#b6b2a6' },
  ct_kitchen_wall: { tex: 'plaster_int', scale: 3, color: '#d9cfa8' },
  ct_living_wall: { tex: 'plaster_int', scale: 3, color: '#c9c3a2' },
  ct_porch_wall: { tex: 'plaster_int', scale: 3, color: '#d2c79c' },
  ct_boards_ceiling: { tex: 'floor_boards', scale: 3, color: '#9a8a74' },
  ct_earth: { tex: 'mud', scale: 2, color: '#8e7e6a' },
  ct_iron: { color: '#1f1e1c', roughness: 0.72, metalness: 0.6 },
  ct_iron_ext: { tex: 'rust_metal', scale: 0.8, color: '#4e4440', exterior: true, vertexColors: true },
  ct_tile_green: { color: '#3e5a46', roughness: 0.26, clearcoat: 0.5 },
  ct_tile_joint: { tex: 'plaster_int', scale: 1, color: '#9c9484' },
  ct_oilcloth: { tex: 'fabric_check', scale: 0.35, color: '#c89080', vertexColors: true },
  ct_firewood: { tex: 'rough_timber', scale: 0.6, color: '#c8aa84', vertexColors: true },
  ct_firewood_end: { tex: 'rough_timber', scale: 0.22, color: '#e4c9a0', vertexColors: true },
  ct_bark: { tex: 'bark_spruce', scale: [0.6, 0.8], color: '#a89888', vertexColors: true },
  ct_firewood_ext: { tex: 'rough_timber', scale: 0.6, color: '#bca07c', vertexColors: true, exterior: true },
  ct_firewood_end_ext: { tex: 'rough_timber', scale: 0.22, color: '#d8bc92', vertexColors: true, exterior: true },
  ct_bark_ext: { tex: 'bark_spruce', scale: [0.6, 0.8], vertexColors: true, exterior: true },
  ct_jar_red: { color: '#5c1418', roughness: 0.3 },
  ct_jar_plum: { color: '#2c1426', roughness: 0.3 },
  ct_jar_amber: { color: '#a8641e', roughness: 0.3 },
  ct_jar_green: { color: '#56662a', roughness: 0.3 },
  ct_jar_tomato: { color: '#b23a1c', roughness: 0.3 },
  ct_jar_lid: { color: '#9c8c5a', roughness: 0.45, metalness: 0.8 },
  ct_wax: { color: '#f0eadb', roughness: 0.45 },
  ct_wick: { color: '#151210', roughness: 0.9 },
  ct_votive: { color: '#7a0c0c', roughness: 0.12, emissive: '#ff3412', emissiveIntensity: 0.55 },
  ct_flame: { color: '#ffd296', emissive: '#ffb050', emissiveIntensity: 5 },
  ct_ember: { color: '#2a0c06', emissive: '#ff4a12', emissiveIntensity: 0.9 },
  ct_loden: { tex: 'fabric_green', scale: 0.5, color: '#545a46', vertexColors: true },
  ct_blanket: { tex: 'fabric_check', scale: 0.5, color: '#8c6e58', vertexColors: true },
  ct_linen: { tex: 'fabric_white', scale: 0.5, color: '#dcd6c6', vertexColors: true },
  ct_lace: { tex: 'fabric_white', scale: 0.25, color: '#ebe6da', vertexColors: true },
  ct_palm: { color: '#55623a', roughness: 0.9 },
  ct_corpus: { color: '#d2c4a0', roughness: 0.5 },
  ct_shingle_ext: { tex: 'rough_timber', scale: 1.2, color: '#7a7066', vertexColors: true, exterior: true, mossUp: 0.7 },
  ct_enamel_ext: { color: '#1e3a6a', roughness: 0.25, exterior: true },
  ct_enamel_white_ext: { color: '#e8e4da', roughness: 0.25, exterior: true },
  ct_soot_ext: { color: '#141210', roughness: 0.95, exterior: true },
};

function defineMaterials(m: MaterialLibrary): void {
  for (const [k, v] of Object.entries(MATS)) if (!m.has(k)) m.define(k, v);
}

// ============================================================================ small helpers
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
type N3 = number[];

function cross(a: N3, b: N3, c: N3): N3 {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}
const dot3 = (a: N3, b: N3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Quad (corners in order round the polygon) wound to face `n`. */
function quadN(mb: MeshBuilder, mat: string, a: N3, b: N3, c: N3, d: N3, n: N3): void {
  if (dot3(cross(a, b, c), n) < 0) mb.quad(mat, a, d, c, b, n);
  else mb.quad(mat, a, b, c, d, n);
}

/** Convex polygon (fan) wound to face `n`. World-projected UVs. */
function polyN(mb: MeshBuilder, mat: string, pts: N3[], n: N3): void {
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1];
    if (dot3(cross(a, b, c), n) < 0) mb.tri(mat, a, c, b);
    else mb.tri(mat, a, b, c);
  }
}

/** Static box collider given in a yawed ground frame. */
function frameBox(physics: Physics | undefined, f: Frame2, lx: number, cy: number, lz: number, hx: number, hy: number, hz: number, ry = 0, surface = 'stone'): void {
  if (!physics) return;
  const [x, z] = frameToWorld(f, lx, lz);
  physics.addBox({ cx: x, cy, cz: z, hx, hy, hz, ry: f.yaw + ry, surface });
}

/** Simple four-legged table (top, apron, legs) in a local frame at floor level. */
function table(mb: MeshBuilder, x: number, y: number, z: number, ry: number, w: number, d: number, h: number, top: string, legs: string, cloth?: string): void {
  mb.pushTRS(x, y, z, ry);
  mb.box(top, 0, h - 0.018, 0, w, 0.036, d, { uv: 'local' });
  mb.box(legs, 0, h - 0.085, d / 2 - 0.05, w - 0.12, 0.1, 0.022, { uv: 'local' });
  mb.box(legs, 0, h - 0.085, -d / 2 + 0.05, w - 0.12, 0.1, 0.022, { uv: 'local' });
  mb.box(legs, w / 2 - 0.05, h - 0.085, 0, 0.022, 0.1, d - 0.12, { uv: 'local' });
  mb.box(legs, -w / 2 + 0.05, h - 0.085, 0, 0.022, 0.1, d - 0.12, { uv: 'local' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mb.box(legs, sx * (w / 2 - 0.06), (h - 0.036) / 2, sz * (d / 2 - 0.06), 0.05, h - 0.036, 0.05, { uv: 'local', uvRotate: true });
  }
  if (cloth) {
    // oilcloth draped over the top with a short drop on all sides
    mb.box(cloth, 0, h + 0.002, 0, w + 0.06, 0.004, d + 0.06, { uv: 'local' });
    for (const s of [-1, 1]) {
      mb.box(cloth, 0, h - 0.06, s * (d / 2 + 0.03), w + 0.06, 0.12, 0.004, { uv: 'local' });
      mb.box(cloth, s * (w / 2 + 0.03), h - 0.06, 0, 0.004, 0.12, d + 0.06, { uv: 'local' });
    }
  }
  mb.pop();
}

/**
 * Stack of split firewood in a local frame: logs run along local z (length `len`, front ends
 * at z = +len/2), the stack spans x ∈ [x0, x1] from y0 to ~y0 + height. Hidden back ends skipped.
 */
function logStack(mb: MeshBuilder, rng: RNG, x0: number, x1: number, y0: number, height: number, len: number, mats: { end: string; split: string; bark: string }, ragged = true): void {
  let y = y0;
  let layer = 0;
  while (y < y0 + height - 0.05) {
    const lh = rng.range(0.085, 0.12);
    // ragged top: the last layers do not reach the ends
    const top = y + lh > y0 + height - 0.25;
    const xa = x0 + (ragged && top ? rng.range(0, 0.6) : 0), xb = x1 - (ragged && top ? rng.range(0, 0.6) : 0);
    let x = xa + (layer % 2) * 0.04;
    while (x < xb - 0.06) {
      const lw = Math.min(rng.range(0.085, 0.14), xb - x);
      const shade = rng.range(0.72, 1.05);
      mb.withColor([shade, shade * rng.range(0.95, 1.0), shade * rng.range(0.88, 0.98)], () => {
        mb.pushTRS(x + lw / 2, y + lh / 2, rng.range(-0.025, 0.02), 0, 1, 1, 1, 0, rng.range(-0.35, 0.35));
        const side = rng.chance(0.5) ? mats.bark : mats.split;
        const m: BoxMats = { pz: mats.end, nz: null, px: side, nx: mats.split, py: rng.chance(0.4) ? mats.bark : mats.split, ny: mats.split };
        mb.box(m, 0, 0, 0, lw * 0.96, lh * 0.94, len + rng.range(-0.02, 0.02), { uv: 'local', uvOffset: [rng.float() * 4, rng.float() * 4] });
        mb.pop();
      });
      x += lw;
    }
    y += lh * 0.97;
    layer++;
  }
}

// ============================================================================ canvas decals
const FONT_ROUND = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive';
const FONT_NEAT = '"Segoe Script", "Bradley Hand", "Apple Chancery", "URW Chancery L", cursive';
const FONT_SIGN = '"DIN Alternate", "Arial Narrow", Arial, Helvetica, sans-serif';

/** Plane with a canvas-drawn texture (browser only – returns null in headless builds). */
function canvasMesh(w: number, h: number, ppm: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, o: { exterior?: boolean; transparent?: boolean; rough?: number } = {}): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.min(1024, Math.round(w * ppm)));
  c.height = Math.max(16, Math.min(1024, Math.round(h * ppm)));
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardNodeMaterial();
  const A = texture(tex, uv());
  mat.colorNode = A;
  mat.roughnessNode = float(o.rough ?? 0.6);
  if (o.transparent) {
    mat.transparent = true;
    mat.opacityNode = A.a;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
  }
  if (o.exterior) mat.userData.exterior = true;
  else (mat as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  m.castShadow = false;
  return m;
}

function placeDecal(group: THREE.Group, m: THREE.Mesh | null, x: number, y: number, z: number, yaw: number, roll = 0): void {
  if (!m) return;
  m.position.set(x, y, z);
  m.rotation.set(0, yaw, roll, 'YXZ');
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  group.add(m);
}

// ============================================================================ main builder
export function buildCaretaker(physics: Physics | undefined, materials: MaterialLibrary, heightAt: (x: number, z: number) => number): BuildingOutput {
  defineMaterials(materials);
  const kit = new BuildingKit('caretaker', physics, FACADE);
  const mb = kit.mb;

  defineRooms(kit);
  kit.buildRoomSurfaces();
  const ops = buildWalls(kit);
  hangDoors(kit, ops);
  buildStairsAndVoids(mb, physics);
  const roof = buildRoofs(mb, physics);
  buildGables(mb, physics, roof.main.ridgeY);
  buildChimneyStack(mb, physics, roof.main.ridgeY);
  buildExterior(mb, physics, ops);
  buildKitchen(kit, physics);
  buildLiving(mb, physics);
  buildSmallRooms(kit, physics);
  buildCellar(mb, physics);
  buildAttic(mb, physics);

  // ---------------------------------------------------------------- lights (generator power)
  kit.light({ id: 'light:caretaker_kitchen', position: V(29.9, Gc - 0.55, 2.95), kind: 'bulb', working: true, flicker: 0.2, color: 0xffbd78, intensity: 3, room: 'ct_kitchen' });
  kit.light({ id: 'light:caretaker_living', position: V(28.95, Gc - 0.62, 5.55), kind: 'pendant', working: false, flicker: 0, room: 'ct_living' });
  kit.light({ id: 'light:caretaker_bedroom', position: V(33.3, Gc - 0.45, 6.05), kind: 'bulb', working: false, flicker: 0, room: 'ct_bedroom' });
  kit.light({ id: 'light:caretaker_hall', position: V(31.36, Gc - 0.4, 6.1), kind: 'bulb', working: false, flicker: 0, room: 'ct_hall' });
  kit.light({ id: 'light:caretaker_larder', position: V(32.9, Gc - 0.4, 3.1), kind: 'bulb', working: false, flicker: 0, room: 'ct_larder' });
  kit.light({ id: 'light:caretaker_cellar_n', position: V(30.1, CC - 0.32, 2.9), kind: 'bulb', working: false, flicker: 0, room: 'ct_cellar_n' });
  kit.light({ id: 'light:caretaker_cellar_s', position: V(31.6, CC - 0.32, 6.1), kind: 'bulb', working: false, flicker: 0, room: 'ct_cellar_s' });
  kit.light({ id: 'light:caretaker_attic', position: V(31.8, C.RIDGE - 0.35 - 0.6, 4.5), kind: 'bulb', working: false, flicker: 0, room: 'ct_attic' });
  kit.light({ id: 'light:caretaker_porch', position: V(31.4, 2.33, 8.95), kind: 'bulb', working: false, flicker: 0, room: 'ct_porch' });

  // ---------------------------------------------------------------- interior spans (snapped to the 0.25 m interior grid)
  kit.span({ x0: 27.25, z0: 1.25, x1: 34.75, z1: 7.75, floorY: C0 - 0.05, ceil: (x, z) => roof.main.innerHeight(x, z) });
  kit.span({ x0: 30.0, z0: 7.75, x1: 32.75, z1: 9.75, floorY: C.CRAWL.y0 - 0.05, ceil: (x, z) => roof.porch.innerHeight(x, z) });

  // ---------------------------------------------------------------- anchors
  const S = CARETAKER_SPOTS;
  kit.anchor('key_manor_front', S.keyBoard.x + 0.04, S.keyBoard.y - 0.07, S.keyBoard.z + 0.04, 0, 'ct_kitchen');
  kit.anchor('caretaker_stove', S.stove.x, G0 + 0.6, S.stove.z - 0.35, Math.PI, 'ct_kitchen');
  kit.anchor('caretaker_votive', IX0 + 0.2 * Math.SQRT1_2, G0 + 1.65, IZ1 - 0.2 * Math.SQRT1_2, 3 * Math.PI / 4, 'ct_living');
  kit.anchor('caretaker_crawlspace', S.crawl.x, C.CRAWL.y0, S.crawl.z, 0, 'ct_crawl');

  const group = new THREE.Group();
  group.name = 'caretaker';
  group.add(mb.build(materials, { name: 'caretaker_house' }));
  addHouseDecals(group);

  // ---------------------------------------------------------------- grounds
  const gm = new MeshBuilder();
  buildGateAndWalls(gm, physics, heightAt, group);
  buildMailbox(gm, kit, heightAt, group);
  group.add(gm.build(materials, { name: 'caretaker_gate' }));

  const sm = new MeshBuilder();
  buildWoodshed(sm, kit, physics, heightAt);
  group.add(sm.build(materials, { name: 'caretaker_woodshed' }));

  return kit.output(group);
}

// ============================================================================ rooms
function defineRooms(kit: BuildingKit): void {
  const stone = 'stone_wall_int';
  // cellar (granite rubble, timber joist ceiling)
  kit.room({ id: 'ct_cellar_n', location: 'caretaker_cellar', x0: IX0, z0: IZ0, x1: IX1, z1: MZ - 0.15, y0: C0, y1: CC, floor: 'brick_int', ceiling: 'rough_timber', ceilVoids: [STAIR_VOID], wall: stone, env: 'basement', floorSurface: 'stone' });
  kit.room({ id: 'ct_cellar_s', location: 'caretaker_cellar', x0: IX0, z0: MZ + 0.15, x1: IX1, z1: IZ1, y0: C0, y1: CC, floor: 'concrete_int', ceiling: 'rough_timber', wall: stone, env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'ct_crawl', location: 'caretaker_cellar', x0: C.CRAWL.x0, z0: C.CRAWL.z0, x1: C.CRAWL.x1, z1: C.CRAWL.z1, y0: C.CRAWL.y0, y1: C.CRAWL.y1, floor: 'ct_earth', ceiling: 'rough_timber', wall: stone, env: 'tunnel', floorSurface: 'mud', slab: 0.3 });
  // ground floor
  kit.room({ id: 'ct_kitchen', location: 'caretaker_kitchen', x0: IX0, z0: IZ0, x1: KX - 0.075, z1: MZ - 0.125, y0: G0, y1: Gc, floor: 'floor_boards', ceiling: 'ct_whitewash', ceilVoids: [HATCH], wall: { mat: 'ct_kitchen_wall', dado: { mat: 'oil_dado', h: 1.25 } }, skirting: null, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'ct_larder', location: 'caretaker_kitchen', x0: KX + 0.075, z0: IZ0, x1: IX1, z1: MZ - 0.125, y0: G0, y1: Gc, floor: 'brick_int', ceiling: 'ct_whitewash', voids: [STAIR_VOID], wall: 'ct_whitewash', skirting: null, env: 'room_small', floorSurface: 'stone' });
  kit.room({ id: 'ct_hall', location: 'caretaker_living', x0: HX + 0.075, z0: MZ + 0.125, x1: KX - 0.075, z1: IZ1, y0: G0, y1: Gc, floor: 'floor_tiles', ceiling: 'ct_whitewash', wall: { mat: 'ct_whitewash', dado: { mat: 'oil_dado_brown', h: 1.2 } }, skirting: null, env: 'room_small', floorSurface: 'tile' });
  kit.room({ id: 'ct_living', location: 'caretaker_living', x0: IX0, z0: MZ + 0.125, x1: HX - 0.075, z1: IZ1, y0: G0, y1: Gc, floor: 'floor_boards_dark', ceiling: 'ct_boards_ceiling', wall: { mat: 'ct_living_wall', dado: { mat: 'wainscot', h: 1.0 } }, skirting: 'painted_wood_brown', env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'ct_bedroom', location: 'caretaker_bedroom', x0: KX + 0.075, z0: MZ + 0.125, x1: IX1, z1: IZ1, y0: G0, y1: Gc, floor: 'floor_boards', ceiling: 'ct_whitewash', wall: 'plaster_int_blue', skirting: 'painted_wood_white', env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'ct_porch', location: 'caretaker_living', x0: PIX0, z0: P.z0, x1: PIX1, z1: PIZ1, y0: P.y, y1: 2.55, floor: 'floor_tiles', ceiling: null, wall: { mat: 'ct_porch_wall', dado: { mat: 'oil_dado', h: 1.0 } }, skirting: null, env: 'room_small', floorSurface: 'tile', slab: 0.2 });
  // attic (one space under the roof, boarded floor)
  kit.room({ id: 'ct_attic', location: 'caretaker_attic', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: A0, y1: C.RIDGE - 0.35, floor: 'barn_boards_int', ceiling: null, voids: [HATCH], wall: stone, skirting: null, env: 'attic', floorSurface: 'wood_old', slab: A0 - Gc });
}

// ============================================================================ walls
interface WinOp { o: Opening; opts: Partial<WindowOpts> }
interface DoorOp { o: Opening; frame?: string | null }
/** Openings by id, resolved to the wall segment that holds them (o.at relative to that segment). */
type OpMap = Map<string, { f: WallFrame; o: Opening; ext: boolean; kind: 'window' | 'door' }>;

/**
 * Wall split into segments at `cuts` (distances from a) so each segment's inner face takes the
 * finish of the room behind it. Openings are assigned to the segment containing their centre.
 */
function segWall(kit: BuildingKit, ops: OpMap, base: Omit<KitWall, 'a' | 'b' | 'windows' | 'doors' | 'ext0' | 'ext1'>, a: [number, number], b: [number, number], cuts: number[], ext: [number, number], windows: WinOp[], doors: DoorOp[], exterior: boolean, skirtFloor?: number): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  const stops = [0, ...cuts, len];
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i], s1 = stops[i + 1];
    const inSeg = (o: Opening) => o.at >= s0 && o.at < s1;
    const w = windows.filter((x) => inSeg(x.o)).map((x) => ({ o: { ...x.o, at: x.o.at - s0 }, opts: x.opts }));
    const d = doors.filter((x) => inSeg(x.o)).map((x) => ({ o: { ...x.o, at: x.o.at - s0 }, frame: x.frame }));
    const pa: [number, number] = [a[0] + dx * s0, a[1] + dz * s0], pb: [number, number] = [a[0] + dx * s1, a[1] + dz * s1];
    const f = kit.wall({ ...base, a: pa, b: pb, ext0: i === 0 ? ext[0] : 0, ext1: i === stops.length - 2 ? ext[1] : 0, windows: w, doors: d, ...(skirtFloor !== undefined ? { skirting: false } : {}) });
    for (const x of w) if (x.o.id) ops.set(x.o.id, { f, o: x.o, ext: exterior, kind: 'window' });
    for (const x of d) if (x.o.id) ops.set(x.o.id, { f, o: x.o, ext: exterior, kind: 'door' });
    // exterior walls start below the floor slab: lay their skirting at the real floor level
    if (skirtFloor !== undefined) {
      const off = -(base.t / 2 + 0.15);
      const r = kit.roomAt(pa[0] + dx * (s1 - s0) / 2 + dz * off * -1, pa[1] + dz * (s1 - s0) / 2 + dx * off, skirtFloor + 0.5);
      if (r?.skirting) {
        const shift = skirtFloor - base.y0;
        buildSkirting(kit.mb, { a: pa, b: pb, y0: skirtFloor, y1: base.y1, t: base.t, openings: d.map((x) => ({ ...x.o, bottom: x.o.bottom - shift, top: x.o.top - shift })) }, 'left', r.skirting);
      }
    }
  }
}

function buildWalls(kit: BuildingKit): OpMap {
  const ops: OpMap = new Map();
  const yC = { y0: C0, y1: CC }, yG = { y0: CC, y1: Gc }, yA = { y0: Gc, y1: C.EAVE };
  const extC = { ...yC, t: T, cap: 'stone_wall_int', surface: 'stone', noTop: true, right: { mat: 'stone_wall' }, skirting: false };
  const extG = { ...yG, t: T, cap: 'ct_whitewash', surface: 'stone', noTop: true, right: 'ext' as const };
  const extA = { ...yA, t: T, cap: 'ct_plaster_ext', surface: 'stone', noTop: false, right: { mat: 'ct_plaster_ext' }, skirting: false };
  const e2: [number, number] = [T / 2, T / 2];
  const sill = 1.3 - CC, head = 2.45 - CC;
  const win = (id: string, at: number, w = 0.85, extra: Partial<WindowOpts> = {}): WinOp => ({
    o: { id, at, width: w, bottom: sill, top: head, kind: 'window' },
    opts: { style: 'kasten', sillOut: null, frameMat: 'painted_wood_white_ext', broken: 0, muntins: true, ...extra },
  });
  const door = (id: string, at: number, w: number, h: number, frame: string | null = 'painted_wood_brown'): DoorOp => ({ o: { id, at, width: w, bottom: G0 - CC, top: G0 - CC + h, kind: 'door' }, frame });

  // exterior walls run clockwise (seen from above) so their RIGHT side is outside
  // south (front, west → east)
  const sA: [number, number] = [WX0, WZ1], sB: [number, number] = [WX1, WZ1];
  // crawl-space opening (hands and knees, 0.75 m) in the cellar's south wall → under the porch
  const crawlO: Opening = { id: 'crawl', at: C.CRAWL.x0 + 1.25 - WX0, width: 0.8, bottom: C.CRAWL.y0 - C0, top: C.CRAWL.y1 - C0, kind: 'hole' };
  segWall(kit, ops, { ...extC, openings: [crawlO] }, sA, sB, [], e2, [], [], true);
  segWall(kit, ops, extG, sA, sB, [HX - WX0, KX - WX0], e2,
    [win('w_living_s', 28.6 - WX0), win('w_bed_s', 33.75 - WX0)],
    [door('d_front', 31.36 - WX0, 0.95, 2.05)], true, G0);
  segWall(kit, ops, extA, sA, sB, [], e2, [], [], true);
  // east (south → north)
  const eA: [number, number] = [WX1, WZ1], eB: [number, number] = [WX1, WZ0];
  segWall(kit, ops, extC, eA, eB, [WZ1 - MZ], e2, [], [], true);
  segWall(kit, ops, extG, eA, eB, [WZ1 - MZ], e2, [], [], true, G0);
  segWall(kit, ops, extA, eA, eB, [], e2, [], [], true);
  // north (east → west)
  const nA: [number, number] = [WX1, WZ0], nB: [number, number] = [WX0, WZ0];
  segWall(kit, ops, extC, nA, nB, [], e2, [], [], true);
  segWall(kit, ops, extG, nA, nB, [WX1 - KX], e2,
    [win('w_kitchen_n', WX1 - 29.0), { o: { id: 'w_larder', at: WX1 - 33.15, width: 0.45, bottom: 1.55 - CC, top: 2.1 - CC, kind: 'window' }, opts: { style: 'single', sillOut: null, frameMat: 'painted_wood_white_ext', muntins: false, broken: 0 } }],
    [door('d_back', WX1 - 30.9, 0.95, 2.0)], true, G0);
  segWall(kit, ops, extA, nA, nB, [], e2, [], [], true);
  // west (north → south)
  const wA: [number, number] = [WX0, WZ0], wB: [number, number] = [WX0, WZ1];
  segWall(kit, ops, extC, wA, wB, [MZ - WZ0], e2, [], [], true);
  segWall(kit, ops, extG, wA, wB, [MZ - WZ0], e2, [win('w_living_w', 6.0 - WZ0)], [], true, G0);
  segWall(kit, ops, extA, wA, wB, [], e2, [], [], true);

  // ---- interior partitions (ground floor; sit on the floor like the manor's)
  const iw = (a: [number, number], b: [number, number], t: number, doors: { id: string; at: number; w: number; h?: number }[]) =>
    kit.wall({ a, b, y0: G0, y1: Gc, t, noTop: true, cap: 'ct_whitewash', surface: 'stone', doors: doors.map((d) => ({ o: { id: d.id, at: d.at, width: d.w, bottom: 0, top: d.h ?? 2.02, kind: 'door' as const }, frame: 'painted_wood_brown' })) });
  const reg = (f: WallFrame, id: string, at: number, w: number, h = 2.02) => ops.set(id, { f, o: { id, at, width: w, bottom: 0, top: h, kind: 'door' }, ext: false, kind: 'door' });
  const fC = iw([IX0, MZ], [IX1, MZ], 0.25, [{ id: 'd_kitchen', at: 31.35 - IX0, w: 0.85 }]);
  reg(fC, 'd_kitchen', 31.35 - IX0, 0.85);
  const fL = iw([KX, IZ0], [KX, MZ - 0.125], 0.15, [{ id: 'd_larder', at: 2.1 - IZ0, w: 0.75 }]);
  reg(fL, 'd_larder', 2.1 - IZ0, 0.75);
  const fHW = iw([HX, MZ + 0.125], [HX, IZ1], 0.15, [{ id: 'd_living', at: 6.55 - (MZ + 0.125), w: 0.8 }]);
  reg(fHW, 'd_living', 6.55 - (MZ + 0.125), 0.8);
  const fHE = iw([KX, MZ + 0.125], [KX, IZ1], 0.15, [{ id: 'd_bedroom', at: 5.1 - (MZ + 0.125), w: 0.8 }]);
  reg(fHE, 'd_bedroom', 5.1 - (MZ + 0.125), 0.8);

  // ---- cellar spine wall with an open doorway (no leaf)
  kit.wall({ a: [IX0, MZ], b: [IX1, MZ], y0: C0, y1: CC, t: 0.3, noTop: true, cap: 'stone_wall_int', surface: 'stone', doors: [{ o: { at: 28.7 - IX0, width: 0.9, bottom: 0, top: 1.88, kind: 'door' }, frame: 'rough_timber', architrave: false }] });

  // ---- porch (1960s brick, grey render) on a concrete foundation round the crawl space
  const pExt = { mat: 'ct_plaster_grey_ext', dado: { mat: 'concrete', h: 0.25 } };
  const pG = { y0: 0.1, y1: P.eave, t: PT, cap: 'ct_plaster_grey_ext', surface: 'stone', noTop: true, right: pExt };
  const pC = { y0: C.CRAWL.y0 - 0.15, y1: 0.1, t: PT, cap: 'concrete_int', surface: 'stone', noTop: true, right: { mat: 'concrete' }, skirting: false };
  const pwin = (id: string, at: number, w: number, bottom: number, top: number): WinOp => ({ o: { id, at, width: w, bottom: bottom - 0.1, top: top - 0.1, kind: 'window' }, opts: { style: 'single', sillOut: 'painted_metal_ext', frameMat: 'painted_wood_white_ext', muntins: true, broken: 0 } });
  // south (west → east)
  segWall(kit, ops, pG, [PWX0, PWZ1], [PWX1, PWZ1], [], [PT / 2, PT / 2],
    [pwin('pw_s1', 30.42 - PWX0, 0.4, 1.0, 2.05), pwin('pw_s2', 32.3 - PWX0, 0.4, 1.0, 2.05)],
    [{ o: { id: 'd_porch', at: 31.36 - PWX0, width: 0.95, bottom: P.y - 0.1, top: P.y - 0.1 + 2.0, kind: 'door' }, frame: 'painted_wood_brown' }], true);
  segWall(kit, ops, pC, [PWX0, PWZ1], [PWX1, PWZ1], [], [PT / 2, PT / 2], [], [], true);
  // east (south → north), ends at the house wall
  segWall(kit, ops, pG, [PWX1, PWZ1], [PWX1, P.z0], [], [PT / 2, 0], [pwin('pw_e', PWZ1 - 9.0, 0.7, 0.95, 2.1)], [], true);
  segWall(kit, ops, pC, [PWX1, PWZ1], [PWX1, P.z0], [], [PT / 2, 0], [], [], true);
  // west (north → south)
  segWall(kit, ops, pG, [PWX0, P.z0], [PWX0, PWZ1], [], [0, PT / 2], [pwin('pw_w', 9.0 - P.z0, 0.7, 0.95, 2.1)], [], true);
  segWall(kit, ops, pC, [PWX0, P.z0], [PWX0, PWZ1], [], [0, PT / 2], [], [], true);
  return ops;
}

// ============================================================================ doors
function hangDoors(kit: BuildingKit, ops: OpMap): void {
  const get = (id: string) => ops.get(id)!;
  const panel = { style: 'panel2' as const, mat: 'painted_wood_brown', handle: 'lever' as const };
  const D = (id: string, op: string, leaf: Parameters<BuildingKit['doorInWall']>[3], hinge: 1 | -1, swing: 1 | -1, extra: Parameters<BuildingKit['doorInWall']>[6] = {}) => {
    const { f, o } = get(op);
    kit.doorInWall(id, f, o, leaf, hinge, swing, extra);
  };
  // porch door (1960s, glazed) – the locked front door
  D('door:caretaker_porch', 'd_porch', { style: 'glazed', mat: 'painted_wood_brown_ext', handle: 'lever' }, 1, -1, { locked: true, key: 'key_caretaker', sound: 'wood', room: 'ct_porch' });
  // old house door between porch and hall: closed, not locked, opens out into the porch
  D('door:caretaker_front', 'd_front', { style: 'panel4', mat: 'painted_wood_brown_ext', handle: 'knob' }, -1, 1, { sound: 'wood', room: 'ct_hall', maxOpen: 1.6 });
  // kitchen back door to the yard and the woodshed path: stands ajar
  D('door:caretaker_back', 'd_back', { style: 'ledged', mat: 'painted_wood_green', handle: 'lever', handleMat: 'rust_metal_int', seed: 5 }, -1, -1, { open: 0.65, sound: 'wood', room: 'ct_kitchen' });
  // opens into the hall (into the kitchen it would sweep through the Kredenz)
  D('door:caretaker_kitchen', 'd_kitchen', panel, -1, 1, { open: 1.45, maxOpen: 1.6, room: 'ct_hall' });
  D('door:caretaker_larder', 'd_larder', { style: 'ledged', mat: 'painted_wood_white', handle: 'lever', seed: 2 }, -1, -1, { open: 0.3, maxOpen: 1.55, room: 'ct_larder' });
  D('door:caretaker_living', 'd_living', panel, 1, 1, { open: 0.9, maxOpen: 1.5, room: 'ct_living' });
  D('door:caretaker_bedroom', 'd_bedroom', panel, 1, -1, { open: 0.2, maxOpen: 1.5, room: 'ct_bedroom' });
}

// ============================================================================ stairs
interface StairSpec { x: number; z: number; y: number; dir: number; width: number; rise: number; steps: number; run: number; tread: string; riser: string | null; stringer: string; surface: string; rails?: number[] }

/** Straight flight (open or closed risers, proper stringers on edge) with a ramp collider. */
function stair(mb: MeshBuilder, physics: Physics | undefined, d: StairSpec): void {
  const sh = d.rise / d.steps, len = d.run * d.steps;
  mb.pushTRS(d.x, d.y, d.z, d.dir);
  for (let i = 0; i < d.steps; i++) {
    const y = (i + 1) * sh;
    mb.box(d.tread, 0, y - 0.02, -(i + 0.5) * d.run - 0.01, d.width, 0.04, d.run + 0.03, { uv: 'local', uvOffset: [i * 0.37, i * 0.11] });
    if (d.riser) mb.box(d.riser, 0, y - sh / 2 - 0.02, -i * d.run + 0.005, d.width - 0.01, sh - 0.04, 0.02, { uv: 'local' });
  }
  for (const sx of [-d.width / 2 - 0.025, d.width / 2 + 0.025]) {
    mb.beam(d.stringer, V(sx, 0.08, 0.05), V(sx, d.rise + 0.08, -len), 0.045, 0.22, V(0, 1, 0));
  }
  for (const s of d.rails ?? []) {
    const x = s * (d.width / 2 + 0.03);
    mb.beam(d.stringer, V(x, 0.92, 0.0), V(x, d.rise + 0.92, -len), 0.045, 0.045, V(0, 1, 0));
    for (const t of [0, 0.5, 1]) mb.box(d.stringer, x, t * d.rise + 0.5 + 0.06, -t * len, 0.045, 0.9, 0.045, { uv: 'local' });
  }
  mb.pop();
  if (physics) {
    const slopeLen = Math.hypot(len, d.rise);
    const ang = Math.atan2(d.rise, len);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, d.dir, 0, 'YXZ'));
    const c = V(0, d.rise / 2 - 0.05, -len / 2).applyAxisAngle(V(0, 1, 0), d.dir);
    physics.addBox({ cx: d.x + c.x, cy: d.y + c.y, cz: d.z + c.z, hx: d.width / 2, hy: 0.05, hz: slopeLen / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: d.surface });
  }
}

function buildStairsAndVoids(mb: MeshBuilder, physics: Physics | undefined): void {
  // steep cellar stair along the larder's east wall, descending south (45°)
  const cw = 0.82, cx = IX1 - 0.03 - cw / 2;
  stair(mb, physics, { x: cx, z: 4.2, y: C0, dir: 0, width: cw, rise: G0 - C0, steps: 12, run: 0.205, tread: 'rough_timber', riser: 'rough_timber', stringer: 'rough_timber', surface: 'wood_old' });
  // wall handrail on the east wall (iron brackets)
  const hx = IX1 - 0.06;
  mb.rod('rough_timber', V(hx, C0 + 0.95, 4.15), V(hx, G0 + 0.95, 1.8), 0.022, 0.022, 6);
  for (const t of [0.1, 0.5, 0.9]) {
    const z = 4.15 + (1.8 - 4.15) * t, y = C0 + 0.95 + (G0 - C0) * t;
    mb.box('ct_iron', IX1 - 0.03, y - 0.04, z, 0.06, 0.02, 0.02);
  }
  // timber balustrade along the open side of the stairwell (ground floor) and linings of the void
  balustrade(mb, physics, [[STAIR_VOID.x0, 2.55], [STAIR_VOID.x0, STAIR_VOID.z1]], G0, 'rough_timber', 0.95);
  mb.box('rough_timber', STAIR_VOID.x0 + 0.012, (CC + G0) / 2, (STAIR_VOID.z0 + STAIR_VOID.z1) / 2, 0.025, G0 - CC, STAIR_VOID.z1 - STAIR_VOID.z0, { uv: 'local' });
  mb.box('rough_timber', (STAIR_VOID.x0 + STAIR_VOID.x1) / 2, (CC + G0 - 0.05) / 2, STAIR_VOID.z0 + 0.012, STAIR_VOID.x1 - STAIR_VOID.x0, G0 - 0.05 - CC, 0.025, { uv: 'local' });

  // ladder-stair (Bodenstiege) from the kitchen up through the hatch, rising south along the west wall
  const lw = 0.6, steps = 13, run = 0.18;
  // (dir = π flips local x: rail −1 is the open east side)
  stair(mb, physics, { x: IX0 + 0.04 + lw / 2, z: HATCH.z1 - steps * run, y: G0, dir: Math.PI, width: lw, rise: A0 - G0, steps, run, tread: 'furniture_oak', riser: null, stringer: 'furniture_oak', surface: 'wood_old', rails: [-1] });
  // hatch linings (between kitchen ceiling and attic floor) and the rail round the hatch in the attic
  mb.box('rough_timber', HATCH.x1 - 0.012, (Gc + A0) / 2, (HATCH.z0 + HATCH.z1) / 2, 0.025, A0 - Gc, HATCH.z1 - HATCH.z0, { uv: 'local' });
  mb.box('rough_timber', (HATCH.x0 + HATCH.x1) / 2, (Gc + A0) / 2, HATCH.z0 + 0.012, HATCH.x1 - HATCH.x0, A0 - Gc, 0.025, { uv: 'local' });
  balustrade(mb, physics, [[HATCH.x0 + 0.02, HATCH.z0 - 0.04], [HATCH.x1 + 0.04, HATCH.z0 - 0.04], [HATCH.x1 + 0.04, HATCH.z1]], A0, 'rough_timber', 0.9);
  // the hatch lid, flipped over and lying on the boards beside the rail (battens up)
  mb.pushTRS(HATCH.x1 + 0.55, A0, (HATCH.z0 + HATCH.z1) / 2 + 0.05, 0.06);
  mb.box('rough_timber', 0, 0.02, 0, 0.8, 0.04, 1.9, { uv: 'local' });
  for (const z of [-0.65, 0, 0.65]) mb.box('rough_timber', 0, 0.055, z, 0.7, 0.03, 0.09, { uv: 'local' });
  mb.box('ct_iron', -0.38, 0.045, -0.5, 0.05, 0.01, 0.12);
  mb.box('ct_iron', -0.38, 0.045, 0.5, 0.05, 0.01, 0.12);
  mb.pop();

  // steps up to the crawl-space opening in the cellar (crouch here, crawl through)
  const sx0 = C.CRAWL.x0 + 0.85, sx1 = sx0 + 0.8;
  mb.boxMinMax('ct_granite_int', sx0, C0 - 0.05, 6.9, sx1, C0 + 0.275, IZ1);
  mb.boxMinMax('ct_granite_int', sx0, C0 + 0.27, 7.2, sx1, C.CRAWL.y0, IZ1);
  physics?.addBox({ cx: (sx0 + sx1) / 2, cy: C0 + 0.1125, cz: (6.9 + IZ1) / 2, hx: 0.4, hy: 0.1625, hz: (IZ1 - 6.9) / 2, surface: 'stone' });
  physics?.addBox({ cx: (sx0 + sx1) / 2, cy: (C0 + 0.275 + C.CRAWL.y0) / 2, cz: (7.2 + IZ1) / 2, hx: 0.4, hy: (C.CRAWL.y0 - C0 - 0.275) / 2, hz: (IZ1 - 7.2) / 2, surface: 'stone' });
}

// ============================================================================ roofs
function buildRoofs(mb: MeshBuilder, physics: Physics | undefined): { main: RoofInfo; porch: RoofInfo } {
  const main = buildRoof(mb, {
    type: 'gable', x0: C.X0, z0: C.Z0, x1: C.X1, z1: C.Z1, eaveY: C.EAVE, pitch: PITCH, overhang: C.OH, thickness: 0.24,
    tileMat: 'roof_tiles', innerMat: 'rough_timber', fasciaMat: 'painted_wood_brown_ext', gutterMat: 'rust_metal',
    rafters: { mat: 'rough_timber', spacing: 0.95, size: 0.14 },
  }, physics);
  // wall plates (Mauerbank) on the eaves walls close the gap between knee wall and roof
  for (const z of [C.Z0 + 0.35, C.Z1 - 0.35]) mb.box('rough_timber', (C.X0 + C.X1) / 2, C.EAVE + 0.07, z, C.X1 - C.X0 - 0.02, 0.14, 0.18, { uv: 'local' });

  const porch = buildRoof(mb, {
    type: 'shed', x0: P.x0, z0: P.z0, x1: P.x1, z1: P.z1, eaveY: P.eave, pitch: P.pitch, overhang: 0.25, thickness: 0.15, shedHigh: 'n',
    tileMat: 'corrugated', innerMat: 'painted_wood_white', fasciaMat: 'painted_wood_brown_ext', gutterMat: 'rust_metal', rafters: null,
  }, physics);
  // verge boards on the open sides of the lean-to roof
  const pt = Math.tan(P.pitch), vT = 0.15 / Math.cos(P.pitch);
  const top = (z: number) => P.eave + pt * (P.z1 - z);
  for (const x of [P.x0 - 0.25, P.x1 + 0.25]) {
    mb.beam('painted_wood_brown_ext', V(x, top(P.z1 + 0.25) - vT / 2, P.z1 + 0.25), V(x, top(P.z0) - vT / 2, P.z0), 0.03, vT + 0.06, V(0, 1, 0));
  }
  // side triangles of the porch walls up to the roof line
  for (const [xc, out] of [[PWX0, -1], [PWX1, 1]] as const) {
    for (const side of [1, -1]) {
      const x = xc + out * side * PT / 2;
      const n = [out * side, 0, 0];
      polyN(mb, side === 1 ? 'ct_plaster_grey_ext' : 'ct_porch_wall', [[x, P.eave, P.z1], [x, P.eave, P.z0], [x, top(P.z0), P.z0]], n);
    }
    physics?.addBox({ cx: xc, cy: (P.eave + top(P.z0)) / 2, cz: (P.z0 + P.z1) / 2, hx: PT / 2, hy: (top(P.z0) - P.eave) / 2, hz: (P.z1 - P.z0) / 2, surface: 'stone' });
  }
  return { main, porch };
}

// ============================================================================ gable ends (with attic window)
function buildGables(mb: MeshBuilder, physics: Physics | undefined, ridgeY: number): void {
  const eave = C.EAVE, z0 = C.Z0, z1 = C.Z1, zm = (z0 + z1) / 2;
  const tan = (ridgeY - eave) / (zm - z0);
  const zl = (y: number) => z0 + (y - eave) / tan, zr = (y: number) => z1 - (y - eave) / tan;
  const wz0 = zm - 0.3, wz1 = zm + 0.3, wy0 = eave + 0.42, wy1 = eave + 1.22;
  const polys: [number, number][][] = [
    [[zl(eave), eave], [zr(eave), eave], [zr(wy0), wy0], [zl(wy0), wy0]],
    [[zl(wy0), wy0], [wz0, wy0], [wz0, wy1], [zl(wy1), wy1]],
    [[wz1, wy0], [zr(wy0), wy0], [zr(wy1), wy1], [wz1, wy1]],
    [[zl(wy1), wy1], [zr(wy1), wy1], [zm, ridgeY]],
  ];
  for (const [xc, out] of [[WX0, -1], [WX1, 1]] as const) {
    const xo = xc + out * T / 2, xi = xc - out * T / 2;
    for (const p of polys) {
      polyN(mb, 'ct_plaster_ext', p.map(([z, y]) => [xo, y, z]), [out, 0, 0]);
      polyN(mb, 'stone_wall_int', p.map(([z, y]) => [xi, y, z]), [-out, 0, 0]);
    }
    // reveals
    quadN(mb, 'ct_plaster_ext', [xo, wy0, wz0], [xi, wy0, wz0], [xi, wy0, wz1], [xo, wy0, wz1], [0, 1, 0]);
    quadN(mb, 'ct_plaster_ext', [xo, wy1, wz0], [xi, wy1, wz0], [xi, wy1, wz1], [xo, wy1, wz1], [0, -1, 0]);
    quadN(mb, 'ct_plaster_ext', [xo, wy0, wz0], [xi, wy0, wz0], [xi, wy1, wz0], [xo, wy1, wz0], [0, 0, 1]);
    quadN(mb, 'ct_plaster_ext', [xo, wy0, wz1], [xi, wy0, wz1], [xi, wy1, wz1], [xo, wy1, wz1], [0, 0, -1]);
    // window: frame along the gable with the exterior on its right
    const a: [number, number] = out < 0 ? [xc, z0] : [xc, z1], b: [number, number] = out < 0 ? [xc, z1] : [xc, z0];
    const f = wallFrame({ a, b, y0: eave, y1: ridgeY, t: T });
    const o: Opening = { at: Math.abs(zm - a[1]), width: wz1 - wz0, bottom: wy0 - eave, top: wy1 - eave, kind: 'window' };
    buildWindow(mb, f, o, { style: 'single', exterior: 1, frameMat: 'painted_wood_white_ext', broken: out < 0 ? 0.5 : 0, muntins: true, sillOut: null });
    graniteSurround(mb, f, o, false);
    physics?.addBox({ cx: xc, cy: (eave + ridgeY) / 2, cz: zm, hx: T / 2, hy: (ridgeY - eave) / 2, hz: (z1 - z0) / 2, surface: 'stone' });
  }
}

/** Granite window / door surround (Steingewände) on the outer face of a wall segment. */
function graniteSurround(mb: MeshBuilder, f: WallFrame, o: Opening, isDoor: boolean): void {
  const out = f.t / 2;
  const ry = -Math.atan2(f.dz, f.dx);
  const P3 = (s: number, y: number, d: number) => [f.ax + f.dx * s + f.rx * (out + d), f.y0 + y, f.az + f.dz * s + f.rz * (out + d)];
  const piece = (s0: number, s1: number, ya: number, yb: number, depth: number, mat = 'ct_granite') => {
    const c = P3((s0 + s1) / 2, (ya + yb) / 2, depth / 2 - 0.004);
    mb.pushTRS(c[0], c[1], c[2], ry);
    mb.box(mat, 0, 0, 0, s1 - s0, yb - ya, depth, { skip: ['nz'], uv: 'local' });
    mb.pop();
  };
  const fw = 0.13, a0 = o.at - o.width / 2, a1 = o.at + o.width / 2;
  const bottom = isDoor ? o.bottom : o.bottom - 0.02;
  piece(a0 - fw, a0, bottom, o.top + 0.15, 0.035);
  piece(a1, a1 + fw, bottom, o.top + 0.15, 0.035);
  piece(a0, a1, o.top, o.top + 0.15, 0.035);
  if (!isDoor) piece(a0 - fw - 0.04, a1 + fw + 0.04, o.bottom - 0.09, o.bottom + 0.0, 0.075);
}

// ============================================================================ chimney
function buildChimneyStack(mb: MeshBuilder, physics: Physics | undefined, ridgeY: number): void {
  const { x, z, sx, sz } = CHIM;
  const top = ridgeY + 0.75;
  // plastered stack through cellar and ground floor, bare brick in the attic, weathered brick above the tiles
  mb.box('ct_cellar_wash', x, (C0 + CC) / 2, z, sx, CC - C0, sz, { skip: ['py', 'ny'] });
  mb.box('ct_whitewash', x, (CC + Gc) / 2, z, sx, Gc - CC, sz, { skip: ['py', 'ny'] });
  mb.box('brick_int', x, (Gc + ridgeY - 0.75) / 2, z, sx, ridgeY - 0.75 - Gc, sz, { skip: ['py', 'ny'] });
  buildChimney(mb, x, z, ridgeY - 0.75, top, sx, sz, 'brick');
  physics?.addBox({ cx: x, cy: (C0 + top) / 2, cz: z, hx: sx / 2, hy: (top - C0) / 2, hz: sz / 2, surface: 'stone' });
  // soot door in the cellar (south face) – somebody swept it recently
  const zf = z + sz / 2;
  mb.box('ct_iron', x, C0 + 0.55, zf + 0.008, 0.2, 0.25, 0.016);
  mb.box('ct_iron', x + 0.06, C0 + 0.55, zf + 0.02, 0.03, 0.06, 0.012);
  mb.pushTRS(x + 0.05, C0, zf + 0.32);
  mb.lathe('black_soot', [[0.0, 0.045], [0.1, 0.035], [0.2, 0.012], [0.27, 0.0]], 12);
  mb.pop();
  quadN(mb, 'black_soot', [x - 0.16, C0 + 0.002, zf], [x + 0.2, C0 + 0.002, zf], [x + 0.25, C0 + 0.002, zf + 0.2], [x - 0.2, C0 + 0.002, zf + 0.25], [0, 1, 0]);
  // soot scoop lying next to it
  mb.pushTRS(x - 0.32, C0 + 0.01, zf + 0.35, 0.5);
  mb.box('rust_metal_int', 0, 0, 0, 0.16, 0.006, 0.2);
  mb.box('rust_metal_int', -0.08, 0.025, 0, 0.006, 0.05, 0.2);
  mb.box('rust_metal_int', 0.08, 0.025, 0, 0.006, 0.05, 0.2);
  mb.rod('rough_timber', V(0, 0.03, 0.1), V(0, 0.06, 0.38), 0.012, 0.012, 6);
  mb.pop();
}

// ============================================================================ exterior details
function buildExterior(mb: MeshBuilder, physics: Physics | undefined, ops: OpMap): void {
  const rng = new RNG('caretaker:exterior');
  // granite surrounds round the main house's ground-floor windows and doors
  for (const [id, op] of ops) {
    if (!op.ext || id.startsWith('pw_') || id === 'd_porch') continue;
    if (id === 'd_front') continue;                // inside the porch: plain reveal
    graniteSurround(mb, op.f, op.o, op.kind === 'door');
  }
  // painted granite quoins at the four corners
  for (const [cx, cz, sxn, szn] of [[C.X0, C.Z0, -1, -1], [C.X1, C.Z0, 1, -1], [C.X0, C.Z1, -1, 1], [C.X1, C.Z1, 1, 1]] as const) {
    let y = 0.62, k = 0;
    while (y < C.EAVE - 0.2) {
      const h = 0.3, long = k % 2 === 0;
      const lx = long ? 0.42 : 0.24, lz = long ? 0.24 : 0.42;
      mb.box('ct_granite', cx - sxn * lx / 2 + sxn * 0.012, y + h / 2, cz + szn * 0.012, lx + 0.024, h - 0.02, 0.024, { skip: [szn > 0 ? 'nz' : 'pz'], uv: 'local' });
      mb.box('ct_granite', cx + sxn * 0.012, y + h / 2, cz - szn * lz / 2 + szn * 0.012, 0.024, h - 0.02, lz + 0.024, { skip: [sxn > 0 ? 'nx' : 'px'], uv: 'local' });
      y += h; k++;
    }
  }
  // granite-paved strip ("Gred") either side of the porch: covers the terrain hole
  const gred = (x0: number, x1: number) => {
    buildSlab(mb, x0, P.z0, x1, C.ZF, 0.1, 0.6, null, null, physics, 'stone');
    // individual slabs with joints
    const nx = Math.max(1, Math.round((x1 - x0) / 0.62)), nz = 3;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = x0 + (i / nx) * (x1 - x0), b = x0 + ((i + 1) / nx) * (x1 - x0);
      const c = P.z0 + (j / nz) * (C.ZF - P.z0), d = P.z0 + ((j + 1) / nz) * (C.ZF - P.z0);
      const dy = rng.range(-0.012, 0.004);
      mb.box('ct_granite', (a + b) / 2, 0.1 - 0.04 + dy, (c + d) / 2, b - a - 0.012, 0.08, d - c - 0.012, { skip: ['ny'], uvOffset: [rng.float() * 3, rng.float() * 3] });
    }
    mb.box('ct_soot_ext', (x0 + x1) / 2, 0.035, (P.z0 + C.ZF) / 2, x1 - x0 - 0.01, 0.05, C.ZF - P.z0 - 0.01, { skip: ['ny'] });
    // edges down into the ground so the hole edge never shows
    const outerX = x0 <= C.X0 + 1e-3 ? x0 : x1;
    const nX = x0 <= C.X0 + 1e-3 ? -1 : 1;
    quadN(mb, 'ct_granite', [outerX, -0.6, P.z0], [outerX, -0.6, C.ZF], [outerX, 0.1, C.ZF], [outerX, 0.1, P.z0], [nX, 0, 0]);
    quadN(mb, 'ct_granite', [x0, -0.6, C.ZF], [x1, -0.6, C.ZF], [x1, 0.1, C.ZF], [x0, 0.1, C.ZF], [0, 0, 1]);
  };
  gred(C.X0, P.x0);
  gred(P.x1, C.X1);

  // porch step (outside the hole, on the terrain) and the back-door steps
  mb.boxMinMax('ct_granite', 30.86, -0.3, P.z1, 31.86, 0.175, P.z1 + 0.36);
  physics?.addBox({ cx: 31.36, cy: -0.0625, cz: P.z1 + 0.18, hx: 0.5, hy: 0.2375, hz: 0.18, surface: 'stone' });
  mb.boxMinMax('ct_granite', 30.32, -0.3, C.Z0 - 0.4, 31.48, G0 - 0.02, C.Z0);
  mb.boxMinMax('ct_granite', 30.37, -0.3, C.Z0 - 0.75, 31.43, 0.24, C.Z0 - 0.4);
  physics?.addBox({ cx: 30.9, cy: (G0 - 0.02 - 0.3) / 2, cz: C.Z0 - 0.2, hx: 0.58, hy: (G0 - 0.02 + 0.3) / 2, hz: 0.2, surface: 'stone' });
  physics?.addBox({ cx: 30.9, cy: (0.24 - 0.3) / 2, cz: C.Z0 - 0.575, hx: 0.53, hy: 0.27, hz: 0.175, surface: 'stone' });
  // boot scraper by the back door
  mb.box('ct_iron_ext', 31.75, 0.12, C.Z0 - 0.25, 0.25, 0.012, 0.012);
  mb.box('ct_iron_ext', 31.63, 0.06, C.Z0 - 0.25, 0.012, 0.13, 0.012);
  mb.box('ct_iron_ext', 31.87, 0.06, C.Z0 - 0.25, 0.012, 0.13, 0.012);

  // downpipes (gutters sit at eave − vThick − 0.02, 0.09 outside the overhang line)
  const gy = C.EAVE - C.OH * TAN - 0.24 / Math.cos(PITCH) - 0.02;
  const pipeDown = (x: number, zGutter: number, zWall: number, yEnd: number, zShoe: number) => {
    mb.rod('rust_metal', V(x, gy - 0.02, zGutter), V(x, gy - 0.35, zWall), 0.045, 0.045, 8);
    mb.rod('rust_metal', V(x, gy - 0.35, zWall), V(x, yEnd + 0.15, zWall), 0.045, 0.045, 8);
    mb.rod('rust_metal', V(x, yEnd + 0.15, zWall), V(x, yEnd, zShoe), 0.045, 0.045, 8);
    // pipe clips into the wall
    const face = zWall > (C.Z0 + C.Z1) / 2 ? C.Z1 : C.Z0;
    for (let y = yEnd + 0.5; y < gy - 0.5; y += 1.1) {
      mb.box('rust_metal', x, y, (face + zWall) / 2, 0.02, 0.025, Math.abs(zWall - face));
      mb.box('rust_metal', x, y, zWall, 0.11, 0.03, 0.11, { skip: ['py', 'ny'] });
    }
  };
  pipeDown(C.X0 + 0.15, C.Z1 + C.OH + 0.09, C.Z1 + 0.11, 1.0, C.Z1 + 0.35);      // over the rain barrel
  pipeDown(C.X1 - 0.15, C.Z1 + C.OH + 0.09, C.Z1 + 0.11, 0.14, C.Z1 + 0.35);
  pipeDown(C.X0 + 0.15, C.Z0 - C.OH - 0.09, C.Z0 - 0.11, 0.08, C.Z0 - 0.35);
  pipeDown(C.X1 - 0.15, C.Z0 - C.OH - 0.09, C.Z0 - 0.11, 0.08, C.Z0 - 0.35);
  // porch gutter → downpipe at the porch's south-east corner
  const pgy = P.eave - 0.25 * Math.tan(P.pitch) - 0.15 / Math.cos(P.pitch) - 0.02;
  mb.rod('rust_metal', V(P.x1 + 0.15, pgy - 0.02, P.z1 + 0.34), V(P.x1 + 0.15, 0.2, P.z1 + 0.34), 0.04, 0.04, 8);
  mb.rod('rust_metal', V(P.x1 + 0.15, 0.2, P.z1 + 0.34), V(P.x1 + 0.15, 0.06, P.z1 + 0.6), 0.04, 0.04, 8);

  // "Verwaltung" plate placeholder (enamel) above the porch door – texture drawn in addHouseDecals
  mb.box('ct_enamel_white_ext', 31.36, 2.39, P.z1 + 0.006, 0.34, 0.11, 0.008);
  // old outside lamp bracket over the porch door (no bulb)
  mb.box('ct_iron_ext', 31.95, 2.25, P.z1 + 0.06, 0.04, 0.04, 0.12);
  mb.pushTRS(31.95, 2.12, P.z1 + 0.14);
  mb.lathe('ct_enamel_white_ext', [[0.0, 0.1], [0.06, 0.09], [0.11, 0.0]], 10);
  mb.pop();
}

// ============================================================================ kitchen
function buildKitchen(kit: BuildingKit, physics: Physics | undefined): void {
  const mb = kit.mb;
  const S = CARETAKER_SPOTS;
  const rng = new RNG('caretaker:kitchen');
  // ---- Sparherd (wood-fired range), back against the chimney breast, front facing north
  const st = S.stove;
  mb.pushTRS(st.x, G0, st.z, Math.PI);
  const W = 1.1, D = 0.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box('ct_iron', sx * (W / 2 - 0.05), 0.05, sz * (D / 2 - 0.05), 0.06, 0.1, 0.06);
  mb.box('painted_metal_cream', 0, 0.45, 0, W - 0.02, 0.7, D - 0.04, { uv: 'local' });
  mb.box('ct_iron', 0, 0.12, 0.005, W, 0.04, D - 0.03);
  mb.box('ct_iron', 0, 0.82, 0, W + 0.04, 0.04, D + 0.02);
  // (the stove faces north, so local +x is world −x: firebox on the west side, next to the wood box)
  mb.cylinder('ct_iron', 0.28, 0.84, -0.02, 0.12, 0.12, 0.006, 16, 'top');
  mb.cylinder('ct_iron', 0.28, 0.846, -0.02, 0.075, 0.075, 0.006, 14, 'top');
  mb.cylinder('ct_iron', -0.12, 0.84, -0.02, 0.1, 0.1, 0.006, 16, 'top');
  // fire door with the glow of last night's embers in the draught slots, ash door below
  mb.box('ct_iron', 0.3, 0.6, D / 2, 0.26, 0.2, 0.02);
  for (const dy of [-0.045, 0, 0.045]) mb.box('ct_ember', 0.3, 0.6 + dy, D / 2 + 0.011, 0.13, 0.011, 0.004);
  mb.box('brass', 0.19, 0.6, D / 2 + 0.02, 0.012, 0.05, 0.02);
  mb.box('ct_iron', 0.3, 0.26, D / 2, 0.26, 0.09, 0.02);
  // oven door (right) with a chrome bar
  mb.box('painted_metal_cream', -0.22, 0.44, D / 2 - 0.005, 0.5, 0.38, 0.02, { uv: 'local' });
  mb.rod('chrome', V(-0.42, 0.6, D / 2 + 0.035), V(-0.02, 0.6, D / 2 + 0.035), 0.008, 0.008, 6);
  for (const hx of [-0.04, -0.4]) mb.box('chrome', hx, 0.6, D / 2 + 0.02, 0.012, 0.012, 0.03);
  // brass towel rail
  mb.rod('brass', V(-W / 2 + 0.02, 0.76, D / 2 + 0.06), V(W / 2 - 0.02, 0.76, D / 2 + 0.06), 0.008, 0.008, 6);
  for (const hx of [-W / 2 + 0.03, W / 2 - 0.03]) mb.box('brass', hx, 0.76, D / 2 + 0.03, 0.012, 0.012, 0.06);
  // flue pipe up and back into the chimney
  mb.cylinder('ct_iron', 0, 0.84, -0.17, 0.065, 0.065, 0.42, 12, 'none');
  mb.rod('ct_iron', V(0, 1.2, -0.17), V(0, 1.2, -0.42), 0.068, 0.068, 12, 'none');
  mb.cylinder('ct_iron', 0, 1.17, -0.17, 0.068, 0.068, 0.07, 12, 'top');
  mb.pop();
  physics?.addBox({ cx: st.x, cy: G0 + 0.42, cz: st.z, hx: W / 2 + 0.02, hy: 0.42, hz: D / 2, surface: 'metal' });

  // ---- wood box beside the stove, full of split logs, lid closed
  const wb = S.woodBox;
  mb.pushTRS(wb.x, G0, wb.z, Math.PI);
  mb.box('furniture_wood', 0, 0.26, -wb.d / 2 + 0.01, wb.w, 0.52, 0.02, { uv: 'local' });
  mb.box('furniture_wood', 0, 0.26, wb.d / 2 - 0.01, wb.w, 0.52, 0.02, { uv: 'local' });
  mb.box('furniture_wood', -wb.w / 2 + 0.01, 0.26, 0, 0.02, 0.52, wb.d - 0.04, { uv: 'local' });
  mb.box('furniture_wood', wb.w / 2 - 0.01, 0.26, 0, 0.02, 0.52, wb.d - 0.04, { uv: 'local' });
  mb.box('furniture_wood', 0, 0.02, 0, wb.w - 0.04, 0.02, wb.d - 0.04, { uv: 'local' });
  mb.box('furniture_wood', 0, 0.55, 0, wb.w + 0.02, 0.04, wb.d + 0.02, { uv: 'local' });
  mb.pop();
  // a few logs and kindling on the floor next to it
  for (let i = 0; i < 3; i++) {
    mb.withColor([rng.range(0.8, 1), rng.range(0.8, 1), rng.range(0.75, 0.95)], () => {
      mb.pushTRS(wb.x + 0.05 + rng.range(-0.12, 0.12), G0 + 0.05 + i * 0.002, wb.z - 0.42 + rng.range(-0.06, 0.06), rng.range(-0.5, 0.5), 1, 1, 1, 0, 0);
      mb.box({ pz: 'ct_firewood_end', nz: 'ct_firewood_end', default: rng.chance(0.5) ? 'ct_bark' : 'ct_firewood' }, 0, 0, 0, 0.1, 0.09, 0.33, { uv: 'local' });
      mb.pop();
    });
  }
  // charred scraps of newspaper by the stove door
  for (let i = 0; i < 4; i++) {
    // the fire door is on the stove's local +x = world −x side (stove faces north)
    const x = st.x - 0.3 + rng.range(-0.15, 0.2), z = st.z - 0.42 - rng.range(0, 0.18), r = rng.range(0.025, 0.05);
    quadN(mb, 'black_soot', [x - r, G0 + 0.003, z], [x, G0 + 0.003, z - r * rng.range(0.6, 1.2)], [x + r, G0 + 0.003, z], [x, G0 + 0.003, z + r], [0, 1, 0]);
  }
  physics?.addBox({ cx: wb.x, cy: G0 + 0.29, cz: wb.z, hx: wb.w / 2, hy: 0.29, hz: wb.d / 2, surface: 'wood' });

  // ---- kitchen table with oilcloth under the north window
  const kt = S.kitchenTable;
  table(mb, kt.x, G0, kt.z, 0, kt.w, kt.d, 0.78, 'furniture_wood', 'furniture_wood', 'ct_oilcloth');
  physics?.addBox({ cx: kt.x, cy: G0 + 0.4, cz: kt.z, hx: kt.w / 2, hy: 0.4, hz: kt.d / 2, surface: 'wood' });
  // bread board, a cup, a tin of matches on the table
  mb.box('furniture_oak', kt.x + 0.25, kt.top + 0.012, kt.z + 0.05, 0.3, 0.018, 0.2, { uv: 'local' });
  mb.pushTRS(kt.x - 0.2, kt.top + 0.004, kt.z - 0.1);
  mb.lathe('porcelain', [[0.0, 0.0], [0.03, 0.0], [0.038, 0.01], [0.042, 0.075], [0.038, 0.075], [0.034, 0.012], [0.0, 0.012]], 12);
  mb.pop();
  mb.box('cardboard', kt.x - 0.38, kt.top + 0.012, kt.z + 0.14, 0.055, 0.016, 0.036);

  // ---- café curtain in the kitchen window and the living-room windows
  // (built from the opening frames in buildSmallRooms / here by world coordinates)
  curtain(mb, 29.0, IZ0, 'x', 1, 0.85);

  // ---- key board beside the back door: four hooks, two keys, one empty hook (manor front key)
  const kb = S.keyBoard;
  mb.pushTRS(kb.x, 0, kb.z, 0);
  mb.box('furniture_oak', 0, kb.y, 0.011, 0.34, 0.11, 0.022, { uv: 'local' });
  mb.box('furniture_oak', 0, kb.y + 0.065, 0.02, 0.36, 0.02, 0.04, { uv: 'local' });
  const hooks = [-0.12, -0.04, 0.04, 0.12];
  hooks.forEach((hx, i) => {
    mb.box('brass', hx, kb.y - 0.03, 0.04, 0.008, 0.008, 0.04);
    mb.box('brass', hx, kb.y - 0.022, 0.058, 0.008, 0.02, 0.008);
    if (i === 0 || i === 3) {
      // key on a ring
      mb.pushTRS(hx, kb.y - 0.06, 0.05, 0, 1, 1, 1, 0, rng.range(-0.15, 0.15));
      mb.cylinder('ct_iron', 0, 0.025, 0, 0.014, 0.014, 0.003, 10, 'both');
      mb.box(i === 0 ? 'brass' : 'ct_iron', 0, -0.02, 0, 0.012, 0.075, 0.003);
      mb.box(i === 0 ? 'brass' : 'ct_iron', 0.008, -0.05, 0, 0.012, 0.012, 0.003);
      mb.pop();
    }
  });
  mb.pop();
  // calendar nail
  mb.box('ct_iron', S.calendar.x, S.calendar.y + 0.16, S.calendar.z + 0.008, 0.006, 0.006, 0.016);
}

/** Café curtain on a brass rod in a ground-floor window (opening centre along `axis`). */
function curtain(mb: MeshBuilder, c: number, wallFace: number, axis: 'x' | 'z', inward: 1 | -1, w: number): void {
  const y0 = 1.3 + 0.05, y1 = 1.3 + 0.62;
  const d = wallFace + inward * 0.03;
  if (axis === 'x') {
    mb.rod('brass', V(c - w / 2 + 0.02, y1 + 0.02, d), V(c + w / 2 - 0.02, y1 + 0.02, d), 0.006, 0.006, 6);
    for (let i = 0; i < 6; i++) {
      const x = c - w / 2 + 0.06 + (i + 0.5) * ((w - 0.12) / 6);
      mb.box('ct_lace', x, (y0 + y1) / 2, d + (i % 2 ? 0.006 : -0.004), (w - 0.12) / 6 + 0.012, y1 - y0, 0.004, { uv: 'local' });
    }
  } else {
    mb.rod('brass', V(d, y1 + 0.02, c - w / 2 + 0.02), V(d, y1 + 0.02, c + w / 2 - 0.02), 0.006, 0.006, 6);
    for (let i = 0; i < 6; i++) {
      const z = c - w / 2 + 0.06 + (i + 0.5) * ((w - 0.12) / 6);
      mb.box('ct_lace', d + (i % 2 ? 0.006 : -0.004), (y0 + y1) / 2, z, 0.004, y1 - y0, (w - 0.12) / 6 + 0.012, { uv: 'local' });
    }
  }
}

// ============================================================================ living room (Stube)
function buildLiving(mb: MeshBuilder, physics: Physics | undefined): void {
  const S = CARETAKER_SPOTS;
  // ---- Kachelofen (green tiled stove), fed from the kitchen side through the chimney
  const kw = 1.3, kd = 0.72, kx = CHIM.x, kz = MZ + 0.125 + kd / 2 + 0.005;
  mb.pushTRS(kx, G0, kz, 0);
  mb.box('ct_iron', 0, 0.06, 0, kw + 0.02, 0.12, kd + 0.02);
  mb.box('ct_tile_joint', 0, 0.72, -0.01, kw - 0.02, 1.2, kd - 0.02);
  const tile = (x: number, y: number, z: number, axis: 'z' | 'x', s: number, tw: number, th: number) => {
    if (axis === 'z') {
      mb.box('ct_tile_green', x, y, z + s * 0.012, tw - 0.012, th - 0.012, 0.024, { skip: [s > 0 ? 'nz' : 'pz'] });
      mb.box('ct_tile_green', x, y, z + s * 0.03, tw - 0.07, th - 0.07, 0.014, { skip: [s > 0 ? 'nz' : 'pz'] });
    } else {
      mb.box('ct_tile_green', x + s * 0.012, y, z, 0.024, th - 0.012, tw - 0.012, { skip: [s > 0 ? 'nx' : 'px'] });
      mb.box('ct_tile_green', x + s * 0.03, y, z, 0.014, th - 0.07, tw - 0.07, { skip: [s > 0 ? 'nx' : 'px'] });
    }
  };
  const cols = 6, rows = 5, tw = (kw - 0.02) / cols, th = 1.2 / rows;
  for (let r = 0; r < rows; r++) {
    const y = 0.12 + (r + 0.5) * th;
    for (let c = 0; c < cols; c++) tile(-kw / 2 + 0.01 + (c + 0.5) * tw, y, kd / 2 - 0.01, 'z', 1, tw, th);
    for (let c = 0; c < 3; c++) {
      const z = -kd / 2 + 0.01 + (c + 0.5) * ((kd - 0.02) / 3);
      tile(-kw / 2 + 0.01, y, z, 'x', -1, (kd - 0.02) / 3, th);
      tile(kw / 2 - 0.01, y, z, 'x', 1, (kd - 0.02) / 3, th);
    }
  }
  mb.box('ct_tile_green', 0, 1.36, 0.02, kw + 0.08, 0.08, kd + 0.04);
  mb.box('ct_tile_joint', 0, 1.46, 0, kw - 0.02, 0.12, kd - 0.02);
  mb.box('ct_tile_green', 0, 1.56, 0.01, kw - 0.12, 0.08, kd - 0.1);
  mb.box('brass', 0.42, 0.3, kd / 2 + 0.006, 0.16, 0.12, 0.012);
  // drying rail (Ofenstange)
  mb.rod('brass', V(-kw / 2 - 0.05, 1.5, kd / 2 + 0.14), V(kw / 2 + 0.05, 1.5, kd / 2 + 0.14), 0.01, 0.01, 6);
  for (const sx of [-1, 1]) mb.box('brass', sx * (kw / 2 + 0.03), 1.5, kd / 2 + 0.07, 0.015, 0.015, 0.14);
  // a pair of grey wool socks drying on the rail
  mb.box('ct_linen', -0.3, 1.43, kd / 2 + 0.14, 0.09, 0.14, 0.012);
  mb.box('ct_linen', -0.18, 1.42, kd / 2 + 0.14, 0.09, 0.16, 0.012);
  mb.pop();
  physics?.addBox({ cx: kx, cy: G0 + 0.8, cz: kz, hx: kw / 2 + 0.04, hy: 0.8, hz: kd / 2, surface: 'stone' });

  // ---- corner bench (Eckbank) in the south-west corner with the table
  const seatY = G0 + 0.45, backTop = G0 + 0.82;
  const benchW = (z0: number, z1: number) => {
    mb.box('furniture_wood', IX0 + 0.225, seatY - 0.02, (z0 + z1) / 2, 0.45, 0.04, z1 - z0, { uv: 'local', uvRotate: true });
    mb.box('furniture_wood', IX0 + 0.43, (seatY - 0.04) / 2 + G0 / 2, (z0 + z1) / 2, 0.025, seatY - G0 - 0.04, z1 - z0 - 0.02, { uv: 'local' });
    mb.pushTRS(IX0 + 0.04, seatY, (z0 + z1) / 2, 0, 1, 1, 1, 0, -0.12);
    mb.box('furniture_wood', 0, (backTop - seatY) / 2, 0, 0.025, backTop - seatY, z1 - z0, { uv: 'local' });
    mb.pop();
  };
  const benchS = (x0: number, x1: number) => {
    mb.box('furniture_wood', (x0 + x1) / 2, seatY - 0.02, IZ1 - 0.225, x1 - x0, 0.04, 0.45, { uv: 'local' });
    mb.box('furniture_wood', (x0 + x1) / 2, (seatY - 0.04) / 2 + G0 / 2, IZ1 - 0.43, x1 - x0 - 0.02, seatY - G0 - 0.04, 0.025, { uv: 'local' });
    mb.pushTRS((x0 + x1) / 2, seatY, IZ1 - 0.04, 0, 1, 1, 1, 0.12, 0);
    mb.box('furniture_wood', 0, (backTop - seatY) / 2, 0, x1 - x0, backTop - seatY, 0.025, { uv: 'local' });
    mb.pop();
  };
  benchW(5.75, IZ1);
  benchS(IX0 + 0.45, 29.4);
  physics?.addBox({ cx: IX0 + 0.225, cy: G0 + 0.225, cz: (5.75 + IZ1) / 2, hx: 0.225, hy: 0.225, hz: (IZ1 - 5.75) / 2, surface: 'wood' });
  physics?.addBox({ cx: (IX0 + 0.45 + 29.4) / 2, cy: G0 + 0.225, cz: IZ1 - 0.225, hx: (29.4 - IX0 - 0.45) / 2, hy: 0.225, hz: 0.225, surface: 'wood' });
  const lt = S.livingTable;
  table(mb, lt.x, G0, lt.z, 0, lt.w, lt.d, 0.78, 'furniture_oak', 'furniture_oak');
  physics?.addBox({ cx: lt.x, cy: G0 + 0.4, cz: lt.z, hx: lt.w / 2, hy: 0.4, hz: lt.d / 2, surface: 'wood' });
  // embroidered runner and fresh candles in a brass holder, matches, two burnt matchsticks
  mb.box('ct_linen', lt.x + 0.05, lt.top + 0.002, lt.z - 0.02, 0.3, 0.003, 0.62, { uv: 'local' });
  const cx = lt.x + 0.05, cz = lt.z - 0.24;
  mb.cylinder('brass', cx, lt.top, cz, 0.06, 0.055, 0.012, 16, 'top');
  ([[0, 0, 0.17, 0.014], [0.035, 0.02, 0.12, 0.012], [-0.03, 0.022, 0.095, 0.012]] as const).forEach(([dx, dz, h, r]) => {
    mb.cylinder('ct_wax', cx + dx, lt.top + 0.012, cz + dz, r, r * 0.95, h, 10, 'top');
    mb.cylinder('ct_wick', cx + dx, lt.top + 0.012 + h, cz + dz, 0.0016, 0.0012, 0.012, 4, 'none');
    mb.cylinder('ct_wax', cx + dx + r * 0.7, lt.top + 0.012 + h * 0.55, cz + dz, 0.004, 0.003, h * 0.4, 5, 'none');
  });
  mb.box('cardboard', lt.x + 0.32, lt.top + 0.009, lt.z - 0.28, 0.052, 0.016, 0.036);
  mb.box('ct_wick', lt.x + 0.26, lt.top + 0.002, lt.z - 0.31, 0.045, 0.002, 0.003);
  mb.box('ct_wick', lt.x + 0.24, lt.top + 0.002, lt.z - 0.26, 0.04, 0.002, 0.003);

  // ---- Herrgottswinkel: corner shelf, crucifix with the Palmbuschen, red votive light (lit)
  const yawC = 3 * Math.PI / 4;         // local +z points diagonally into the room
  mb.pushTRS(IX0, 0, IZ1, yawC);
  const shelfY = G0 + 1.58;
  const r = 0.36;
  const pA = [r * 0.7071, shelfY, r * 0.7071], pB = [-r * 0.7071, shelfY, r * 0.7071], pO = [0, shelfY, 0];
  polyN(mb, 'furniture_oak', [pO, pA, pB], [0, 1, 0]);
  polyN(mb, 'furniture_oak', [[0, shelfY - 0.03, 0], [pA[0], shelfY - 0.03, pA[2]], [pB[0], shelfY - 0.03, pB[2]]], [0, -1, 0]);
  quadN(mb, 'furniture_oak', [pB[0], shelfY - 0.03, pB[2]], [pA[0], shelfY - 0.03, pA[2]], pA, pB, [0, 0, 1]);
  mb.box('furniture_oak', 0, shelfY - 0.07, r * 0.69, 0.48, 0.05, 0.015, { uv: 'local' });
  // votive in red glass with a small flame (in the corner the walls run at |x| = z, so
  // everything stays inside that wedge)
  const vz = 0.2;
  mb.cylinder('ct_votive', 0, shelfY, vz, 0.034, 0.038, 0.085, 14, 'bottom');
  mb.cylinder('ct_wax', 0, shelfY + 0.005, vz, 0.03, 0.03, 0.045, 12, 'top');
  mb.cylinder('ct_flame', 0, shelfY + 0.05, vz, 0.006, 0.0, 0.026, 6, 'none');
  // crucifix
  const cy = shelfY + 0.12, cz2 = 0.155;
  mb.box('furniture_oak', 0, cy + 0.24, cz2, 0.036, 0.5, 0.024, { uv: 'local' });
  mb.box('furniture_oak', 0, cy + 0.37, cz2, 0.25, 0.032, 0.024, { uv: 'local' });
  mb.box('ct_corpus', 0, cy + 0.3, cz2 + 0.018, 0.045, 0.1, 0.018);
  mb.box('ct_corpus', 0, cy + 0.2, cz2 + 0.016, 0.03, 0.11, 0.016);
  mb.cylinder('ct_corpus', 0, cy + 0.355, cz2 + 0.018, 0.014, 0.012, 0.03, 8, 'both');
  for (const s of [-1, 1]) mb.beam('ct_corpus', V(s * 0.02, cy + 0.34, cz2 + 0.018), V(s * 0.105, cy + 0.372, cz2 + 0.018), 0.014, 0.014, V(0, 0, 1));
  mb.box('paper', 0, cy + 0.42, cz2 + 0.014, 0.05, 0.022, 0.004);
  // Palmbuschen tucked behind the cross
  for (let i = 0; i < 7; i++) {
    const a = -0.42 + i * 0.14;
    mb.beam('ct_palm', V(0, cy + 0.28, cz2 - 0.025), V(Math.sin(a) * 0.23, cy + 0.28 + Math.cos(a) * 0.25, cz2 - 0.04), 0.02, 0.008, V(0, 0, 1));
  }
  mb.box('fabric_red', 0.0, cy + 0.27, cz2 - 0.022, 0.03, 0.08, 0.004);
  mb.box('fabric_white', 0.02, cy + 0.25, cz2 - 0.021, 0.02, 0.1, 0.004);
  mb.pop();

  // ---- living-room ceiling beam (Tram) and curtains
  mb.box('rough_timber', (IX0 + HX - 0.075) / 2, Gc - 0.1, 6.05, HX - 0.075 - IX0, 0.2, 0.22, { uv: 'local' });
  curtain(mb, 28.6, IZ1, 'x', -1, 0.85);
  curtain(mb, 6.0, IX0, 'z', 1, 0.85);
}

// ============================================================================ hall, larder, bedroom, porch
function buildSmallRooms(kit: BuildingKit, physics: Physics | undefined): void {
  const mb = kit.mb;
  const S = CARETAKER_SPOTS;
  // ---- hall: coat rack with Josef's loden coat, holy-water font by the door, a walking stick
  const rx = KX - 0.075;
  mb.box('furniture_oak', rx - 0.012, G0 + 1.72, 6.65, 0.024, 0.1, 0.7, { uv: 'local' });
  for (const z of [6.4, 6.6, 6.8]) mb.rod('furniture_oak', V(rx - 0.02, G0 + 1.72, z), V(rx - 0.1, G0 + 1.75, z), 0.01, 0.012, 6);
  mb.pushTRS(rx - 0.11, G0 + 1.7, 6.6, 0);
  mb.box('ct_loden', 0, -0.06, 0, 0.13, 0.12, 0.38);
  mb.pushTRS(0, -0.06, 0, 0, 1, 1, 1, 0, 0.02);
  mb.box('ct_loden', 0, -0.42, 0, 0.16, 0.72, 0.46);
  mb.pop();
  mb.box('ct_loden', 0.01, -0.12, -0.16, 0.12, 0.52, 0.09);
  mb.box('ct_loden', 0.01, -0.12, 0.16, 0.12, 0.52, 0.09);
  mb.pop();
  mb.rod('furniture_oak', V(rx - 0.05, G0 + 0.01, 7.25), V(rx - 0.09, G0 + 0.9, 7.15), 0.012, 0.012, 6);
  mb.rod('furniture_oak', V(rx - 0.09, G0 + 0.9, 7.15), V(rx - 0.09, G0 + 0.92, 7.05), 0.012, 0.012, 6);
  mb.box('porcelain', HX + 0.075 + 0.012, G0 + 1.42, 7.2, 0.012, 0.16, 0.09);
  mb.pushTRS(HX + 0.075 + 0.045, G0 + 1.33, 7.2);
  mb.lathe('porcelain', [[0.0, 0.0], [0.03, 0.005], [0.04, 0.04], [0.036, 0.04], [0.026, 0.01], [0.0, 0.01]], 10);
  mb.pop();

  // ---- larder: wooden shelf on the west wall (jars, tins), crock on the floor
  const ls = S.larderShelf;
  for (const z of [ls.z0 + 0.02, (ls.z0 + ls.z1) / 2, ls.z1 - 0.02]) mb.box('rough_timber', ls.x0 + ls.depth / 2, G0 + 1.0, z, ls.depth, 2.0, 0.035, { uv: 'local' });
  for (const b of ls.boards) mb.box('rough_timber', ls.x0 + ls.depth / 2, G0 + b, (ls.z0 + ls.z1) / 2, ls.depth, 0.025, ls.z1 - ls.z0, { uv: 'local', uvOffset: [b, 0] });
  physics?.addBox({ cx: ls.x0 + ls.depth / 2, cy: G0 + 1.0, cz: (ls.z0 + ls.z1) / 2, hx: ls.depth / 2, hy: 1.0, hz: (ls.z1 - ls.z0) / 2, surface: 'wood' });
  const rngL = new RNG('caretaker:larder');
  for (const b of [ls.boards[1], ls.boards[2]]) {
    for (let z = ls.z0 + 0.12; z < ls.z1 - 0.1; z += rngL.range(0.11, 0.16)) {
      if (rngL.chance(0.25)) continue;
      jar(mb, ls.x0 + ls.depth / 2 + rngL.range(-0.03, 0.03), G0 + b + 0.0125, z, rngL, b > 1.2 ? 0.6 : 1);
    }
  }
  mb.pushTRS(33.2, G0, 3.1);
  mb.lathe('ct_granite_int', [[0.0, 0.0], [0.15, 0.0], [0.17, 0.05], [0.17, 0.36], [0.15, 0.38], [0.14, 0.36], [0.14, 0.04], [0.0, 0.04]], 14);
  mb.cylinder('furniture_wood', 0, 0.3, 0, 0.13, 0.13, 0.02, 12, 'top');
  mb.pop();
  physics?.addBox({ cx: 33.2, cy: G0 + 0.19, cz: 3.1, hx: 0.17, hy: 0.19, hz: 0.17, surface: 'stone' });

  // ---- bedroom: crucifix over the bed
  mb.pushTRS(34.03, G0 + 1.75, MZ + 0.125, 0);
  mb.box('furniture_oak', 0, 0.2, 0.012, 0.03, 0.42, 0.022, { uv: 'local' });
  mb.box('furniture_oak', 0, 0.3, 0.012, 0.22, 0.028, 0.022, { uv: 'local' });
  mb.box('ct_corpus', 0, 0.24, 0.028, 0.035, 0.08, 0.014);
  mb.box('ct_corpus', 0, 0.16, 0.027, 0.024, 0.09, 0.012);
  mb.pop();
  curtain(mb, 33.75, IZ1, 'x', -1, 0.85);

  // ---- porch: bench, doormat
  const bx0 = PIX0, bx1 = PIX0 + 0.38;
  mb.box('furniture_wood', (bx0 + bx1) / 2, P.y + 0.43, 9.3, bx1 - bx0, 0.04, 0.7, { uv: 'local', uvRotate: true });
  for (const z of [9.0, 9.6]) mb.box('furniture_wood', (bx0 + bx1) / 2, P.y + 0.205, z, bx1 - bx0 - 0.04, 0.41, 0.04, { uv: 'local' });
  physics?.addBox({ cx: (bx0 + bx1) / 2, cy: P.y + 0.225, cz: 9.3, hx: (bx1 - bx0) / 2, hy: 0.225, hz: 0.35, surface: 'wood' });
  mb.box('fabric_brown', 31.36, P.y + 0.006, P.z0 + 0.95, 0.7, 0.012, 0.45, { uv: 'local' });
}

/** Preserving jar (Rex glass) with contents, lid, label. Base at (x, y, z). */
function jar(mb: MeshBuilder, x: number, y: number, z: number, rng: RNG, fullness = 1): void {
  const fill = rng.chance(0.15) ? 0 : Math.min(1, rng.range(0.5, 1.05) * fullness);
  const contents = rng.pick(['ct_jar_red', 'ct_jar_plum', 'ct_jar_amber', 'ct_jar_green', 'ct_jar_tomato']);
  const s = rng.range(0.85, 1.12);
  mb.pushTRS(x, y, z, rng.float() * 6, s, s, s);
  if (fill > 0.05) mb.cylinder(contents, 0, 0.004, 0, 0.042, 0.042, 0.11 * fill, 8, 'top');
  mb.lathe('glass', [[0.0, 0.0], [0.044, 0.0], [0.047, 0.01], [0.047, 0.11], [0.04, 0.125], [0.04, 0.135]], 10);
  mb.cylinder('ct_jar_lid', 0, 0.133, 0, 0.043, 0.043, 0.01, 10, 'top');
  mb.box('paper', 0, 0.06, 0.048, 0.05, 0.035, 0.003);
  mb.pop();
}

// ============================================================================ cellar
function buildCellar(mb: MeshBuilder, physics: Physics | undefined): void {
  const rng = new RNG('caretaker:cellar');
  // timber joists under the ground-floor boards
  for (let x = IX0 + 0.35; x < IX1 - 0.2; x += 0.78) {
    const inStair = x > STAIR_VOID.x0 - 0.1;
    const nearChim = Math.abs(x - CHIM.x) < CHIM.sx / 2 + 0.1;
    if (!inStair) mb.box('rough_timber', x, CC - 0.09, (IZ0 + MZ - 0.15) / 2, 0.12, 0.18, MZ - 0.15 - IZ0, { uv: 'local' });
    if (!nearChim) mb.box('rough_timber', x, CC - 0.09, (MZ + 0.15 + IZ1) / 2, 0.12, 0.18, IZ1 - MZ - 0.15, { uv: 'local' });
  }
  // jar shelf on the north wall (preserving jars, Josef's and the newer ones in the round hand)
  const js = CARETAKER_SPOTS.jarShelf;
  for (const x of [js.x0 + 0.025, (js.x0 + js.x1) / 2, js.x1 - 0.025]) mb.box('rough_timber', x, C0 + 0.95, js.z0 + js.depth / 2, 0.05, 1.9, js.depth, { uv: 'local' });
  for (const b of js.boards) mb.box('rough_timber', (js.x0 + js.x1) / 2, C0 + b, js.z0 + js.depth / 2, js.x1 - js.x0, 0.025, js.depth, { uv: 'local', uvOffset: [b * 3, 0] });
  physics?.addBox({ cx: (js.x0 + js.x1) / 2, cy: C0 + 0.95, cz: js.z0 + js.depth / 2, hx: (js.x1 - js.x0) / 2, hy: 0.95, hz: js.depth / 2, surface: 'wood' });
  js.boards.forEach((b, bi) => {
    for (let x = js.x0 + 0.12; x < js.x1 - 0.1; x += rng.range(0.105, 0.15)) {
      if (Math.abs(x - (js.x0 + js.x1) / 2) < 0.08) continue;            // middle upright
      if (bi === 1 && x > js.x1 - 0.75) continue;                         // logbook lies here
      if (bi === 0 && x < js.x0 + 0.9 && x > js.x0 + 0.5) continue;       // the special labelled jars (decals)
      if (rng.chance(0.18)) continue;
      jar(mb, x, C0 + b + 0.0125, js.z0 + js.depth / 2 + rng.range(-0.05, 0.05), rng, bi === 3 ? 0.4 : 1);
    }
  });
  // the four labelled jars on the bottom board (labels drawn as decals in the browser)
  JAR_LABELS.forEach((l, i) => {
    const x = js.x0 + 0.56 + i * 0.105;
    mb.pushTRS(x, C0 + js.boards[0] + 0.0125, js.z0 + js.depth / 2 + 0.04);
    mb.cylinder(l.mat, 0, 0.004, 0, 0.042, 0.042, 0.11 * l.fill, 8, 'top');
    mb.lathe('glass', [[0.0, 0.0], [0.044, 0.0], [0.047, 0.01], [0.047, 0.11], [0.04, 0.125], [0.04, 0.135]], 10);
    mb.cylinder('ct_jar_lid', 0, 0.133, 0, 0.043, 0.043, 0.01, 10, 'top');
    mb.pop();
  });

  // potato crates and the sauerkraut crock are props; a firewood stack along the south cellar's west wall
  mb.pushTRS(IX0 + 0.2, 0, 6.2, Math.PI / 2);
  // logs along world x (local z), stack spans local x ∈ [−1.0, 1.1] → world z
  for (const z of [-0.12, 0.12]) mb.box('rough_timber', 0, C0 + 0.04, z, 2.2, 0.08, 0.08, { uv: 'local' });
  logStack(mb, rng, -1.05, 1.1, C0 + 0.08, 1.25, 0.33, { end: 'ct_firewood_end', split: 'ct_firewood', bark: 'ct_bark' });
  mb.pop();
  physics?.addBox({ cx: IX0 + 0.2, cy: C0 + 0.68, cz: 6.2 - 0.025, hx: 0.17, hy: 0.68, hz: 1.08, surface: 'wood' });

  // workbench in the south cellar (east wall) with a vice-less top and a few jars waiting to be filled
  table(mb, IX1 - 0.32, C0, 5.6, Math.PI / 2, 1.5, 0.6, 0.85, 'rough_timber', 'rough_timber');
  physics?.addBox({ cx: IX1 - 0.32, cy: C0 + 0.43, cz: 5.6, hx: 0.3, hy: 0.43, hz: 0.75, surface: 'wood' });
  for (let i = 0; i < 5; i++) {
    mb.pushTRS(IX1 - 0.3 + rng.range(-0.1, 0.1), C0 + 0.85, 5.2 + i * 0.11);
    mb.lathe('glass', [[0.0, 0.0], [0.044, 0.0], [0.047, 0.01], [0.047, 0.11], [0.04, 0.125], [0.04, 0.135]], 10);
    mb.pop();
  }
  // a box of rubber rings and a funnel – the canning season was this year
  mb.box('cardboard', IX1 - 0.28, C0 + 0.88, 6.1, 0.18, 0.06, 0.14);

  // ---- crawl space under the porch: an old blanket, a pillow, a candle stub on a jar lid, a tin
  const cr = C.CRAWL;
  physics?.addBox({ cx: (cr.x0 + cr.x1) / 2, cy: (cr.y1 + 0.1) / 2, cz: (cr.z0 + cr.z1) / 2, hx: (cr.x1 - cr.x0) / 2, hy: (0.1 - cr.y1) / 2, hz: (cr.z1 - cr.z0) / 2, surface: 'wood' });
  for (const z of [cr.z0 + 0.06, cr.z1 - 0.06]) mb.box('rough_timber', (cr.x0 + cr.x1) / 2, cr.y1 - 0.03, z, cr.x1 - cr.x0, 0.06, 0.1, { uv: 'local' });
  const by = cr.y0;
  mb.pushTRS(31.75, by, 9.15, 0.18);
  mb.box('ct_blanket', 0, 0.025, 0, 1.0, 0.05, 0.7, { uv: 'local' });
  mb.box('ct_blanket', -0.15, 0.06, 0.1, 0.6, 0.03, 0.45, { uv: 'local' });
  mb.box('ct_linen', 0.36, 0.085, -0.05, 0.26, 0.07, 0.38, { uv: 'local' });
  mb.pop();
  mb.cylinder('ct_jar_lid', 30.75, by, 8.85, 0.043, 0.043, 0.008, 12, 'top');
  mb.cylinder('ct_wax', 30.75, by + 0.008, 8.85, 0.014, 0.012, 0.035, 10, 'top');
  mb.cylinder('ct_wick', 30.75, by + 0.043, 8.85, 0.0015, 0.001, 0.008, 4, 'none');
  mb.box('cardboard', 30.86, by + 0.008, 8.92, 0.052, 0.016, 0.036);
  mb.cylinder('rust_metal_int', 30.55, by, 9.35, 0.08, 0.08, 0.11, 14, 'top');
}

const JAR_LABELS = [
  { text: 'Heidelbeeren 1994', hand: 'josef', mat: 'ct_jar_plum', fill: 1 },
  { text: 'Ribiseln 2009', hand: 'later', mat: 'ct_jar_red', fill: 0.9 },
  { text: 'Zwetschken 2016', hand: 'later', mat: 'ct_jar_plum', fill: 1 },
  { text: 'Paradeiser 2018', hand: 'later', mat: 'ct_jar_tomato', fill: 1 },
] as const;

// ============================================================================ attic
function buildAttic(mb: MeshBuilder, physics: Physics | undefined): void {
  // clothes line from the chimney to the east gable with things drying (a blanket, dish towels)
  const y = A0 + 1.95, z = 4.46;
  mb.rod('rubber_black', V(CHIM.x + CHIM.sx / 2, y, z), V(IX1, y, z), 0.004, 0.004, 4);
  mb.box('ct_iron', IX1 - 0.02, y, z, 0.04, 0.012, 0.012);
  // wool blanket folded over the line
  mb.box('ct_blanket', 32.4, y - 0.42, z - 0.015, 1.1, 0.84, 0.012, { uv: 'local' });
  mb.box('ct_blanket', 32.4, y - 0.3, z + 0.015, 1.1, 0.6, 0.012, { uv: 'local' });
  mb.box('ct_blanket', 32.4, y + 0.005, z, 1.1, 0.012, 0.04);
  for (const [x, w, h] of [[31.05, 0.42, 0.55], [33.6, 0.4, 0.5]] as const) {
    mb.box('ct_linen', x, y - h / 2, z, w, h, 0.006, { uv: 'local' });
    mb.box('ct_wick', x - w / 2 + 0.05, y + 0.01, z, 0.012, 0.04, 0.016);
    mb.box('ct_wick', x + w / 2 - 0.05, y + 0.01, z, 0.012, 0.04, 0.016);
  }
  // bundles of herbs hanging from a collar tie
  for (let i = 0; i < 4; i++) {
    const x = 28.9 + i * 0.22;
    mb.rod('rubber_black', V(x, A0 + 2.9, 4.46), V(x, A0 + 2.6, 4.46), 0.002, 0.002, 3);
    mb.cylinder('ct_palm', x, A0 + 2.32, 4.46, 0.05, 0.015, 0.28, 6, 'both');
  }
  // a pile of spare roof tiles by the west gable
  for (let i = 0; i < 6; i++) mb.box('roof_tiles', 28.0, A0 + 0.015 + i * 0.022, 6.6, 0.4, 0.02, 0.18);
  physics?.addBox({ cx: 28.0, cy: A0 + 0.07, cz: 6.6, hx: 0.2, hy: 0.07, hz: 0.09, surface: 'stone' });
}

// ============================================================================ decals (browser only)
function addHouseDecals(group: THREE.Group): void {
  const S = CARETAKER_SPOTS;
  // soot stain above the stove pipe on the chimney breast
  placeDecal(group, canvasMesh(0.6, 0.9, 256, (g, W, H) => {
    const gr = g.createRadialGradient(W / 2, H * 0.78, 4, W / 2, H * 0.55, W * 0.6);
    gr.addColorStop(0, 'rgba(18,15,12,0.75)'); gr.addColorStop(0.5, 'rgba(25,20,16,0.35)'); gr.addColorStop(1, 'rgba(25,20,16,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }, { transparent: true, rough: 0.95 }), CHIM.x, G0 + 1.85, CHIM.z - CHIM.sz / 2 - 0.004, Math.PI);
  // the four handwritten jar labels in the cellar
  JAR_LABELS.forEach((l, i) => {
    const js = S.jarShelf;
    const x = js.x0 + 0.56 + i * 0.105;
    placeDecal(group, canvasMesh(0.06, 0.042, 2400, (g, W, H) => {
      g.fillStyle = '#e2d9bf'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(90,70,40,0.35)'; g.strokeRect(2, 2, W - 4, H - 4);
      g.fillStyle = l.hand === 'josef' ? '#1d2850' : '#2a2a30';
      g.textAlign = 'center';
      const [name, year] = [l.text.slice(0, l.text.lastIndexOf(' ')), l.text.slice(l.text.lastIndexOf(' ') + 1)];
      g.font = `${l.hand === 'josef' ? '' : 'bold '}${Math.round(H * 0.27)}px ${l.hand === 'josef' ? FONT_NEAT : FONT_ROUND}`;
      g.fillText(l.hand === 'josef' ? name : name.toUpperCase(), W / 2, H * 0.45);
      g.fillText(year, W / 2, H * 0.82);
    }, { rough: 0.85 }), x, C0 + js.boards[0] + 0.0125 + 0.062, js.z0 + js.depth / 2 + 0.04 + 0.049, 0, i === 3 ? 0.04 : -0.03);
  });
  // "Verwaltung" enamel plate above the porch door
  placeDecal(group, canvasMesh(0.34, 0.11, 900, (g, W, H) => {
    g.fillStyle = '#ece8de'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e2a4a'; g.lineWidth = H * 0.06; g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
    g.fillStyle = '#16203a'; g.textAlign = 'center'; g.font = `bold ${Math.round(H * 0.5)}px ${FONT_SIGN}`;
    g.fillText('Verwaltung', W / 2, H * 0.68);
    chips(g, W, H, 7, 1);
  }, { exterior: true, rough: 0.3 }), 31.36, 2.39, P.z1 + 0.0105, 0);
}

/** Chipped enamel: dark rusty spots, mostly near the edges. */
function chips(g: CanvasRenderingContext2D, W: number, H: number, n: number, seed: number): void {
  const rng = new RNG(seed * 7919);
  for (let i = 0; i < n; i++) {
    const edge = rng.chance(0.7);
    const x = edge ? (rng.chance(0.5) ? rng.range(0, W * 0.08) : rng.range(W * 0.92, W)) : rng.range(0, W);
    const y = edge ? rng.range(0, H) : (rng.chance(0.5) ? rng.range(0, H * 0.1) : rng.range(H * 0.9, H));
    const r = rng.range(1.5, 0.06 * Math.min(W, H) + 2);
    g.fillStyle = `rgba(${40 + rng.int(0, 30)},${25 + rng.int(0, 15)},15,0.9)`;
    g.beginPath(); g.ellipse(x, y, r, r * rng.range(0.6, 1), rng.float() * 3, 0, Math.PI * 2); g.fill();
  }
}

// ============================================================================ gate and boundary walls
function buildGateAndWalls(gm: MeshBuilder, physics: Physics | undefined, heightAt: (x: number, z: number) => number, group: THREE.Group): void {
  const F = GATE_FRAME;
  const rng = new RNG('caretaker:gate');
  const H = (lx: number, lz: number) => { const [x, z] = frameToWorld(F, lx, lz); return heightAt(x, z); };
  const iron = 'ct_iron_ext', granite = 'ct_granite';
  gm.pushTRS(F.ox, 0, F.oz, F.yaw);

  // ---------------------------------------------------------------- pillars
  const pg = (s: number) => Math.min(H(s * 2.35 - 0.3, -0.3), H(s * 2.35 + 0.3, -0.3), H(s * 2.35 - 0.3, 0.3), H(s * 2.35 + 0.3, 0.3));
  const pillarTop = Math.max(H(-2.35, 0), H(2.35, 0)) + 2.25;
  for (const s of [-1, 1]) {
    const px = s * 2.35, base = pg(s) - 0.35;
    let y = base, k = 0;
    while (y < pillarTop - 0.02) {
      const h = Math.min(0.46, pillarTop - y);
      const jx = rng.range(-0.008, 0.008), jz = rng.range(-0.008, 0.008);
      gm.box(granite, px + jx, y + h / 2, jz, 0.6, h - 0.014, 0.6, { uvOffset: [k * 0.37, k * 0.71] });
      gm.box('concrete', px, y + h - 0.007, 0, 0.57, 0.016, 0.57, { skip: ['py', 'ny'] });
      y += h; k++;
    }
    gm.box(granite, px, pillarTop + 0.05, 0, 0.74, 0.1, 0.74);
    gm.pushTRS(px, pillarTop + 0.1, 0, Math.PI / 4);
    gm.lathe(granite, [[0.44, 0.0], [0.4, 0.06], [0.08, 0.26], [0.0, 0.27]], 4);
    gm.pop();
    gm.pushTRS(px, pillarTop + 0.36, 0);
    gm.lathe(granite, [[0.0, 0.0], [0.05, 0.005], [0.1, 0.05], [0.115, 0.11], [0.1, 0.17], [0.05, 0.215], [0.0, 0.22]], 10);
    gm.pop();
    // hinge pins
    for (const hy of [0.35, 1.45]) gm.box(iron, s * 2.04, H(s * 2.0, 0) + hy, 0, 0.04, 0.05, 0.04);
    frameBox(physics, F, px, (base + pillarTop + 0.36) / 2, 0, 0.3, (pillarTop + 0.36 - base) / 2, 0.3, 0, 'stone');
  }

  // ---------------------------------------------------------------- wrought-iron double gate, chained
  let ground = -Infinity, gmin = Infinity;
  for (let lx = -2.0; lx <= 2.0; lx += 0.25) { const h = H(lx, 0); ground = Math.max(ground, h); gmin = Math.min(gmin, h); }
  const yb = ground + 0.06;
  const arch = (x: number) => 1.48 + 0.34 * (1 - Math.pow(Math.min(1, Math.abs(x) / 2.02), 2));
  for (const s of [-1, 1] as const) {
    gm.withColor([rng.range(0.85, 1.05), rng.range(0.85, 1.0), rng.range(0.85, 1.0)], () => {
      const xh = s * 2.0, xl = s * 0.03;
      // stiles and rails (flat bar)
      gm.box(iron, xh, yb + 0.8, 0, 0.05, 1.6, 0.045);
      gm.box(iron, xl, yb + (arch(0) + 0.06) / 2, 0, 0.05, arch(0) + 0.06, 0.045);
      for (const ry of [0.08, 0.86, 1.48]) gm.box(iron, s * 1.015, yb + ry, 0, 1.97, 0.05, 0.016);
      // arched top rail
      const segs = 10;
      for (let i = 0; i < segs; i++) {
        const xa = s * (0.03 + (i / segs) * 1.97), xb = s * (0.03 + ((i + 1) / segs) * 1.97);
        gm.beam(iron, V(xa, yb + arch(xa), 0), V(xb, yb + arch(xb), 0), 0.045, 0.016, V(0, 0, 1));
      }
      // vertical bars with spear tips
      for (let ax = 0.16; ax < 1.95; ax += 0.125) {
        const x = s * ax, top = arch(x) + 0.1;
        gm.box(iron, x, yb + 0.08 + (top - 0.08) / 2, 0, 0.018, top - 0.08, 0.018);
        gm.pushTRS(x, yb + top, 0, Math.PI / 4);
        gm.cylinder(iron, 0, 0, 0, 0.026, 0.0, 0.085, 4, 'bottom');
        gm.pop();
        gm.box(iron, x, yb + top - 0.02, 0, 0.03, 0.02, 0.03);
        // dog bars in the bottom band
        if (ax + 0.0625 < 1.95) gm.box(iron, s * (ax + 0.0625), yb + 0.47, 0, 0.014, 0.78, 0.014);
      }
      // pairs of C-scrolls (spirals curling outwards) in the band under the arch
      for (const cx of [0.6, 1.1, 1.55]) {
        const x0 = s * cx, yc = yb + 1.48 + Math.min(0.12, (arch(x0) - 1.48) * 0.5 + 0.04);
        const r0 = Math.min(0.1, (arch(x0) - 1.48) * 0.42 + 0.03);
        for (const m of [-1, 1]) {
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 16; k++) {
            const a = (k / 16) * Math.PI * 1.7;
            const rr = r0 * (1 - k / 26);
            // start at the bottom (touching the rail), curl up and outwards
            pts.push(V(x0 + m * Math.sin(a) * rr, yc - Math.cos(a) * rr, 0));
          }
          gm.tube(iron, pts, pts.map(() => 0.007), 5);
        }
      }
    });
  }
  // chain round both latch stiles and the padlock
  const ych = yb + 1.0;
  const LOOP = 11;
  const links: THREE.Vector3[] = [];
  for (let k = 0; k < LOOP; k++) {
    // loop round both latch stiles (they sit at x = ±0.03, 0.05 wide)
    const a = (k / LOOP) * Math.PI * 2;
    links.push(V(Math.cos(a) * 0.1, ych + Math.sin(a * 2) * 0.01, Math.sin(a) * 0.055));
  }
  // tail hanging down on the outer (road) side to the padlock
  for (let k = 1; k <= 4; k++) links.push(V(0.012 * k, ych - 0.012 - k * 0.042, 0.062 + k * 0.003));
  links.forEach((p, i) => {
    const next = i < LOOP ? links[(i + 1) % LOOP] : i + 1 < links.length ? links[i + 1] : p.clone().add(V(0.012, -0.042, 0.003));
    const t = new THREE.Vector3().subVectors(next, p);
    if (t.lengthSq() < 1e-8) t.set(1, 0, 0);
    t.normalize();
    const up = Math.abs(t.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
    const n = new THREE.Vector3().crossVectors(up, t).normalize();
    if (i % 2) n.cross(t).normalize();                       // every other link turned 90°
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    gm.push(new THREE.Matrix4().makeBasis(t, n, b).setPosition(p));
    gm.box(iron, 0, 0.011, 0, 0.05, 0.007, 0.007);
    gm.box(iron, 0, -0.011, 0, 0.05, 0.007, 0.007);
    gm.box(iron, 0.022, 0, 0, 0.007, 0.022, 0.007);
    gm.box(iron, -0.022, 0, 0, 0.007, 0.022, 0.007);
    gm.pop();
  });
  const pl = links[links.length - 1];
  gm.box('rust_metal', pl.x + 0.005, pl.y - 0.075, pl.z + 0.01, 0.058, 0.068, 0.024);
  gm.box('brass', pl.x + 0.005, pl.y - 0.085, pl.z + 0.023, 0.012, 0.02, 0.003);
  gm.box('chrome', pl.x - 0.017, pl.y - 0.03, pl.z + 0.01, 0.008, 0.04, 0.008);
  gm.box('chrome', pl.x + 0.027, pl.y - 0.03, pl.z + 0.01, 0.008, 0.04, 0.008);
  gm.box('chrome', pl.x + 0.005, pl.y - 0.008, pl.z + 0.01, 0.052, 0.008, 0.008);
  // one blocking collider for both leaves (bottom reaches the ground: no crawling under)
  frameBox(physics, F, 0, (gmin - 0.1 + yb + arch(0) + 0.1) / 2, 0, 2.05, (yb + arch(0) + 0.1 - gmin + 0.1) / 2, 0.06, 0, 'metal');

  // ---------------------------------------------------------------- enamel sign on the east pillar's outer face
  const signY = H(2.35, 0) + 1.45;
  gm.box('ct_enamel_ext', 2.35, signY, 0.3 + 0.006, 0.42, 0.3, 0.008);
  for (const dx of [-0.17, 0.17]) gm.box('ct_iron_ext', 2.35 + dx, signY + 0.11, 0.3 + 0.012, 0.012, 0.012, 0.006);

  // ---------------------------------------------------------------- dry-stone boundary walls fading into the forest
  for (const s of [-1, 1] as const) {
    const line = wallLine(s);
    let dist = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const yawSeg = Math.atan2(bx - ax, bz - az) - Math.PI / 2;   // local x of the segment along the wall
      const n = Math.max(1, Math.round(L / 1.0));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const sx = ax + (bx - ax) * t0, sz = az + (bz - az) * t0;
        const ex = ax + (bx - ax) * t1, ez = az + (bz - az) * t1;
        const segLen = L / n;
        const d = dist + segLen * (k + 0.5);
        let h = wallHeight(s, d);
        h += rng.range(-0.04, 0.03);
        const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
        const g0 = Math.min(H(sx, sz), H(ex, ez), H(mx, mz));
        const gC = H(mx, mz);
        gm.pushTRS(mx, 0, mz, yawSeg);
        if (h > 0.08) stoneCourses(gm, rng, segLen, g0 - 0.25, gC + h, 0.5);
        if (h > 0.55) gm.box(granite, 0, gC + h + 0.03, 0, segLen + 0.02, 0.06, 0.56, { uvOffset: [rng.float() * 3, 0] });
        // rubble at the foot of decayed stretches
        if (h < 0.5) for (let r = 0; r < 4; r++) {
          const rs = rng.range(0.14, 0.3);
          gm.pushTRS(rng.range(-0.5, 0.5), H(mx, mz) - rs * 0.3, rng.range(-0.6, 0.6) * s, rng.float() * 3, 1, 1, 1, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
          gm.box(granite, 0, rs * 0.35, 0, rs * 1.3, rs * 0.7, rs, { uvOffset: [rng.float() * 3, rng.float() * 3] });
          gm.pop();
        }
        // iron railing on the coping next to the pillars
        if (d < 3.6 && h > 0.6) {
          const top = gC + h + 0.06;
          gm.box(iron, 0, top + 0.86, 0, segLen, 0.04, 0.014);
          gm.box(iron, 0, top + 0.12, 0, segLen, 0.04, 0.014);
          for (let px = -segLen / 2 + 0.06; px < segLen / 2; px += 0.13) {
            gm.box(iron, px, top + 0.47, 0, 0.016, 0.94, 0.016);
            gm.pushTRS(px, top + 0.94, 0, Math.PI / 4);
            gm.cylinder(iron, 0, 0, 0, 0.022, 0.0, 0.07, 4, 'bottom');
            gm.pop();
          }
        }
        gm.pop();
        if (h > 0.3) {
          const top = gC + h + (d < 3.6 && h > 0.6 ? 1.0 : 0.06);
          frameBox(physics, F, mx, (g0 - 0.3 + top) / 2, mz, segLen / 2 + 0.02, (top - g0 + 0.3) / 2, 0.26, yawSeg, 'stone');
        }
      }
      dist += L;
    }
  }
  gm.pop();

  // enamel sign texture (browser only)
  const [sx, sz] = frameToWorld(F, 2.35, 0.3 + 0.0105);
  placeDecal(group, canvasMesh(0.42, 0.3, 1100, (g, W, Hh) => {
    g.fillStyle = '#1d3766'; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = '#ece8dc'; g.lineWidth = Hh * 0.035; g.strokeRect(Hh * 0.06, Hh * 0.06, W - Hh * 0.12, Hh - Hh * 0.12);
    g.fillStyle = '#ece8dc'; g.textAlign = 'center';
    g.font = `bold ${Math.round(Hh * 0.17)}px ${FONT_SIGN}`; g.fillText('GUT WALDEGG', W / 2, Hh * 0.33);
    g.fillRect(W * 0.2, Hh * 0.41, W * 0.6, Hh * 0.012);
    g.font = `bold ${Math.round(Hh * 0.2)}px ${FONT_SIGN}`; g.fillText('PRIVATGRUND', W / 2, Hh * 0.64);
    g.font = `${Math.round(Hh * 0.12)}px ${FONT_SIGN}`; g.fillText('Betreten verboten', W / 2, Hh * 0.84);
    chips(g, W, Hh, 16, 3);
    // rust bleeding from the screw holes
    for (const x of [W * 0.1, W * 0.9]) {
      const gr = g.createLinearGradient(x, Hh * 0.13, x, Hh * 0.6);
      gr.addColorStop(0, 'rgba(110,60,25,0.8)'); gr.addColorStop(1, 'rgba(110,60,25,0)');
      g.fillStyle = gr; g.fillRect(x - 3, Hh * 0.13, 6, Hh * 0.47);
    }
  }, { exterior: true, rough: 0.28 }), sx, signY, sz, F.yaw);
}

/** Height profile of the boundary wall (distance d from the pillar), 0 = gone. */
function wallHeight(s: 1 | -1, d: number): number {
  const full = 0.85;
  if (s > 0 && d > 3.9 && d < 5.9) return 0.1;                          // collapsed breach (the way in)
  const fadeStart = s > 0 ? 7.5 : 8.2, fadeEnd = s > 0 ? 12.4 : 12.9;
  if (d <= fadeStart) return full;
  const t = Math.min(1, (d - fadeStart) / (fadeEnd - fadeStart));
  return full * Math.pow(1 - t, 1.4);
}

/** Dry-stone courses in a local frame: wall along x (length len), thickness t, from y0 to y1. */
function stoneCourses(mb: MeshBuilder, rng: RNG, len: number, y0: number, y1: number, t: number): void {
  let y = y0;
  while (y < y1 - 0.04) {
    const ch = Math.min(rng.range(0.17, 0.28), y1 - y);
    let x = -len / 2 + rng.range(0, 0.15);
    // first stone fills from the segment start
    let first = true;
    while (x < len / 2 - 0.02) {
      const bl = Math.min(rng.range(0.28, 0.62), len / 2 - x);
      const x0 = first ? -len / 2 : x;
      first = false;
      const shade = rng.range(0.82, 1.08);
      mb.withColor([shade, shade, shade], () => {
        mb.box('ct_granite', (x0 + x + bl) / 2, y + ch / 2, rng.range(-0.02, 0.02), x + bl - x0 - 0.018, ch - 0.016, t + rng.range(-0.05, 0.02), { uvOffset: [rng.float() * 4, rng.float() * 4] });
      });
      x += bl;
    }
    // mortar-less joint shadow core
    mb.box('ct_soot_ext', 0, y + ch / 2, 0, len, ch - 0.03, t - 0.1, { skip: ['py', 'ny'] });
    y += ch;
  }
}

// ============================================================================ mailbox
function buildMailbox(gm: MeshBuilder, kit: BuildingKit, heightAt: (x: number, z: number) => number, group: THREE.Group): void {
  const F = GATE_FRAME;
  const [wx, wz] = frameToWorld(F, MAILBOX_LOCAL.lx, MAILBOX_LOCAL.lz);
  const g = heightAt(wx, wz);
  const yaw = F.yaw - Math.PI / 2;       // front faces the road
  const rm = 'rust_metal', t = 0.008;
  gm.pushTRS(wx, g, wz, yaw);
  // post with a slight lean, cross brace
  gm.pushTRS(0, 0, -0.02, 0, 1, 1, 1, 0.03, -0.02);
  gm.box('rough_timber_ext', 0, (MB_POST - 0.4) / 2, -MB_D / 2 + 0.05, 0.09, MB_POST + 0.4, 0.09, { uv: 'local', uvRotate: true });
  gm.pop();
  gm.box('rough_timber_ext', 0, MB_POST - 0.03, -0.02, 0.3, 0.05, 0.12, { uv: 'local' });
  // box: floor, back, sides, slanted roof; front flap hangs open (rusted hinge)
  const y0 = MB_POST;
  gm.box(rm, 0, y0 + t / 2, 0, MB_W, t, MB_D);
  gm.box(rm, 0, y0 + MB_H / 2, -MB_D / 2 + t / 2, MB_W, MB_H, t);
  for (const s of [-1, 1]) {
    gm.box(rm, s * (MB_W / 2 - t / 2), y0 + MB_H / 2 - 0.02, 0, t, MB_H - 0.04, MB_D);
  }
  gm.pushTRS(0, y0 + MB_H - 0.01, 0, 0, 1, 1, 1, 0.16, 0);
  gm.box(rm, 0, 0.012, 0.0, MB_W + 0.03, t, MB_D + 0.06);
  gm.pop();
  gm.box(rm, 0, y0 + MB_H - 0.045, MB_D / 2 - t / 2, MB_W, 0.07, t);
  gm.box('ct_soot_ext', 0, y0 + MB_H - 0.045, MB_D / 2 + 0.001, MB_W * 0.7, 0.018, 0.002);
  gm.pushTRS(0, y0 + 0.012, MB_D / 2, 0, 1, 1, 1, 1.75, 0);
  gm.box(rm, 0, (MB_H - 0.09) / 2, 0.004, MB_W - 0.006, MB_H - 0.09, t);
  gm.pop();
  // name plates on the side that faces people coming up the road: carved LINDNER board (old)
  // and the Dymo tape HRUBÝ under it
  gm.box('furniture_oak', MB_W / 2 + 0.003, y0 + 0.26, 0.0, 0.006, 0.05, 0.2);
  gm.box('rubber_black', MB_W / 2 + 0.002, y0 + 0.2, 0.0, 0.004, 0.018, 0.11);
  gm.pop();
  // post collider only: the open box must not block the interaction ray to the note inside
  const [cx, cz] = frameToWorld({ ox: wx, oz: wz, yaw }, 0, -MB_D / 2 + 0.05);
  kit.physics?.addBox({ cx, cy: g + MB_POST / 2, cz, hx: 0.06, hy: MB_POST / 2, hz: 0.06, ry: yaw, surface: 'wood' });
  const pose = mailboxNotePose(heightAt);
  kit.anchor('road_mailbox', pose.x, pose.y, pose.z, pose.rot);
  const [gx, gz] = frameToWorld(F, 2.35, 0.32);
  const [px, pz] = frameToWorld(F, 2.35, 0);
  kit.anchor('gate_sign', gx, heightAt(px, pz) + 1.45, gz, F.yaw);

  // label textures (browser only): plates face the box's local +x (down the road)
  const sideYaw = yaw + Math.PI / 2;
  const P0 = (lx: number, ly: number, lz: number): [number, number, number] => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [wx + lx * c + lz * s, g + ly, wz - lx * s + lz * c];
  };
  const [ax, ay, az] = P0(MB_W / 2 + 0.0065, y0 + 0.26, 0);
  placeDecal(group, canvasMesh(0.2, 0.05, 1400, (c, W, H) => {
    c.fillStyle = '#6a4e32'; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(30,18,8,0.85)'; c.textAlign = 'center'; c.font = `bold ${Math.round(H * 0.62)}px Georgia, serif`;
    c.fillText('LINDNER', W / 2, H * 0.74);
    c.fillStyle = 'rgba(200,170,120,0.25)'; c.fillText('LINDNER', W / 2 + 1, H * 0.74 + 1);
  }, { exterior: true, rough: 0.8 }), ax, ay, az, sideYaw);
  const [bx, by, bz] = P0(MB_W / 2 + 0.0045, y0 + 0.2, 0);
  placeDecal(group, canvasMesh(0.11, 0.018, 2400, (c, W, H) => {
    c.fillStyle = '#121212'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e8e8e8'; c.textAlign = 'center'; c.font = `bold ${Math.round(H * 0.72)}px "Arial Narrow", Arial, sans-serif`;
    c.fillText('HRUBÝ', W / 2, H * 0.78);
  }, { exterior: true, rough: 0.4 }), bx, by, bz, sideYaw);
  const [kx, ky, kz] = P0(0.06, y0 + MB_H - 0.045, MB_D / 2 + 0.0055);
  placeDecal(group, canvasMesh(0.1, 0.035, 1600, (c, W, H) => {
    c.fillStyle = '#f2efe6'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#b21e1e'; c.fillRect(0, 0, H * 0.9, H);
    c.fillStyle = '#ffffff'; c.font = `bold ${Math.round(H * 0.7)}px Arial, sans-serif`; c.textAlign = 'center'; c.fillText('!', H * 0.45, H * 0.78);
    c.fillStyle = '#222'; c.font = `bold ${Math.round(H * 0.32)}px Arial, sans-serif`; c.textAlign = 'left';
    c.fillText('Bitte keine', H * 1.05, H * 0.45); c.fillText('Werbung!', H * 1.05, H * 0.85);
  }, { exterior: true, rough: 0.5 }), kx, ky, kz, yaw);
}

// ============================================================================ woodshed
function buildWoodshed(sm: MeshBuilder, kit: BuildingKit, physics: Physics | undefined, heightAt: (x: number, z: number) => number): void {
  const F = SHED_FRAME;
  const rng = new RNG('caretaker:woodshed');
  const H = (lx: number, lz: number) => { const [x, z] = frameToWorld(F, lx, lz); return heightAt(x, z); };
  const W2 = 2.1, D2 = 1.1;
  let gMax = -Infinity, gMin = Infinity;
  for (let lx = -W2; lx <= W2 + 1e-6; lx += W2 / 2) for (let lz = -D2; lz <= D2 + 1e-6; lz += D2) { gMax = Math.max(gMax, H(lx, lz)); gMin = Math.min(gMin, H(lx, lz)); }
  const yF = gMax + 2.3, yB = gMax + 1.85, zF = D2 - 0.06, zB = -D2 + 0.06;
  const roofY = (lz: number) => yB + (lz - zB) * (yF - yB) / (zF - zB);
  const wood = 'rough_timber_ext';
  const ends = { end: 'ct_firewood_end_ext', split: 'ct_firewood_ext', bark: 'ct_bark_ext' };
  sm.pushTRS(F.ox, 0, F.oz, F.yaw);

  // posts on flat stones
  const posts: [number, number][] = [[-2.04, zF], [0, zF], [2.04, zF], [-2.04, zB], [-0.68, zB], [0.68, zB], [2.04, zB]];
  for (const [lx, lz] of posts) {
    const g = H(lx, lz);
    sm.box('ct_granite', lx, g + 0.03, lz, 0.26, 0.12, 0.26, { uvOffset: [lx, lz] });
    const top = roofY(lz) - 0.12;
    sm.box(wood, lx, (g + 0.09 + top) / 2, lz, 0.12, top - g - 0.09, 0.12, { uv: 'local', uvRotate: true });
    frameBox(physics, F, lx, (g + top) / 2, lz, 0.06, (top - g) / 2, 0.06, 0, 'wood');
  }
  // purlins, rafters, boards and corrugated sheets
  for (const lz of [zF, zB]) sm.box(wood, 0, roofY(lz) - 0.06, lz, 4.6, 0.12, 0.12, { uv: 'local' });
  const ang = Math.atan2(yF - yB, zF - zB);
  const roofLen = (zF - zB + 0.65) / Math.cos(ang);
  const zMid = (zF + 0.4 + zB - 0.25) / 2;
  for (const lx of [-2.04, -1.02, 0, 1.02, 2.04]) {
    sm.pushTRS(lx, roofY(zMid) + 0.035, zMid, 0, 1, 1, 1, -ang, 0);
    sm.box(wood, 0, 0, 0, 0.06, 0.09, roofLen, { uv: 'local' });
    sm.pop();
  }
  sm.pushTRS(0, roofY(zMid) + 0.1, zMid, 0, 1, 1, 1, -ang, 0);
  sm.box({ default: wood, py: 'corrugated' }, 0, 0, 0, 4.7, 0.025, roofLen, { uv: 'local' });
  sm.box('corrugated', 0, 0.022, 0, 4.72, 0.012, roofLen + 0.02, { skip: ['ny'] });
  sm.pop();
  if (physics) {
    const [x, z] = frameToWorld(F, 0, zMid);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ang, F.yaw, 0, 'YXZ'));
    physics.addBox({ cx: x, cy: roofY(zMid) + 0.1, cz: z, hx: 2.35, hy: 0.04, hz: roofLen / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'metal' });
  }
  // board walls with air gaps: back and both sides, front open
  const board = (x: number, z: number, along: 'x' | 'z', w: number) => {
    const g = H(x, z);
    const top = roofY(z) - 0.02;
    const shade = rng.range(0.8, 1.05);
    sm.withColor([shade, shade, shade], () => {
      if (along === 'x') sm.box('barn_boards', x, (g + 0.06 + top) / 2, z, w, top - g - 0.06, 0.022, { uv: 'local', uvRotate: true, uvOffset: [rng.float() * 3, 0] });
      else sm.box('barn_boards', x, (g + 0.06 + top) / 2, z, 0.022, top - g - 0.06, w, { uv: 'local', uvRotate: true, uvOffset: [rng.float() * 3, 0] });
    });
  };
  for (let x = -2.1 + 0.09; x < 2.1; x += 0.185) board(x, zB - 0.075, 'x', 0.165);
  for (const s of [-1, 1]) for (let z = zB - 0.06 + 0.09; z < zF - 0.05; z += 0.185) board(s * (2.04 + 0.075), z, 'z', 0.165);
  frameBox(physics, F, 0, (gMin + yB) / 2, zB - 0.075, 2.12, (yB - gMin) / 2 + 0.1, 0.03, 0, 'wood');
  for (const s of [-1, 1]) frameBox(physics, F, s * 2.115, (gMin + yF) / 2, 0, 0.03, (yF - gMin) / 2, D2, 0, 'wood');

  // firewood: back row (full width) and a lower front row on the left half, on sleepers
  const sleepers = (x0: number, x1: number, z0: number, z1: number) => {
    let g = -Infinity;
    for (const [lx, lz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) g = Math.max(g, H(lx, lz));
    for (const z of [z0 + 0.06, z1 - 0.06]) sm.box(wood, (x0 + x1) / 2, g + 0.02, z, x1 - x0, 0.1, 0.08, { uv: 'local' });
    return g + 0.07;
  };
  const yb1 = sleepers(-1.95, 1.95, zB, zB + 0.34);
  sm.pushTRS(0, 0, zB + 0.17, 0);
  logStack(sm, rng, -1.95, 1.95, yb1, 1.55, 0.33, ends);
  sm.pop();
  frameBox(physics, F, 0, yb1 + 0.75, zB + 0.17, 1.95, 0.78, 0.17, 0, 'wood');
  const yb2 = sleepers(-1.95, 0.35, zB + 0.37, zB + 0.71);
  sm.pushTRS(0, 0, zB + 0.54, 0);
  logStack(sm, rng, -1.95, 0.35, yb2, 1.1, 0.33, ends);
  sm.pop();
  frameBox(physics, F, -0.8, yb2 + 0.52, zB + 0.54, 1.15, 0.55, 0.17, 0, 'wood');

  // chopping block in front, axe marks, split logs and chips scattered round it
  const cb = CHOP_BLOCK;
  const gb = H(cb.lx, cb.lz);
  sm.withColor([0.9, 0.86, 0.8], () => sm.cylinder('ct_bark_ext', cb.lx, gb - 0.05, cb.lz, cb.r, cb.r * 0.96, cb.h, 14, 'top', 'ct_firewood_end_ext'));
  for (let i = 0; i < 5; i++) {
    const a = rng.float() * Math.PI, l = rng.range(0.12, 0.3);
    sm.pushTRS(cb.lx + rng.range(-0.08, 0.08), gb - 0.05 + cb.h + 0.001, cb.lz + rng.range(-0.08, 0.08), a);
    sm.box('ct_soot_ext', 0, 0, 0, l, 0.002, 0.006);
    sm.pop();
  }
  frameBox(physics, F, cb.lx, gb - 0.05 + cb.h / 2, cb.lz, cb.r * 0.9, cb.h / 2, cb.r * 0.9, 0, 'wood');
  for (let i = 0; i < 9; i++) {
    const a = rng.float() * Math.PI * 2, r = rng.range(0.45, 1.2);
    const lx = cb.lx + Math.cos(a) * r, lz = cb.lz + Math.sin(a) * r * 0.8;
    const shade = rng.range(0.8, 1.05);
    sm.withColor([shade, shade, shade * 0.95], () => {
      sm.pushTRS(lx, H(lx, lz) + 0.04, lz, rng.float() * 6, 1, 1, 1, 0, rng.range(-0.3, 0.3));
      sm.box({ pz: ends.end, nz: ends.end, default: rng.chance(0.5) ? ends.bark : ends.split }, 0, 0, 0, rng.range(0.07, 0.12), 0.08, 0.33, { uv: 'local' });
      sm.pop();
    });
  }
  for (let i = 0; i < 70; i++) {
    const a = rng.float() * Math.PI * 2, r = Math.sqrt(rng.float()) * 1.4 + 0.3;
    const lx = cb.lx + Math.cos(a) * r, lz = cb.lz + Math.sin(a) * r;
    sm.pushTRS(lx, H(lx, lz) + 0.006, lz, rng.float() * 6, 1, 1, 1, rng.range(-0.2, 0.2), rng.range(-0.2, 0.2));
    sm.box(rng.chance(0.6) ? ends.split : ends.end, 0, 0, 0, rng.range(0.03, 0.08), 0.008, rng.range(0.015, 0.04));
    sm.pop();
  }
  // unsplit rounds waiting by the east side
  for (let i = 0; i < 6; i++) {
    const lx = 2.6 + (i % 3) * 0.38 + rng.range(-0.04, 0.04), lz = 0.2 + Math.floor(i / 3) * 0.42;
    const r = rng.range(0.15, 0.2);
    const g = H(lx, lz) - 0.03;
    sm.cylinder('ct_bark_ext', lx, g, lz, r, r, 0.33, 12, 'top', 'ct_firewood_end_ext');
    if (i < 2) sm.cylinder('ct_bark_ext', lx + 0.05, g + 0.33, lz + 0.03, r * 0.9, r * 0.9, 0.33, 12, 'top', 'ct_firewood_end_ext');
    frameBox(physics, F, lx, g + 0.17, lz, r * 0.8, 0.17, r * 0.8, 0, 'wood');
  }
  // sawhorse (Sägebock) on the west side
  const sx = -2.85, sz = 1.0, gs = H(sx, sz);
  for (const dz of [-0.3, 0.3]) for (const s of [-1, 1]) {
    sm.beam(wood, V(sx + s * 0.32, gs - 0.05, sz + dz), V(sx - s * 0.12, gs + 0.95, sz + dz), 0.06, 0.06, V(0, 0, 1));
  }
  // the legs cross at ~0.68 m; braces tie the two X frames together
  for (const bx of [sx - 0.14, sx + 0.14]) sm.box(wood, bx, gs + 0.36, sz, 0.05, 0.05, 0.66, { uv: 'local' });
  // a spruce pole lying in the fork, half sawn through
  sm.withColor([0.85, 0.82, 0.78], () => {
    sm.pushTRS(sx, gs + 0.84, sz, 0, 1, 1, 1, Math.PI / 2, 0);
    sm.cylinder('ct_bark_ext', 0, -0.75, 0, 0.11, 0.1, 1.5, 10, 'both', 'ct_firewood_end_ext');
    sm.pop();
  });
  sm.box('ct_soot_ext', sx, gs + 0.92, sz + 0.42, 0.24, 0.05, 0.004);
  frameBox(physics, F, sx, gs + 0.47, sz, 0.36, 0.47, 0.75, 0, 'wood');
  sm.pop();

  const [bx, bz] = frameToWorld(F, cb.lx, cb.lz);
  kit.anchor('woodshed_block', bx, gb - 0.05 + cb.h, bz, F.yaw);

  // interior span under the roof (rotated rectangle → strips on the 0.25 m interior grid)
  const corners = [[-W2, zB - 0.1], [W2, zB - 0.1], [W2, 0.5], [-W2, 0.5]].map(([lx, lz]) => frameToWorld(F, lx, lz));
  const zs = corners.map((c) => c[1]);
  for (let z = Math.ceil(Math.min(...zs) / 0.25) * 0.25; z < Math.max(...zs) - 0.25; z += 0.25) {
    const zc = z + 0.125;
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      if ((az - zc) * (bz - zc) > 0 || az === bz) continue;
      xs.push(ax + (bx - ax) * (zc - az) / (bz - az));
    }
    if (xs.length < 2) continue;
    const x0 = Math.ceil(Math.min(...xs) / 0.25) * 0.25, x1 = Math.floor(Math.max(...xs) / 0.25) * 0.25;
    if (x1 - x0 < 0.25) continue;
    kit.span({ x0, z0: z, x1, z1: z + 0.25, floorY: gMin - 0.2, ceil: yB - 0.05 });
  }
}
