/**
 * Gut Waldegg – the outlying structures: the 1930s glasshouse in the garden, the 1923 chapel
 * with its crypt on the knoll, the overgrown family cemetery around it and the hunting stand
 * ("Hochstand Lindnerwiese") at the edge of the old pasture.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * INTEGRATION
 *
 *  World.build()  (src/world/World.ts) – after the manor; add the chapel BEFORE the cemetery:
 *      const h = (x: number, z: number) => this.terrain.heightAt(x, z);
 *      this.add(buildGreenhouse(this.physics, this.materials, h));
 *      this.add(buildChapel(this.physics, this.materials, h));
 *      this.add(buildCemetery(this.physics, this.materials, h));
 *      this.add(buildHuntingStand(this.physics, this.materials, h));
 *    (imports: `import { buildGreenhouse, buildChapel, buildCemetery, buildHuntingStand } from './buildings/Sacred';`)
 *
 *  Game.load()  (src/Game.ts):
 *    - preload:   this.assets.preload([...MANOR_PROP_IDS, ...SACRED_PROP_IDS, ...VAN_CARGO])
 *                 (`import { SACRED_PROP_IDS, placeSacredProps } from './world/props/SacredProps';`)
 *    - props:     the manor placer `this.props` is hidden away from the manor (propCull), so use a
 *                 placer of its own:
 *                     const sacred = new PropPlacer(this.assets, this.physics);
 *                     placeSacredProps(sacred);          // or iterate SACRED_PROPS like MANOR_PROPS
 *                     scene.add(sacred.group);
 *    - documents: placeDocuments([...MANOR_DOCS, ...SACRED_DOCS], this.physics, this.interaction, …)
 *                 (`import { SACRED_DOCS } from './world/story/SacredDocs';`)
 *    SACRED_PROPS / SACRED_DOCS hold absolute positions; they are refreshed automatically whenever
 *    one of the builders below runs (the chapel floor, the hunting stand etc. follow the terrain),
 *    so read them after World.build().
 *
 *  Needs a one-line change elsewhere to look right:
 *    - Doors.cull(): with the camera away from the manor `range` is 0, so only ids matching
 *      EXTERIOR_DOOR stay visible. 'door:chapel_front', 'door:greenhouse_front' and
 *      'door:hunting_stand_front' match; 'door:chapel_crypt' does not (add `crypt` to the regex or
 *      cull by distance to the door's own building).
 *    - LightPool draws a cord + bakelite socket + bulb for every fixture; skip those for
 *      kind === 'candle' (light:chapel_candle sits on the altar step) and skip the bulb hum for it.
 *    - Forest: the nameless cross stands under three spruces just outside the cemetery wall.
 *      Add CEMETERY_SPRUCES ([x, z, model]) to the hand-placed `special` list in Forest.scatter().
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * All builders take `heightAt` (TerrainData.heightAt) and sit everything on the terrain. The
 * chapel footprint is a terrain hole: its walls run down to the crypt floor, the corners of the
 * hole beside the polygonal apse are paved, and every floor has its own collider.
 */
import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import { BuildingKit, BuildingOutput } from '../architecture/BuildingKit';
import { buildSlab } from '../architecture/Elements';
import { buildRoof, buildGableInfill } from '../architecture/Roofs';
import { wallFrame, wallPoint, Opening, WallFrame } from '../architecture/Walls';
import { MeshBuilder } from '../architecture/MeshBuilder';
import { balustrade } from './Manor';
import type { Physics } from '../../physics/Physics';
import type { MaterialLibrary, MatSpec } from '../../materials/MaterialLibrary';
import { RNG } from '../../core/Random';
import { BUILDINGS, CEMETERY, CLEARINGS, POI } from '../Layout';
import { ENV_TEXT } from '../story/environment_text';
import { worldUniforms } from '../../render/WorldUniforms';

export type HeightFn = (x: number, z: number) => number;
type P2 = [number, number];
type N3 = [number, number, number];
const PI = Math.PI;
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

// ===================================================================================
// Levels shared with SacredProps / SacredDocs (resolved from the terrain at build time)
// ===================================================================================

/** Hunting stand: cabin floor height above the ground at its centre. */
export const STAND_FLOOR = 3.55;
/** Yaw of the hunting stand: local +Z (the shooting window) faces the middle of the old pasture. */
export const STAND_YAW = (() => {
  const c = CLEARINGS[0];
  return Math.atan2(c.x - POI.huntingStand.x, c.z - POI.huntingStand.z);
})();

export type SacredDatum = 'gh' | 'chapel' | 'crypt' | 'ground' | 'stand' | 'standGround';

/** Floor levels of the structures; design values until the builders ran on the real terrain. */
export const SACRED_LEVELS = {
  greenhouseFloor: BUILDINGS.greenhouse.floorY as number,
  chapelFloor: 6.35,
  cryptFloor: 6.35 - 2.4,
  standGround: 0,
  ground: null as HeightFn | null,
};

const levelListeners: (() => void)[] = [];
/** Register a callback that runs now and whenever a builder updated SACRED_LEVELS. */
export function onSacredLevels(fn: () => void): void { levelListeners.push(fn); fn(); }
function levelsChanged(): void { for (const f of levelListeners) f(); }

function fallbackGround(x: number, z: number): number {
  const c = CEMETERY;
  return x > c.x0 - 8 && x < c.x1 + 8 && z > c.z0 - 8 && z < c.z1 + 8 ? 6.0 : 0;
}

/** Hunting stand local (x, z) → world (x, z). */
export function standToWorld(lx: number, lz: number): P2 {
  const s = Math.sin(STAND_YAW), c = Math.cos(STAND_YAW);
  return [POI.huntingStand.x + lx * c + lz * s, POI.huntingStand.z - lx * s + lz * c];
}

/** Resolve a datum-relative point (see SacredProps) to world coordinates. */
export function sacredPoint(d: SacredDatum, x: number, y: number, z: number): N3 {
  const L = SACRED_LEVELS;
  const g = L.ground ?? fallbackGround;
  switch (d) {
    case 'gh': return [x, L.greenhouseFloor + y, z];
    case 'chapel': return [x, L.chapelFloor + y, z];
    case 'crypt': return [x, L.cryptFloor + y, z];
    case 'ground': return [x, g(x, z) + y, z];
    case 'stand': { const [wx, wz] = standToWorld(x, z); return [wx, L.standGround + STAND_FLOOR + y, wz]; }
    case 'standGround': { const [wx, wz] = standToWorld(x, z); return [wx, (L.ground ? g(wx, wz) : L.standGround) + y, wz]; }
  }
}
/** Yaw offset of a datum's local frame. */
export function sacredYaw(d: SacredDatum): number { return d === 'stand' || d === 'standGround' ? STAND_YAW : 0; }

// ===================================================================================
// Materials
// ===================================================================================

const definedFor = new WeakSet<object>();
function defineSacredMaterials(m: MaterialLibrary): void {
  if (definedFor.has(m)) return;
  definedFor.add(m);
  const D = (n: string, s: MatSpec) => m.define(n, s);
  // chapel
  D('sacred_whitewash', { tex: 'plaster_int', scale: 3, color: '#f1ede4', exterior: true, groundDirt: 1.3, mossUp: 0.15 });
  D('sacred_whitewash_int', { tex: 'plaster_int', scale: 3, color: '#ebe6da' });
  D('sacred_dado_int', { tex: 'plaster_int', scale: 3, color: '#9f9784' });
  D('sacred_trim_ext', { tex: 'plaster_int', scale: 3, color: '#c9ad78', exterior: true, groundDirt: 1 });
  D('sacred_floor', { tex: 'stone_slab', scale: 2, color: '#d3ccc0' });
  D('sacred_crypt_floor', { tex: 'stone_slab', scale: 2, color: '#8c8880' });
  D('sacred_crypt_plate', { tex: 'stone_slab', scale: 2, color: '#99968e' });
  D('sacred_marble_int', { tex: 'stone_slab', scale: 2, color: '#ddd6c8', roughness: 0.7 });
  D('sacred_gold', { color: '#a88a48', roughness: 0.38, metalness: 1 });
  D('sacred_corpus', { color: '#cdb995', roughness: 0.7 });
  D('sacred_turret_boards', { tex: 'barn_boards', scale: 3, color: '#857a6c', exterior: true });
  D('sacred_patina', { tex: 'painted_metal', scale: 1, color: '#6f9c88', exterior: true, roughness: 0.65 });
  D('sacred_bronze', { color: '#6a5634', metalness: 0.85, roughness: 0.45, exterior: true });
  // candles
  D('sacred_flame', { color: '#ffd08a', emissive: '#ffa648', emissiveIntensity: 5, roughness: 1 });
  D('sacred_red_glass', { color: '#8a1a12', roughness: 0.15, transparent: true, opacity: 0.72, depthWrite: false });
  // cemetery
  D('sacred_granite', { tex: 'stone_slab', scale: 2, color: '#a9a8a2', exterior: true, groundDirt: 0.8, mossUp: 0.6 });
  D('sacred_granite_dark', { tex: 'stone_slab', scale: 2, color: '#4a4a48', exterior: true, roughness: 0.55, mossUp: 0.25 });
  D('sacred_sandstone', { tex: 'stone_slab', scale: 2, color: '#c3ab84', exterior: true, groundDirt: 1, mossUp: 0.95 });
  D('sacred_marble', { tex: 'stone_slab', scale: 2, color: '#d8d4ca', exterior: true, groundDirt: 1, mossUp: 0.5 });
  D('sacred_wood_grey', { tex: 'rough_timber', scale: 1.2, color: '#9a948a', exterior: true, mossUp: 0.7, vertexColors: true });
  D('sacred_batten', { tex: 'rough_timber', scale: 1.2, color: '#b4a88f', exterior: true, mossUp: 0.3, vertexColors: true });
  D('sacred_felt', { tex: 'fabric_brown', scale: 0.5, color: '#7a776f', exterior: true });
  D('sacred_earth', { tex: 'forest_floor', scale: 3, exterior: true });
  D('sacred_water', { color: '#141816', roughness: 0.05, exterior: true });
  D('sacred_wreath', { color: '#5d4e36', roughness: 0.95, exterior: true });
  // greenhouse
  D('gh_wood', { tex: 'painted_wood_white', scale: 1, color: '#d5d2c6', exterior: true, mossUp: 0.35 });
  D('gh_whitewash', { color: '#dcddd3', roughness: 0.9, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, exterior: true });
  D('gh_plastic', { color: '#e9eeea', roughness: 0.3, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, exterior: true });
  D('gh_soil', { tex: 'mud', scale: 2, color: '#5e4e3e', exterior: true });
  D('gh_soil_dry', { tex: 'mud', scale: 2, color: '#a39380', exterior: true });
  D('gh_leaf', { color: '#3f6128', roughness: 0.7, side: THREE.DoubleSide, exterior: true });
  D('gh_leaf_dead', { color: '#6b5a3c', roughness: 0.95, side: THREE.DoubleSide, exterior: true });
  D('gh_stalk_dead', { color: '#6e5e44', roughness: 0.95, exterior: true });
  D('gh_stem', { color: '#56743a', roughness: 0.8, exterior: true });
  D('gh_tomato', { color: '#b02a18', roughness: 0.3, exterior: true });
  D('gh_tomato_green', { color: '#6f8f3c', roughness: 0.4, exterior: true });
  // hunting stand
  D('hs_log', { tex: 'bark_spruce', scale: [1, 2], color: '#a29a90', exterior: true, mossUp: 0.5 });
  D('hs_boards', { tex: 'barn_boards', scale: 3, color: '#8e8478', exterior: true, mossUp: 0.4 });
  D('hs_boards_int', { tex: 'barn_boards', scale: 3, color: '#766c62' });
}

// ===================================================================================
// Geometry helpers
// ===================================================================================

const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a: number[], b: number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rectRange(h: HeightFn, x0: number, z0: number, x1: number, z1: number, step = 0.5): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const nx = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step)), nz = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const y = h(x0 + (x1 - x0) * (i / nx), z0 + (z1 - z0) * (j / nz));
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}

function ptsRange(h: HeightFn, pts: P2[]): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const [x, z] of pts) { const y = h(x, z); min = Math.min(min, y); max = Math.max(max, y); }
  return { min, max };
}

/** Quad whose winding is chosen so the face points toward `toward`. */
function quadToward(mb: MeshBuilder, mat: string, a: number[], b: number[], c: number[], d: number[], toward: number[], uvs?: number[][]): void {
  const n = cross(sub(b, a), sub(c, a));
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const nn = [n[0] / l, n[1] / l, n[2] / l];
  if (dot(nn, toward) < 0) mb.quad(mat, a, d, c, b, [-nn[0], -nn[1], -nn[2]], uvs ? [uvs[0], uvs[3], uvs[2], uvs[1]] : undefined);
  else mb.quad(mat, a, b, c, d, nn, uvs);
}

function triToward(mb: MeshBuilder, mat: string, a: number[], b: number[], c: number[], toward: number[]): void {
  const n = cross(sub(b, a), sub(c, a));
  if (dot(n, toward) < 0) mb.tri(mat, a, c, b); else mb.tri(mat, a, b, c);
}

/** Convex polygon in local XY extruded between z0 and z1 (front face +z). */
function extrude(mb: MeshBuilder, mats: string | { face: string; side: string }, poly: P2[], z0: number, z1: number, back = true): void {
  const face = typeof mats === 'string' ? mats : mats.face, side = typeof mats === 'string' ? mats : mats.side;
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    triToward(mb, face, [cx, cy, z1], [p[0], p[1], z1], [q[0], q[1], z1], [0, 0, 1]);
    if (back) triToward(mb, face, [cx, cy, z0], [p[0], p[1], z0], [q[0], q[1], z0], [0, 0, -1]);
    const ex = q[0] - p[0], ey = q[1] - p[1];
    quadToward(mb, side, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], [ey, -ex, 0]);
  }
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

function sphere(mb: MeshBuilder, mat: string, x: number, y: number, z: number, r: number, seg = 8, rings = 5, sy = 1): void {
  const prof: P2[] = [];
  for (let i = 0; i <= rings; i++) { const a = -PI / 2 + PI * (i / rings); prof.push([Math.max(0.0005, Math.cos(a) * r), Math.sin(a) * r * sy]); }
  mb.pushTRS(x, y, z);
  mb.lathe(mat, prof, seg);
  mb.pop();
}

/** Low dome (grave mound, soil heap) – ellipsoid cap, base at y. */
function mound(mb: MeshBuilder, mat: string, x: number, y: number, z: number, ry: number, rx: number, h: number, rz: number): void {
  const prof: P2[] = [];
  for (let i = 0; i <= 5; i++) { const a = (PI / 2) * (i / 5); prof.push([Math.max(0.001, Math.cos(a)), Math.sin(a)]); }
  mb.pushTRS(x, y, z, ry, rx, h, rz);
  mb.lathe(mat, prof, 14, 1.2);
  mb.pop();
}

/** Small flame (emissive teardrop). */
function flame(mb: MeshBuilder, x: number, y: number, z: number, s = 1): void {
  mb.pushTRS(x, y, z, 0, s, s, s);
  mb.lathe('sacred_flame', [[0.0004, 0], [0.005, 0.005], [0.0065, 0.012], [0.004, 0.022], [0.0004, 0.033]], 6);
  mb.pop();
}

/** Votive candle in a glass (Grablicht). */
function graveLight(mb: MeshBuilder, x: number, y: number, z: number, o: { red?: boolean; wax?: number; lit?: boolean; soot?: boolean; tipped?: boolean }): void {
  const glass = o.red ? 'sacred_red_glass' : 'glass';
  if (o.tipped) {
    mb.pushTRS(x, y + 0.038, z, 0, 1, 1, 1, PI / 2);
    mb.cylinder(glass, 0, -0.055, 0, 0.038, 0.034, 0.11, 10, 'bottom');
    mb.pop();
    return;
  }
  mb.cylinder(glass, x, y, z, 0.038, 0.034, 0.11, 10, 'bottom');
  const wax = o.wax ?? 0.02;
  if (wax > 0.002) mb.cylinder('candle', x, y + 0.004, z, 0.03, 0.03, wax, 10, 'top');
  if (o.soot) mb.cylinder('black_soot', x, y + 0.075, z, 0.0332, 0.0322, 0.03, 10, 'none');
  mb.box('black_soot', x, y + 0.004 + wax + 0.005, z, 0.002, 0.01, 0.002);
  if (o.lit) flame(mb, x, y + 0.004 + wax + 0.007, z);
}

/** Oriented static box collider defined in a local frame. */
function obb(physics: Physics | undefined, m: THREE.Matrix4, c: N3, h: N3, surface: string): void {
  if (!physics) return;
  const p = V3(c[0], c[1], c[2]).applyMatrix4(m);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(t, q, s);
  physics.addBox({ cx: p.x, cy: p.y, cz: p.z, hx: Math.max(0.01, h[0]), hy: Math.max(0.01, h[1]), hz: Math.max(0.01, h[2]), q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface });
}

function frameMatrix(x: number, y: number, z: number, ry: number, rx = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V3(1, 1, 1));
}

/** One roof plane (tiled top, optional underside + eave fascia + oriented collider). pts[0]→pts[1] is the eave. */
function roofPlane(mb: MeshBuilder, physics: Physics | undefined, pts: number[][], down: P2, pitch: number, th: number, tile: string, inner: string | null, fascia: string | null): void {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const vThick = th / cp;
  const [dx, dz] = down;
  const ux = -dz, uz = dx;
  const uvOf = (p: number[]) => [p[0] * ux + p[2] * uz, -(p[0] * dx + p[2] * dz) / cp];
  const n = [dx * sp, cp, dz * sp];
  const tri = (a: number[], b: number[], c: number[]) => {
    if (dot(cross(sub(b, a), sub(c, a)), n) < 0) [b, c] = [c, b];
    mb.tri(tile, a, b, c, [uvOf(a), uvOf(b), uvOf(c)]);
    if (inner) {
      const lo = (p: number[]) => [p[0], p[1] - vThick, p[2]];
      mb.tri(inner, lo(a), lo(c), lo(b), [uvOf(a), uvOf(c), uvOf(b)]);
    }
  };
  for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1]);
  if (fascia) {
    const a = pts[0], b = pts[1];
    quadToward(mb, fascia, [a[0], a[1] - vThick - 0.04, a[2]], [b[0], b[1] - vThick - 0.04, b[2]], [b[0], b[1] + 0.02, b[2]], [a[0], a[1] + 0.02, a[2]], [dx, 0, dz]);
  }
  roofCollider(physics, pts, down, pitch, th, 'tile');
}

/** Oriented box covering a (planar) roof polygon, hanging `th` below its top surface. */
function roofCollider(physics: Physics | undefined, pts: number[][], down: P2, pitch: number, th: number, surface: string): void {
  if (!physics) return;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), vThick = th / cp;
  const [dx, dz] = down;
  const ex = [-dz, 0, dx], ey = [dx * sp, cp, dz * sp], ez = cross(ex, ey);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of pts) {
    const d = sub(p, pts[0]);
    const s = dot(d, ex), t = dot(d, ez);
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const c = [0, 1, 2].map((k) => pts[0][k] + (ex[k] * (s0 + s1)) / 2 + (ez[k] * (t0 + t1)) / 2 - (ey[k] * vThick) / 2);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(ex[0], ex[1], ex[2]), V3(ey[0], ey[1], ey[2]), V3(ez[0], ez[1], ez[2])));
  physics.addBox({ cx: c[0], cy: c[1], cz: c[2], hx: Math.max(0.01, (s1 - s0) / 2), hy: Math.max(0.01, vThick / 2), hz: Math.max(0.01, (t1 - t0) / 2), q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface });
}

/** Half-round ridge / hip tiles along a line. */
function capLine(mb: MeshBuilder, mat: string, a: THREE.Vector3, b: THREE.Vector3, rad = 0.13): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return;
  dir.normalize();
  const up = V3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  const xa = new THREE.Vector3().crossVectors(up, dir).normalize();
  mb.push(new THREE.Matrix4().makeBasis(xa, up, dir).setPosition(a));
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * PI, a1 = ((i + 1) / segs) * PI;
    const p0 = [Math.cos(a0) * rad, Math.sin(a0) * rad * 0.8], p1 = [Math.cos(a1) * rad, Math.sin(a1) * rad * 0.8];
    const nrm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
    quadToward(mb, mat, [p1[0], p1[1], 0], [p0[0], p0[1], 0], [p0[0], p0[1], len], [p1[0], p1[1], len], nrm, [[a1 * 0.3, 0], [a0 * 0.3, 0], [a0 * 0.3, len], [a1 * 0.3, len]]);
  }
  mb.pop();
}

const GUTTER: P2[] = [[-0.07, 0.06], [-0.07, 0.0], [-0.04, -0.06], [0.04, -0.06], [0.07, 0.0], [0.07, 0.06], [0.06, 0.06], [0.06, 0.0], [0.035, -0.05], [-0.035, -0.05], [-0.06, 0.0], [-0.06, 0.06]];
function gutter(mb: MeshBuilder, mat: string, a: THREE.Vector3, b: THREE.Vector3): void {
  mb.sweep(mat, GUTTER, [a, b], V3(0, 1, 0), true);
}

// ===================================================================================
// Text decals: inscriptions, plates and carvings drawn into one canvas atlas per building
// ===================================================================================

type DrawFn = (g: CanvasRenderingContext2D, w: number, h: number) => void;
interface DecalReq { pos: number[][]; nrm: number[]; pw: number; ph: number; draw: DrawFn; x: number; y: number }

class TextDecals {
  private reqs: DecalReq[] = [];
  constructor(private name: string, private ppm: number, private exterior: boolean) {}

  /** Panel w×h (m) centred at c; text runs along `right`, upward along `up`, and faces right×up. */
  add(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, draw: DrawFn, ppm = this.ppm, lift = 0.003): void {
    const r = right.clone().normalize(), u = up.clone().normalize();
    const n = new THREE.Vector3().crossVectors(r, u).normalize();
    const o = c.clone().addScaledVector(n, lift);
    const P = (sx: number, sy: number) => o.clone().addScaledVector(r, (sx * w) / 2).addScaledVector(u, (sy * h) / 2).toArray();
    this.reqs.push({ pos: [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], nrm: n.toArray(), pw: Math.max(8, Math.ceil(w * ppm)), ph: Math.max(8, Math.ceil(h * ppm)), draw, x: 0, y: 0 });
  }

  /** Same, with centre / axes given in the local frame of matrix m (rotation + translation only). */
  addLocal(m: THREE.Matrix4, c: N3, right: N3, up: N3, w: number, h: number, draw: DrawFn, ppm = this.ppm, lift = 0.003): void {
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.add(V3(c[0], c[1], c[2]).applyMatrix4(m), V3(right[0], right[1], right[2]).applyQuaternion(q), V3(up[0], up[1], up[2]).applyQuaternion(q), w, h, draw, ppm, lift);
  }

  private pack(S: number, scale: number): number {
    const PAD = 3;
    const order = this.reqs.map((_, i) => i).sort((a, b) => this.reqs[b].ph - this.reqs[a].ph);
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const r = this.reqs[i];
      const pw = Math.ceil(r.pw * scale) + 2 * PAD, ph = Math.ceil(r.ph * scale) + 2 * PAD;
      if (pw > S) return Infinity;
      if (x + pw > S) { x = 0; y += rowH; rowH = 0; }
      r.x = x + PAD; r.y = y + PAD;
      x += pw; rowH = Math.max(rowH, ph);
    }
    return y + rowH;
  }

  build(): THREE.Mesh | null {
    if (!this.reqs.length || typeof document === 'undefined') return null;
    let S = 256, scale = 1, H = Infinity;
    for (;;) {
      H = this.pack(S, scale);
      if (H <= S) break;
      if (S < 2048) S *= 2; else scale *= 0.85;
      if (scale < 0.05) break;
    }
    let CH = 32;
    while (CH < H && CH < S) CH *= 2;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = CH;
    const g = canvas.getContext('2d');
    if (!g) return null;
    for (const r of this.reqs) {
      r.pw = Math.ceil(r.pw * scale); r.ph = Math.ceil(r.ph * scale);
      g.save();
      g.translate(r.x, r.y);
      g.beginPath(); g.rect(0, 0, r.pw, r.ph); g.clip();
      r.draw(g, r.pw, r.ph);
      g.restore();
    }
    const n = this.reqs.length;
    const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uvs = new Float32Array(n * 8);
    const idx: number[] = [];
    this.reqs.forEach((r, k) => {
      const u0 = r.x / S, u1 = (r.x + r.pw) / S, vTop = 1 - r.y / CH, vBot = 1 - (r.y + r.ph) / CH;
      const uv4 = [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]];
      for (let j = 0; j < 4; j++) {
        pos.set(r.pos[j], (k * 4 + j) * 3);
        nor.set(r.nrm, (k * 4 + j) * 3);
        uvs.set(uv4[j], (k * 4 + j) * 2);
      }
      const b = k * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = `${this.name}_inscriptions`;
    const A = texture(tex, uv());
    mat.colorNode = A;
    mat.opacityNode = A.a;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.roughnessNode = float(0.82);
    (mat as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
    if (this.exterior) mat.userData.exterior = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${this.name}:inscriptions`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    return mesh;
  }
}

const FONT_ROMAN = 'Georgia, "Times New Roman", "Nimbus Roman", "DejaVu Serif", serif';
const FONT_SANS = 'Arial, Helvetica, "DejaVu Sans", sans-serif';
const FONT_PAINT = '"Segoe Script", "Bradley Hand", "Brush Script MT", "URW Chancery L", cursive';
const FONT_ROUND = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive';

interface TextStyle {
  font: string;
  mode: 'engrave' | 'gild' | 'paint';
  color?: string;
  weight?: string;
  lead?: number;
  pad?: number;
  /** Letter erosion 0..1 (weathering). */
  wear?: number;
  seed?: number;
}
type Line = { t: string; s?: number; color?: string; crisp?: boolean };

function paintText(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, st: TextStyle, color?: string): void {
  if (st.mode === 'engrave') {
    g.fillStyle = 'rgba(236,232,222,0.32)';
    g.fillText(t, x + size * 0.05, y + size * 0.06);
    g.fillStyle = color ?? st.color ?? 'rgba(26,25,23,0.84)';
    g.fillText(t, x, y);
  } else if (st.mode === 'gild') {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(t, x - size * 0.04, y - size * 0.04);
    const gr = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    gr.addColorStop(0, '#f2da92'); gr.addColorStop(0.5, '#bd913c'); gr.addColorStop(1, '#7c5c24');
    g.fillStyle = color ?? gr;
    g.fillText(t, x, y);
  } else {
    g.fillStyle = color ?? st.color ?? '#202020';
    g.fillText(t, x, y);
  }
}

/** Centred block of lines filling the panel (lines shrink to fit the width). */
function textBlock(lines: Line[], st: TextStyle): DrawFn {
  return (g, w, h) => {
    const lead = st.lead ?? 1.32;
    const padX = w * (st.pad ?? 0.06), padY = h * (st.pad ?? 0.06);
    const total = lines.reduce((a, l) => a + (l.s ?? 1), 0) * lead;
    const unit = (h - 2 * padY) / Math.max(total, 1e-3);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let y = padY;
    const crispRows: [number, number][] = [];
    for (const l of lines) {
      const s = l.s ?? 1;
      let size = unit * s * 0.9;
      const font = (sz: number) => `${st.weight ?? ''} ${sz.toFixed(1)}px ${st.font}`;
      g.font = font(size);
      const mw = g.measureText(l.t).width;
      if (mw > w - 2 * padX) { size *= (w - 2 * padX) / mw; g.font = font(size); }
      const cy = y + (unit * s * lead) / 2;
      if (l.t) paintText(g, l.t, w / 2, cy, size, st, l.color);
      if (l.crisp) crispRows.push([y, y + unit * s * lead]);
      y += unit * s * lead;
    }
    if (st.wear && st.wear > 0) erode(g, w, h, st.wear, st.seed ?? 1, crispRows);
  };
}

/** Weathering: punch speckles out of the letters (except in crisp rows). */
function erode(g: CanvasRenderingContext2D, w: number, h: number, wear: number, seed: number, keep: [number, number][] = []): void {
  const rng = new RNG(seed);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h * 0.004 * wear);
  for (let i = 0; i < n; i++) {
    const x = rng.float() * w, y = rng.float() * h;
    if (keep.some(([a, b]) => y > a && y < b)) continue;
    const r = (0.6 + rng.float() * 2.2) * Math.max(1, w / 300);
    g.globalAlpha = 0.4 + rng.float() * 0.6;
    g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
  }
  // a few long cracks / lichen gaps
  for (let i = 0; i < Math.round(3 * wear); i++) {
    g.globalAlpha = 0.7;
    g.lineWidth = 1 + rng.float() * 2;
    g.beginPath();
    let x = rng.float() * w, y = rng.float() * h;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rng.range(-w * 0.1, w * 0.1); y += rng.range(-h * 0.08, h * 0.08); g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
}

/** Lichen / dirt blotches on a stone face (drawn behind the letters). */
function lichen(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const rng = new RNG(seed);
  const n = Math.round(4 + amount * 14);
  for (let i = 0; i < n; i++) {
    const x = rng.float() * w, y = rng.float() * h, r = (0.04 + rng.float() * 0.12) * Math.min(w, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rng.chance(0.6) ? '150,160,110' : '205,200,170';
    gr.addColorStop(0, `rgba(${c},${0.18 + rng.float() * 0.25})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

// ===================================================================================
// 1. GREENHOUSE (Glashaus, 1930s steel/timber frame on a brick plinth)
// ===================================================================================

const GH = BUILDINGS.greenhouse;
const GH_T = 0.25;
const GH_BENCH_TOP = 0.82;
const GH_SEC = 1.6;
const GH_BX0 = GH.x0 + 0.9;
const GH_NB = { z0: GH.z0 + GH_T + 0.03, z1: GH.z0 + GH_T + 0.85, sections: 8, collapsed: [2] };
const GH_SB = { z0: GH.z1 - GH_T - 0.85, z1: GH.z1 - GH_T - 0.03, sections: 7, collapsed: [4] };
/** Raised bed in the south-east corner – the one place where something still grows. */
const GH_BED = { x0: GH_BX0 + GH_SB.sections * GH_SEC + 0.05, x1: GH.x1 - GH_T - 0.98, z0: GH.z1 - GH_T - 1.7, z1: GH.z1 - GH_T - 0.02 };
/** Potting bench across the east end (top height relative to the floor; shelf above at 1.55). */
const GH_POT = { x0: GH.x1 - GH_T - 0.88, x1: GH.x1 - GH_T - 0.03, z0: (GH.z0 + GH.z1) / 2 - 1.6, z1: (GH.z0 + GH.z1) / 2 + 0.7, top: 0.86, shelf: 1.565 };
export const GREENHOUSE_POTTING_BENCH: Readonly<typeof GH_POT> = GH_POT;

export interface GreenhousePot { x: number; y: number; z: number; ry: number; state: 'dead' | 'empty' | 'sprout' | 'fallen' }
/** Clay pots (placed as props by SacredProps; the builder adds what grows – or died – in them). y relative to the floor. */
export const GREENHOUSE_POTS: GreenhousePot[] = (() => {
  const rng = new RNG('greenhouse-pots');
  const out: GreenhousePot[] = [];
  const free = (x: number, z: number) => !out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3);
  const bench = (b: typeof GH_NB) => {
    for (let s = 0; s < b.sections; s++) {
      if (b.collapsed.includes(s)) continue;
      const n = rng.int(1, 4);
      for (let k = 0; k < n; k++) {
        const x = GH_BX0 + s * GH_SEC + 0.22 + rng.float() * (GH_SEC - 0.44);
        const z = b.z0 + 0.18 + rng.float() * (b.z1 - b.z0 - 0.36);
        if (free(x, z)) out.push({ x, y: GH_BENCH_TOP, z, ry: rng.float() * PI * 2, state: rng.chance(0.72) ? 'dead' : 'empty' });
      }
    }
  };
  bench(GH_NB);
  bench(GH_SB);
  // knocked off the benches
  out.push({ x: GH_BX0 + 2.6 * GH_SEC, y: 0.13, z: GH_NB.z1 + 0.35, ry: 0.7, state: 'fallen' });
  out.push({ x: GH_BX0 + 4.4 * GH_SEC, y: 0.13, z: GH_SB.z0 - 0.3, ry: 2.1, state: 'fallen' });
  // the tidy ones on the potting bench next to the raised bed
  out.push({ x: GH_POT.x0 + 0.18, y: GH_POT.top + 0.005, z: GH_POT.z1 - 0.2, ry: 0.3, state: 'sprout' });
  out.push({ x: GH_POT.x0 + 0.62, y: GH_POT.top + 0.005, z: GH_POT.z1 - 0.22, ry: 1.2, state: 'sprout' });
  out.push({ x: GH_POT.x1 - 0.12, y: GH_POT.shelf, z: GH_POT.z0 + 0.8, ry: 2.2, state: 'empty' });
  return out;
})();

/** Seeding trays (props) with seedlings (geometry). y relative to the floor. */
export const GREENHOUSE_TRAYS: { x: number; y: number; z: number; ry: number }[] = [
  { x: GH_POT.x0 + 0.25, y: GH_POT.top + 0.005, z: GH_POT.z1 - 1.2, ry: 0.05 },
  { x: GH_POT.x0 + 0.53, y: GH_POT.top + 0.005, z: GH_POT.z1 - 1.22, ry: -0.04 },
  { x: GH_BED.x0 + 0.25, y: 0.37, z: GH_BED.z0 + 0.22, ry: 0.1 },
];

export function buildGreenhouse(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  defineSacredMaterials(materials);
  const kit = new BuildingKit('greenhouse', physics, { mat: 'brick' });
  const mb = kit.mb;
  const rng = new RNG('greenhouse');
  const tr = rectRange(heightAt, GH.x0, GH.z0, GH.x1, GH.z1);
  const F = Math.max(GH.floorY, tr.max + 0.05);
  SACRED_LEVELS.greenhouseFloor = F;
  SACRED_LEVELS.ground = heightAt;
  const T = GH_T;
  const PB = tr.min - 0.35, PT = F + 0.62, EH = F + 2.35;
  const xa = GH.x0 + T / 2, xb = GH.x1 - T / 2, za = GH.z0 + T / 2, zb = GH.z1 - T / 2;
  const zc = (GH.z0 + GH.z1) / 2;
  const pitch = (30 * PI) / 180, tan = Math.tan(pitch);
  const RH = EH + (zc - za) * tan;
  const roofY = (z: number) => EH + (zc - za - Math.abs(z - zc)) * tan;
  const IX0 = GH.x0 + T, IX1 = GH.x1 - T, IZ0 = GH.z0 + T, IZ1 = GH.z1 - T;

  kit.room({ id: 'greenhouse', location: 'greenhouse', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: F, y1: RH, floor: null, ceiling: null, wall: 'brick', env: 'room_large' });

  // ---------------------------------------------------------------- brick plinth & floor
  const doorW = 1.07, doorAt = zc - za;
  const plinth = { y0: PB, y1: PT, t: T, left: 'brick', right: 'brick', cap: 'brick', ext0: T / 2, ext1: T / 2, surface: 'stone', skirting: false } as const;
  kit.wall({ ...plinth, a: [xa, zb], b: [xb, zb] });
  kit.wall({ ...plinth, a: [xb, zb], b: [xb, za] });
  kit.wall({ ...plinth, a: [xb, za], b: [xa, za] });
  kit.wall({ ...plinth, a: [xa, za], b: [xa, zb], doors: [{ o: { at: doorAt, width: doorW, bottom: F - PB, top: PT - PB, kind: 'door' }, frame: null }] });
  buildSlab(mb, IX0, IZ0, IX1, IZ1, F, 0.2, 'gravel', null, physics, 'gravel');
  // brick-paver path down the middle
  mb.box('brick', (IX0 + GH_POT.x0 - 0.05) / 2, F + 0.015, zc, GH_POT.x0 - 0.05 - IX0, 0.03, 0.9, { skip: ['ny'] });
  // stepping slab outside the door
  {
    const g = rectRange(heightAt, GH.x0 - 1.0, zc - 0.6, GH.x0, zc + 0.6).max;
    mb.box('concrete', GH.x0 - 0.5, g - 0.06, zc, 0.9, 0.2, 1.1, { skip: ['ny'] });
  }

  // ---------------------------------------------------------------- frame & glazing
  const nBays = 25, p = (xb - xa) / nBays;
  const sillY = PT + 0.09, plateY = EH - 0.12;
  // timber sill on the plinth and eave plates
  mb.box('gh_wood', (GH.x0 + GH.x1) / 2, PT + 0.045, za, GH.x1 - GH.x0, 0.09, 0.16);
  mb.box('gh_wood', (GH.x0 + GH.x1) / 2, PT + 0.045, zb, GH.x1 - GH.x0, 0.09, 0.16);
  mb.box('gh_wood', xb, PT + 0.045, zc, 0.16, 0.09, zb - za);
  for (const [z0, z1] of [[za, zc - doorW / 2], [zc + doorW / 2, zb]]) mb.box('gh_wood', xa, PT + 0.045, (z0 + z1) / 2, 0.16, 0.09, z1 - z0);
  mb.box('gh_wood', (GH.x0 + GH.x1) / 2, EH - 0.06, za, GH.x1 - GH.x0 + 0.1, 0.12, 0.13);
  mb.box('gh_wood', (GH.x0 + GH.x1) / 2, EH - 0.06, zb, GH.x1 - GH.x0 + 0.1, 0.12, 0.13);
  mb.box('gh_wood', (GH.x0 + GH.x1) / 2, RH - 0.06, zc, GH.x1 - GH.x0 + 0.12, 0.18, 0.05);

  const corner = (x: number, z: number) => x > GH_BED.x0 - 0.4 && z > GH_BED.z0 - 0.6;
  /** Pane (a,b,c,d CCW seen from `out`); broken panes become shards or are gone. */
  const pane = (mat: string, a: number[], b: number[], c: number[], d: number[], out: number[], broken: number) => {
    if (rng.chance(broken)) {
      if (rng.chance(0.45)) return;
      const ctr = lerp3(lerp3(a, b, 0.5), lerp3(c, d, 0.5), 0.5);
      const edges = [[a, b], [b, c], [c, d], [d, a]];
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const [e0, e1] = edges[rng.int(0, 3)];
        const t0 = rng.range(0.0, 0.6), t1 = Math.min(1, t0 + rng.range(0.15, 0.4));
        const p0 = lerp3(e0, e1, t0), p1 = lerp3(e0, e1, t1);
        const tip = lerp3(lerp3(p0, p1, rng.range(0.3, 0.7)), ctr, rng.range(0.15, 0.55));
        triToward(mb, mat, p0, p1, tip, out);
      }
      return;
    }
    quadToward(mb, mat, a, b, c, d, out);
  };
  const shards: number[][] = [];

  // long walls
  for (const side of [-1, 1] as const) {
    const zw = side < 0 ? za : zb;
    for (let k = 0; k <= nBays; k++) {
      const x = xa + k * p;
      const main = k % 5 === 0;
      mb.box(main ? 'rust_metal' : 'gh_wood', x, (sillY + plateY) / 2, zw, main ? 0.07 : 0.045, plateY - sillY, main ? 0.09 : 0.06);
    }
    const rows = 3, rh = (plateY - sillY) / rows;
    for (let k = 0; k < nBays; k++) {
      const x0 = xa + k * p + 0.024, x1 = xa + (k + 1) * p - 0.024;
      for (let r = 0; r < rows; r++) {
        const y0 = sillY + r * rh - (r ? 0.02 : 0), y1 = sillY + (r + 1) * rh;
        const zz = zw + side * (0.036 + r * 0.004);
        const fix = corner((x0 + x1) / 2, side > 0 ? zb : za) && side > 0;
        const mat = fix && rng.chance(0.5) ? 'gh_plastic' : side > 0 && r === 2 && rng.chance(0.6) ? 'gh_whitewash' : 'glass';
        const brk = fix ? 0 : 0.3;
        const before = rng.float();
        pane(mat, [x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz], [0, 0, side], brk);
        if (before < 0.12 && !fix) shards.push([(x0 + x1) / 2, zw - side * rng.range(0.3, 1.2)]);
      }
    }
    physics?.addBox({ cx: (xa + xb) / 2, cy: (PT + EH) / 2, cz: zw, hx: (xb - xa) / 2, hy: (EH - PT) / 2, hz: 0.05, surface: 'glass' });
  }

  // gable walls (west with the door)
  const nG = 10, pg = (zb - za) / nG;
  for (const end of [-1, 1] as const) {
    const xg = end < 0 ? xa : xb;
    const isDoor = (k: number) => end < 0 && (k === 4 || k === 5);
    for (let k = 0; k <= nG; k++) {
      const z = za + k * pg;
      const top = roofY(z) - 0.03;
      if (end < 0 && (k === 4 || k === 6)) {
        mb.box('gh_wood', xg, (F + top) / 2, z, 0.1, top - F, 0.08);  // door posts
        continue;
      }
      const y0 = end < 0 && k === 5 ? F + 2.15 : sillY;
      if (top > y0 + 0.02) mb.box(k === 0 || k === nG ? 'rust_metal' : 'gh_wood', xg, (y0 + top) / 2, z, 0.06, top - y0, 0.045);
    }
    if (end < 0) mb.box('gh_wood', xg, F + 2.1, zc, 0.1, 0.1, 2 * pg + 0.08);       // door head
    const out = [end, 0, 0];
    const xx = xg + end * 0.036;
    for (let k = 0; k < nG; k++) {
      const z0 = za + k * pg + 0.024, z1 = za + (k + 1) * pg - 0.024;
      const lo = isDoor(k) ? F + 2.15 : sillY;
      const rows = isDoor(k) ? 1 : 3, rh = (plateY - lo) / rows;
      for (let r = 0; r < rows; r++) {
        const y0 = lo + r * rh, y1 = lo + (r + 1) * rh;
        pane('glass', [xx, y0, z0], [xx, y0, z1], [xx, y1, z1], [xx, y1, z0], out, 0.28);
      }
      pane(rng.chance(0.4) ? 'gh_whitewash' : 'glass', [xx, plateY, z0], [xx, plateY, z1], [xx, roofY(z1) - 0.05, z1], [xx, roofY(z0) - 0.05, z0], out, 0.2);
    }
    // bargeboards
    mb.beam('gh_wood', V3(xg + end * 0.03, EH - 0.02, GH.z0 - 0.08), V3(xg + end * 0.03, RH + 0.02, zc), 0.05, 0.14);
    mb.beam('gh_wood', V3(xg + end * 0.03, RH + 0.02, zc), V3(xg + end * 0.03, EH - 0.02, GH.z1 + 0.08), 0.05, 0.14);
    if (end > 0) physics?.addBox({ cx: xg, cy: (PT + EH) / 2, cz: zc, hx: 0.05, hy: (EH - PT) / 2, hz: (zb - za) / 2, surface: 'glass' });
    else {
      const zd0 = zc - doorW / 2, zd1 = zc + doorW / 2;
      physics?.addBox({ cx: xg, cy: (PT + EH) / 2, cz: (za + zd0) / 2, hx: 0.05, hy: (EH - PT) / 2, hz: (zd0 - za) / 2, surface: 'glass' });
      physics?.addBox({ cx: xg, cy: (PT + EH) / 2, cz: (zd1 + zb) / 2, hx: 0.05, hy: (EH - PT) / 2, hz: (zb - zd1) / 2, surface: 'glass' });
      physics?.addBox({ cx: xg, cy: (F + 2.05 + EH) / 2, cz: zc, hx: 0.05, hy: (EH - F - 2.05) / 2, hz: doorW / 2, surface: 'wood' });
    }
  }

  // roof: bars, rafters, trusses, panes, vents
  const nrm = (side: number) => [0, Math.cos(pitch), side * Math.sin(pitch)];
  for (const side of [-1, 1] as const) {
    const zw = side < 0 ? za : zb;
    const n = nrm(side);
    const P = (x: number, t: number, off: number) => [x + n[0] * off, EH + t * (RH - EH) + n[1] * off, zw + t * (zc - zw) + n[2] * off];
    for (let k = 0; k <= nBays; k++) {
      const x = xa + k * p;
      const main = k % 5 === 0 && k > 0 && k < nBays;
      const a = P(x, 0, main ? -0.05 : 0), b = P(x, 1, main ? -0.05 : 0);
      mb.beam(main ? 'rust_metal' : 'gh_wood', V3(a[0], a[1], a[2]), V3(b[0], b[1], b[2]), main ? 0.06 : 0.045, main ? 0.1 : 0.06);
    }
    // purlin
    const pa = P(xa, 0.5, -0.07), pb = P(xb, 0.5, -0.07);
    mb.beam('gh_wood', V3(pa[0], pa[1], pa[2]), V3(pb[0], pb[1], pb[2]), 0.05, 0.08);
    const rows = 4;
    for (let k = 0; k < nBays; k++) {
      const x0 = xa + k * p + 0.024, x1 = xa + (k + 1) * p - 0.024;
      for (let r = 0; r < rows; r++) {
        const t0 = r / rows - (r ? 0.008 : 0), t1 = r === rows - 1 ? 0.975 : (r + 1) / rows;
        const off = 0.036 + r * 0.004;
        const fix = side > 0 && corner((x0 + x1) / 2, zb) && r < 2;
        const vent = side < 0 && r === rows - 1 && k % 4 === 2;
        if (vent) {
          // hinged vent sash at the ridge, some propped open
          const ang = rng.chance(0.6) ? rng.range(0.15, 0.55) : 0;
          const hingeA = P(x0, t1, off), hingeB = P(x1, t1, off);
          const down = sub(P(x0, t0, off), hingeA);
          const len = Math.hypot(down[0], down[1], down[2]);
          // swing the down-slope direction out of the roof plane (towards its normal) by ang
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const dv = [0, 1, 2].map((k) => (down[k] / len) * ca + n[k] * sa);
          const c0 = [hingeA[0], hingeA[1] + dv[1] * len, hingeA[2] + dv[2] * len];
          const c1 = [hingeB[0], hingeB[1] + dv[1] * len, hingeB[2] + dv[2] * len];
          pane('glass', c0, c1, hingeB, hingeA, n, 0.15);
          mb.beam('gh_wood', V3(hingeA[0], hingeA[1], hingeA[2]), V3(c0[0], c0[1], c0[2]), 0.04, 0.04);
          mb.beam('gh_wood', V3(hingeB[0], hingeB[1], hingeB[2]), V3(c1[0], c1[1], c1[2]), 0.04, 0.04);
          mb.beam('gh_wood', V3(c0[0], c0[1], c0[2]), V3(c1[0], c1[1], c1[2]), 0.04, 0.04);
          if (ang > 0) mb.rod('rust_metal', V3((x0 + x1) / 2, c0[1] - 0.3 * dv[1] - 0.25, c0[2] - 0.3 * dv[2]), V3((x0 + x1) / 2, (c0[1] + hingeA[1]) / 2, (c0[2] + hingeA[2]) / 2), 0.006);
          continue;
        }
        const mat = fix ? 'gh_plastic' : rng.chance(0.72) ? 'gh_whitewash' : 'glass';
        const before = rng.float();
        pane(mat, P(x0, t0, off), P(x1, t0, off), P(x1, t1, off), P(x0, t1, off), n, fix ? 0 : 0.22);
        if (before < 0.08 && !fix) shards.push([(x0 + x1) / 2, zw + (zc - zw) * rng.range(0.2, 0.9)]);
      }
    }
    // plastic sheet over the repaired corner: battens holding it down
    if (side > 0) for (const t of [0.02, 0.48]) {
      const a = P(GH_BED.x0 - 0.3, t, 0.06), b = P(xb, t, 0.06);
      mb.beam('rough_timber_ext', V3(a[0], a[1], a[2]), V3(b[0], b[1], b[2]), 0.04, 0.02);
    }
    roofCollider(physics, [[xa - 0.05, EH + 0.04, zw], [xb + 0.05, EH + 0.04, zw], [xb + 0.05, RH + 0.04, zc], [xa - 0.05, RH + 0.04, zc]], [0, side], pitch, 0.06, 'glass');
    gutter(mb, 'rust_metal', V3(GH.x0 - 0.05, EH - 0.03, zw + side * 0.1), V3(GH.x1 + 0.05, EH - 0.03, zw + side * 0.1));
  }
  // steel trusses
  for (let k = 5; k < nBays; k += 5) {
    const x = xa + k * p;
    const ty = EH + 0.3, dz = 0.3 / tan;
    mb.beam('rust_metal', V3(x, ty, za + dz), V3(x, ty, zb - dz), 0.05, 0.06);
    mb.beam('rust_metal', V3(x, ty, zc), V3(x, RH - 0.15, zc), 0.05, 0.05);
    for (const s of [-1, 1]) {
      const zm = (zc + (s < 0 ? za : zb)) / 2;
      mb.beam('rust_metal', V3(x, ty, zc), V3(x, roofY(zm) - 0.08, zm), 0.04, 0.04);
    }
  }
  // downpipe into the rain barrel (prop) at the north-east corner
  mb.rod('rust_metal', V3(GH.x1 + 0.05, EH - 0.06, za - 0.1), V3(GH.x1 + 0.35, EH - 0.3, za - 0.4), 0.04);
  mb.rod('rust_metal', V3(GH.x1 + 0.35, EH - 0.3, za - 0.4), V3(GH.x1 + 0.35, heightAt(GH.x1 + 0.45, GH.z0 - 0.45) + 1.0, za - 0.4), 0.04);

  // ---------------------------------------------------------------- door
  const vframe = wallFrame({ a: [xa, za], b: [xa, zb], y0: F, y1: F + 2.1, t: 0.08 });
  kit.doorInWall('door:greenhouse_front', vframe, { at: doorAt, width: doorW, bottom: 0, top: 2.05, kind: 'door' }, { style: 'glazed', mat: 'painted_wood_white_ext', handle: 'lever', handleMat: 'iron_black', seed: 5 }, -1, -1, { open: 0.55, sound: 'wood' });

  // ---------------------------------------------------------------- benches
  const bench = (b: typeof GH_NB) => {
    const x0 = GH_BX0, x1 = GH_BX0 + b.sections * GH_SEC;
    const top = F + GH_BENCH_TOP;
    for (let s = 0; s <= b.sections; s++) {
      const x = x0 + s * GH_SEC;
      const leftCollapsed = b.collapsed.includes(s - 1), rightCollapsed = b.collapsed.includes(s);
      for (const z of [b.z0 + 0.04, b.z1 - 0.04]) {
        if (leftCollapsed && rightCollapsed) continue;
        mb.box('rough_timber', x, F + (GH_BENCH_TOP - 0.03) / 2, z, 0.06, GH_BENCH_TOP - 0.03, 0.06, { uv: 'local', uvRotate: true });
      }
      mb.box('rough_timber', x, top - 0.07, (b.z0 + b.z1) / 2, 0.05, 0.08, b.z1 - b.z0 - 0.02, { uv: 'local' });
    }
    for (let s = 0; s < b.sections; s++) {
      const sx0 = x0 + s * GH_SEC, sx1 = sx0 + GH_SEC;
      if (b.collapsed.includes(s)) {
        // slats slid down to the floor at one end, a leg snapped
        for (let k = 0; k < 7; k++) {
          const z = b.z0 + 0.07 + k * ((b.z1 - b.z0 - 0.14) / 6) + rng.range(-0.02, 0.02);
          const ya = F + 0.03 + rng.range(0, 0.05), yb = top - 0.04 - rng.range(0, 0.06);
          if (rng.chance(0.2)) continue;
          mb.beam('rough_timber', V3(sx0 + 0.15 + rng.range(-0.05, 0.05), ya, z), V3(sx1 - 0.05, yb, z + rng.range(-0.05, 0.05)), 0.085, 0.022, V3(0, 1, 0));
        }
        mb.beam('rough_timber', V3(sx0 + 0.2, F + 0.03, b.z0 + 0.2), V3(sx0 + 0.85, F + 0.05, b.z0 + 0.45), 0.06, 0.06);
        continue;
      }
      for (const z of [b.z0 + 0.03, b.z1 - 0.03]) mb.box('rough_timber', (sx0 + sx1) / 2, top - 0.05, z, GH_SEC, 0.06, 0.04, { uv: 'local' });
      for (let k = 0; k < 7; k++) {
        if (rng.chance(0.06)) continue;
        const z = b.z0 + 0.07 + k * ((b.z1 - b.z0 - 0.14) / 6);
        mb.withColor([0.8 + rng.float() * 0.2, 0.78 + rng.float() * 0.2, 0.75 + rng.float() * 0.2], () => {
          mb.box('rough_timber', (sx0 + sx1) / 2, top - 0.0125, z, GH_SEC - 0.01, 0.025, 0.09, { uv: 'local', uvOffset: [rng.float() * 3, rng.float() * 3] });
        });
      }
      physics?.addBox({ cx: (sx0 + sx1) / 2, cy: F + GH_BENCH_TOP / 2, cz: (b.z0 + b.z1) / 2, hx: GH_SEC / 2, hy: GH_BENCH_TOP / 2, hz: (b.z1 - b.z0) / 2, surface: 'wood' });
    }
    void x1;
  };
  bench(GH_NB);
  bench(GH_SB);

  // ---------------------------------------------------------------- potting bench (east end)
  {
    const P = GH_POT;
    const top = F + P.top;
    for (const x of [P.x0 + 0.05, P.x1 - 0.05]) for (const z of [P.z0 + 0.05, P.z1 - 0.05]) mb.box('rough_timber', x, F + P.top / 2, z, 0.07, P.top, 0.07, { uv: 'local', uvRotate: true });
    mb.box('rough_timber', (P.x0 + P.x1) / 2, top - 0.02, (P.z0 + P.z1) / 2, P.x1 - P.x0, 0.04, P.z1 - P.z0, { uv: 'local', uvRotate: true });
    mb.box('rough_timber', (P.x0 + P.x1) / 2, F + 0.25, (P.z0 + P.z1) / 2, P.x1 - P.x0 - 0.04, 0.03, P.z1 - P.z0 - 0.04, { uv: 'local', uvRotate: true });
    // up-stand and shelf on brackets against the glazing
    mb.box('rough_timber', P.x1 - 0.02, top + 0.2, (P.z0 + P.z1) / 2, 0.03, 0.4, P.z1 - P.z0, { uv: 'local' });
    mb.box('rough_timber', P.x1 - 0.12, F + P.shelf - 0.015, (P.z0 + P.z1) / 2, 0.2, 0.03, P.z1 - P.z0 - 0.2, { uv: 'local' });
    for (const z of [P.z0 + 0.3, P.z1 - 0.3]) mb.box('rust_metal', P.x1 - 0.06, F + 1.5, z, 0.12, 0.1, 0.02);
    // soil heap on the bench, twine, labels
    mound(mb, 'gh_soil_dry', P.x0 + 0.48, top, P.z0 + 0.35, 0.4, 0.26, 0.08, 0.24);
    mb.cylinder('hay', P.x0 + 0.15, top, P.z0 + 0.72, 0.05, 0.05, 0.09, 10);
    for (let i = 0; i < 6; i++) mb.box('painted_wood_white', P.x0 + 0.58 + rng.range(-0.05, 0.05), top + 0.002, P.z0 + 0.62 + i * 0.03, 0.12, 0.004, 0.018);
    physics?.addBox({ cx: (P.x0 + P.x1) / 2, cy: F + P.top / 2, cz: (P.z0 + P.z1) / 2, hx: (P.x1 - P.x0) / 2, hy: P.top / 2, hz: (P.z1 - P.z0) / 2, surface: 'wood' });
    kit.anchor('greenhouse_potting_bench', (P.x0 + P.x1) / 2, top, (P.z0 + P.z1) / 2, -PI / 2, 'greenhouse');
  }

  // ---------------------------------------------------------------- the corner that is still tended
  {
    const B = GH_BED, bh = 0.36, soil = F + bh - 0.03;
    for (const [x0, z0, x1, z1] of [[B.x0, B.z0, B.x1, B.z0 + 0.04], [B.x0, B.z1 - 0.04, B.x1, B.z1], [B.x0, B.z0, B.x0 + 0.04, B.z1], [B.x1 - 0.04, B.z0, B.x1, B.z1]]) {
      mb.box('rough_timber', (x0 + x1) / 2, F + bh / 2, (z0 + z1) / 2, x1 - x0, bh, z1 - z0, { uv: 'local' });
    }
    quadToward(mb, 'gh_soil', [B.x0 + 0.04, soil, B.z0 + 0.04], [B.x1 - 0.04, soil, B.z0 + 0.04], [B.x1 - 0.04, soil, B.z1 - 0.04], [B.x0 + 0.04, soil, B.z1 - 0.04], [0, 1, 0]);
    physics?.addBox({ cx: (B.x0 + B.x1) / 2, cy: F + bh / 2, cz: (B.z0 + B.z1) / 2, hx: (B.x1 - B.x0) / 2, hy: bh / 2, hz: (B.z1 - B.z0) / 2, surface: 'wood' });
    // tomatoes tied to stakes
    const plants: P2[] = [[B.x0 + 0.45, B.z0 + 0.5], [B.x0 + 1.05, B.z0 + 0.4], [B.x0 + 0.75, B.z1 - 0.45], [B.x1 - 0.3, B.z1 - 0.4]];
    plants.forEach(([x, z], pi) => tomato(mb, rng.fork(`tomato${pi}`), x, soil, z));
    // lettuce row
    for (let i = 0; i < 4; i++) lettuce(mb, rng, B.x0 + 0.3 + i * 0.36, soil, B.z1 - 0.95);
    // seedlings in the trays
    for (const t of GREENHOUSE_TRAYS) seedlings(mb, rng, t.x, F + t.y + 0.05, t.z, 0.085, 14);
  }

  // ---------------------------------------------------------------- what died in the pots
  for (const pot of GREENHOUSE_POTS) {
    const y = F + pot.y + 0.19;
    if (pot.state === 'dead') deadPlant(mb, rng, pot.x, y, pot.z);
    else if (pot.state === 'sprout') seedlings(mb, rng, pot.x, y, pot.z, 0.08, 6);
  }
  // dead vines up the south glazing, tied with string to the bars
  for (const x of [22.4, 25.4, 28.3]) {
    const pts: THREE.Vector3[] = [];
    let px = x, py = F + GH_BENCH_TOP, pz = zb - 0.12;
    for (let i = 0; i < 9; i++) {
      pts.push(V3(px, py, pz));
      px += rng.range(-0.18, 0.18); py += rng.range(0.16, 0.24); pz = zb - 0.1 + rng.range(-0.03, 0.03);
    }
    for (let i = 0; i < 5; i++) { pts.push(V3(px, Math.min(py, roofY(pz) - 0.12), pz)); px += rng.range(0.1, 0.3); pz -= rng.range(0.2, 0.35); py = roofY(pz) - 0.12; }
    mb.tube('gh_stalk_dead', pts, pts.map((_, i) => 0.012 - i * 0.0006), 5);
    for (let i = 2; i < pts.length; i += 2) {
      const q = pts[i];
      quadToward(mb, 'gh_leaf_dead', [q.x, q.y, q.z], [q.x + 0.07, q.y - 0.05, q.z - 0.02], [q.x + 0.05, q.y - 0.12, q.z - 0.04], [q.x - 0.02, q.y - 0.07, q.z - 0.02], [0, 0, -1]);
    }
  }
  // broken glass on the floor and benches
  for (const [x, z] of shards) {
    const onBench = (z > GH_NB.z0 && z < GH_NB.z1) || (z > GH_SB.z0 && z < GH_SB.z1);
    const y = (onBench && x > GH_BX0 && x < GH_BX0 + 8 * GH_SEC ? F + GH_BENCH_TOP : F) + 0.004;
    for (let k = 0; k < 3; k++) {
      const cx = x + rng.range(-0.25, 0.25), cz = z + rng.range(-0.25, 0.25), r = rng.range(0.04, 0.12), a = rng.float() * PI * 2;
      triToward(mb, 'glass', [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], [cx + Math.cos(a + 2.1) * r * 0.7, y, cz + Math.sin(a + 2.1) * r * 0.7], [cx + Math.cos(a + 4.0) * r * 0.5, y, cz + Math.sin(a + 4.0) * r * 0.5], [0, 1, 0]);
    }
  }

  kit.span({ x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, floorY: F, ceil: (x, z) => roofY(z) - 0.03 });
  const group = mb.build(materials, { name: 'greenhouse' });
  // translucent whitewash / plastic must not block the sun
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh && /gh_whitewash|gh_plastic/.test(o.name)) o.castShadow = false; });
  levelsChanged();
  return kit.output(group);
}

/** Tomato plant on a stake: zig-zag stem, compound leaves, trusses of fruit. */
function tomato(mb: MeshBuilder, rng: RNG, x: number, y: number, z: number): void {
  const H = rng.range(1.15, 1.45);
  mb.rod('rough_timber', V3(x + 0.03, y - 0.1, z), V3(x + 0.03, y + H + 0.15, z), 0.011, 0.011, 5);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(V3(x + (i % 2 ? 0.015 : -0.01) + rng.range(-0.01, 0.01), y + (H * i) / 8, z + rng.range(-0.015, 0.015)));
  mb.tube('gh_stem', pts, pts.map((_, i) => 0.009 - i * 0.0006), 5);
  for (let i = 1; i <= 7; i++) {
    const s = pts[i];
    if (i % 2 === 0) mb.box('hay', x + 0.015, s.y, z, 0.05, 0.008, 0.03);         // raffia tie
    const leaves = rng.int(1, 2);
    for (let l = 0; l < leaves; l++) {
      const a = rng.float() * PI * 2, len = rng.range(0.18, 0.3);
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let f = 0; f < 5; f++) {
        const t = 0.25 + f * 0.17;
        const cx = s.x + dx * len * t, cy = s.y - 0.02 - t * t * 0.08, cz = s.z + dz * len * t;
        const side = f % 2 ? 1 : -1, ls = 0.05 + rng.float() * 0.02;
        const px = -dz * side, pz = dx * side;
        quadToward(mb, 'gh_leaf', [cx, cy, cz], [cx + px * ls * 0.5 + dx * 0.02, cy - 0.01, cz + pz * ls * 0.5 + dz * 0.02], [cx + px * ls + dx * 0.04, cy - 0.02, cz + pz * ls + dz * 0.04], [cx + dx * 0.05, cy - 0.005, cz + dz * 0.05], [0, 1, 0]);
      }
    }
    if (i >= 2 && i <= 5 && i % 2 === 1) {
      const a = rng.float() * PI * 2;
      for (let t = 0; t < 4; t++) {
        const r = rng.range(0.02, 0.03);
        const red = i <= 3 ? rng.chance(0.6) : rng.chance(0.2);
        sphere(mb, red ? 'gh_tomato' : 'gh_tomato_green', s.x + Math.cos(a) * (0.06 + t * 0.03), s.y - 0.05 - t * 0.025, s.z + Math.sin(a) * (0.06 + t * 0.03), r, 7, 4, 0.9);
      }
    }
  }
}

function lettuce(mb: MeshBuilder, rng: RNG, x: number, y: number, z: number): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * PI * 2 + rng.float() * 0.4, l = rng.range(0.07, 0.11), up = rng.range(0.04, 0.08);
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz * 0.035, pz = dx * 0.035;
    quadToward(mb, 'gh_leaf', [x, y + 0.01, z], [x + dx * l * 0.5 + px, y + up * 0.6, z + dz * l * 0.5 + pz], [x + dx * l, y + up, z + dz * l], [x + dx * l * 0.5 - px, y + up * 0.6, z + dz * l * 0.5 - pz], [0, 1, 0]);
  }
}

function seedlings(mb: MeshBuilder, rng: RNG, x: number, y: number, z: number, r: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const sx = x + rng.range(-r, r), sz = z + rng.range(-r, r), h = rng.range(0.03, 0.06);
    mb.box('gh_stem', sx, y + h / 2, sz, 0.004, h, 0.004);
    const a = rng.float() * PI;
    const dx = Math.cos(a) * 0.016, dz = Math.sin(a) * 0.016;
    quadToward(mb, 'gh_leaf', [sx - dx, y + h + 0.004, sz - dz], [sx, y + h - 0.003, sz], [sx + dx, y + h + 0.004, sz + dz], [sx, y + h + 0.01, sz], [0, 1, 0]);
  }
}

function deadPlant(mb: MeshBuilder, rng: RNG, x: number, y: number, z: number): void {
  const n = rng.int(2, 5);
  for (let i = 0; i < n; i++) {
    const a = rng.float() * PI * 2, lean = rng.range(0.05, 0.6), h = rng.range(0.18, 0.55);
    const top = V3(x + Math.cos(a) * Math.sin(lean) * h, y + Math.cos(lean) * h, z + Math.sin(a) * Math.sin(lean) * h);
    const mid = V3((x + top.x) / 2 + rng.range(-0.02, 0.02), (y + top.y) / 2, (z + top.z) / 2 + rng.range(-0.02, 0.02));
    mb.tube('gh_stalk_dead', [V3(x + rng.range(-0.03, 0.03), y, z + rng.range(-0.03, 0.03)), mid, top], [0.004, 0.003, 0.0015], 4);
    if (rng.chance(0.6)) {
      const q = mid;
      quadToward(mb, 'gh_leaf_dead', [q.x, q.y, q.z], [q.x + 0.04, q.y - 0.03, q.z + 0.01], [q.x + 0.03, q.y - 0.07, q.z + 0.02], [q.x - 0.01, q.y - 0.04, q.z], [0, 1, 0]);
    }
  }
}

// ===================================================================================
// 2. CHAPEL (Kapelle 1923, rural Baroque: whitewashed rubble, 3/8 apse, bell turret, crypt)
// ===================================================================================

const CH = BUILDINGS.chapel;

export function buildChapel(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  defineSacredMaterials(materials);
  const kit = new BuildingKit('chapel', physics, { mat: 'sacred_whitewash' });
  const mb = kit.mb;
  const rng = new RNG('chapel');
  const decals = new TextDecals('chapel', 520, false);
  const X0 = CH.x0, X1 = CH.x1, Z0 = CH.z0, Z1 = CH.z1;
  const W = X1 - X0;                       // 6
  const T = 0.6, ht = T / 2;
  const CX = (X0 + X1) / 2;
  const CZ = Z0 + W / 2;                   // centre of the octagonal apse closure
  const F = heightAt(CX, (Z0 + Z1) / 2) + 0.15;
  const CF = F - 2.4;
  const E = F + 3.7;                       // wall plate
  SACRED_LEVELS.chapelFloor = F;
  SACRED_LEVELS.cryptFloor = CF;
  SACRED_LEVELS.ground = heightAt;
  const t22 = Math.tan(PI / 8);
  const rc = W / 2 - ht, cw = rc * t22, em = ht * t22;
  const pSW: P2 = [X0 + ht, Z1 - ht], pSE: P2 = [X1 - ht, Z1 - ht];
  const pE1: P2 = [X1 - ht, CZ - cw], pNE: P2 = [CX + cw, CZ - rc], pNW: P2 = [CX - cw, CZ - rc], pW1: P2 = [X0 + ht, CZ - cw];
  const IX0 = X0 + T, IX1 = X1 - T, IZ1 = Z1 - T;
  const ri = W / 2 - T, iw = ri * t22;
  const IZA = CZ - iw;                     // inner corner of the apse
  const IZN = CZ - ri;                     // inner face of the apse front wall
  const ro = W / 2, ow = ro * t22;         // outer octagon

  // ---------------------------------------------------------------- vault profiles
  const SPRING = F + 3.25, CROWN = F + 4.15;
  const segArc = (half: number, rise: number, spring: number) => {
    const R = (half * half + rise * rise) / (2 * rise);
    return (d: number) => spring + Math.sqrt(Math.max(0, R * R - Math.min(d, half) ** 2)) - (R - rise);
  };
  const naveV = segArc(ri, CROWN - SPRING, SPRING);
  const vaultAt = (x: number, z: number) => naveV(z >= CZ ? Math.abs(x - CX) : Math.hypot(x - CX, z - CZ));
  const PX = X0 + 4.3, PT = 0.25;                      // crypt partition (stair compartment to the east)
  const cryptHalf = (PX - PT / 2 - IX0) / 2, cryptMid = (PX - PT / 2 + IX0) / 2;
  const CSPRING = CF + 1.6, CCROWN = F - 0.35;
  const cryptV = segArc(cryptHalf, CCROWN - CSPRING, CSPRING);

  // ---------------------------------------------------------------- rooms
  const SZ0 = Z1 - 4.4, SZ1 = Z1 - 1.4;                // crypt stair: bottom (north) .. top (south)
  const stairVoid = { x0: PX + PT / 2, z0: SZ0, x1: IX1, z1: SZ1 };
  const intFace = { mat: 'sacred_whitewash_int', dado: { mat: 'sacred_dado_int', h: F + 1.1 - (F - 0.3) } };
  kit.room({ id: 'chapel_nave', location: 'chapel', x0: IX0, z0: IZA, x1: IX1, z1: IZ1, y0: F, y1: CROWN, floor: 'sacred_floor', ceiling: null, voids: [stairVoid], wall: intFace, skirting: null, env: 'hall', floorSurface: 'stone', slab: 0.3 });
  kit.room({ id: 'chapel_apse', location: 'chapel', x0: CX - iw, z0: IZN, x1: CX + iw, z1: IZA, y0: F, y1: CROWN, floor: null, ceiling: null, wall: intFace, skirting: null, env: 'hall' });
  kit.room({ id: 'chapel_crypt', location: 'chapel', x0: IX0, z0: IZA, x1: PX - PT / 2, z1: IZ1, y0: CF, y1: F - 0.3, floor: 'sacred_crypt_floor', ceiling: null, wall: 'stone_wall_int', skirting: null, env: 'basement', floorSurface: 'stone', slab: 0.3 });
  kit.room({ id: 'chapel_crypt_stair', location: 'chapel', x0: PX + PT / 2, z0: IZA, x1: IX1, z1: IZ1, y0: CF, y1: F - 0.3, floor: 'sacred_crypt_floor', ceiling: 'stone_wall_int', ceilVoids: [stairVoid], wall: 'stone_wall_int', skirting: null, env: 'basement', floorSurface: 'stone', slab: 0.3 });
  kit.buildRoomSurfaces();
  // apse floor
  quadToward(mb, 'sacred_floor', [IX0, F, IZA], [IX1, F, IZA], [CX + iw, F, IZN], [CX - iw, F, IZN], [0, 1, 0]);
  physics?.addBox({ cx: CX, cy: F - 0.15, cz: (IZA + IZN) / 2, hx: (IX1 - IX0) / 2, hy: 0.15, hz: (IZA - IZN) / 2, surface: 'stone' });
  // edges of the floor opening above the crypt stair
  quadToward(mb, 'stone_wall_int', [stairVoid.x0, F - 0.3, SZ0], [stairVoid.x0, F - 0.3, SZ1], [stairVoid.x0, F, SZ1], [stairVoid.x0, F, SZ0], [1, 0, 0]);
  quadToward(mb, 'stone_wall_int', [stairVoid.x0, F - 0.3, SZ0], [IX1, F - 0.3, SZ0], [IX1, F, SZ0], [stairVoid.x0, F, SZ0], [0, 0, 1]);
  quadToward(mb, 'stone_wall_int', [stairVoid.x0, F - 0.3, SZ1], [IX1, F - 0.3, SZ1], [IX1, F, SZ1], [stairVoid.x0, F, SZ1], [0, 0, -1]);

  // ---------------------------------------------------------------- walls
  const yU0 = F - 0.3, yL0 = CF - 0.3;
  const extFace = { mat: 'sacred_whitewash', dado: { mat: 'stone_wall', h: F + 0.45 - yU0 } };
  const upper = { y0: yU0, y1: E, t: T, cap: 'sacred_whitewash_int', surface: 'stone', noTop: true, skirting: false, left: intFace, right: extFace };
  const winSide = (at: number, seed: number) => ({ o: { at, width: 0.78, bottom: F + 1.85 - yU0, top: F + 3.0 - yU0, kind: 'window' as const }, opts: { style: 'single' as const, exterior: 1 as const, broken: 0.25, sillIn: 'sacred_floor', sillOut: 'sacred_granite', frameMat: 'painted_wood_white_ext', seed } });
  const lenD = Math.hypot(pNE[0] - pE1[0], pNE[1] - pE1[1]);
  const winApse = (seed: number) => ({ o: { at: lenD / 2, width: 0.5, bottom: F + 2.0 - yU0, top: F + 3.0 - yU0, kind: 'window' as const }, opts: { style: 'single' as const, exterior: 1 as const, broken: 0.15, sillIn: 'sacred_floor', sillOut: 'sacred_granite', frameMat: 'painted_wood_white_ext', muntins: false, seed } });
  const doorO: Opening = { at: CX - pSW[0], width: 1.1, bottom: F - yU0, top: F + 2.3 - yU0, kind: 'door' };
  const WIN_Z = Z1 - 3.3;
  const fS = kit.wall({ ...upper, a: pSW, b: pSE, ext0: ht, ext1: ht, doors: [{ o: doorO, frame: 'rough_timber' }] });
  const fE = kit.wall({ ...upper, a: pSE, b: pE1, ext0: ht, ext1: em, windows: [winSide(pSE[1] - WIN_Z, 31)] });
  const fNE = kit.wall({ ...upper, a: pE1, b: pNE, ext0: em, ext1: em, windows: [winApse(32)] });
  const fN = kit.wall({ ...upper, a: pNE, b: pNW, ext0: em, ext1: em });
  const fNW = kit.wall({ ...upper, a: pNW, b: pW1, ext0: em, ext1: em, windows: [winApse(33)] });
  const fW = kit.wall({ ...upper, a: pW1, b: pSW, ext0: em, ext1: ht, windows: [winSide(WIN_Z - pW1[1], 34)] });
  const extWalls: [WallFrame, number, number][] = [[fS, ht, ht], [fE, ht, em], [fNE, em, em], [fN, em, em], [fNW, em, em], [fW, em, ht]];
  // crypt level: same lines down to below the terrain (the footprint is cut out of the terrain)
  const lower = { y0: yL0, y1: yU0, t: T, cap: 'stone_wall', surface: 'stone', noTop: true, skirting: false, right: 'stone_wall' };
  kit.wall({ ...lower, a: pSW, b: pSE, ext0: ht, ext1: ht, left: 'stone_wall_int' });
  kit.wall({ ...lower, a: pSE, b: pE1, ext0: ht, ext1: em, left: 'stone_wall_int' });
  kit.wall({ ...lower, a: pE1, b: pNE, ext0: em, ext1: em, left: null });
  kit.wall({ ...lower, a: pNE, b: pNW, ext0: em, ext1: em, left: null });
  kit.wall({ ...lower, a: pNW, b: pW1, ext0: em, ext1: em, left: null });
  kit.wall({ ...lower, a: pW1, b: pSW, ext0: em, ext1: ht, left: 'stone_wall_int' });
  kit.wall({ a: [IX1, IZA - ht], b: [IX0, IZA - ht], y0: CF, y1: yU0, t: T, left: 'stone_wall_int', right: null, cap: 'stone_wall', noTop: true, skirting: false, surface: 'stone' });
  // partition between crypt and stair, with the crypt door
  const cryptDoor: Opening = { at: IZ1 - (Z1 - 5.4), width: 0.85, bottom: 0, top: 1.95, kind: 'door' };
  const fP = kit.wall({ a: [PX, IZ1], b: [PX, IZA], y0: CF, y1: yU0, t: PT, left: 'stone_wall_int', right: 'stone_wall_int', cap: 'stone_wall_int', noTop: true, skirting: false, surface: 'stone', doors: [{ o: cryptDoor, frame: 'rough_timber' }] });

  // ---------------------------------------------------------------- doors
  kit.doorInWall('door:chapel_front', fS, doorO, { style: 'ledged', mat: 'rough_timber_ext', handle: 'ring', handleMat: 'iron_black', seed: 19 }, -1, -1, { sound: 'wood', open: 0.3 });
  kit.doorInWall('door:chapel_crypt', fP, cryptDoor, { style: 'plank', mat: 'rough_timber', handle: 'ring', handleMat: 'iron_black', seed: 7 }, -1, -1, { sound: 'wood' });
  // granite threshold
  mb.box('sacred_granite', CX, F - 0.01, Z1 - ht, 1.12, 0.06, T + 0.02, { skip: ['ny'] });

  // ---------------------------------------------------------------- vaults
  {
    // nave barrel vault (plaster)
    const N = 16;
    const xs = Array.from({ length: N + 1 }, (_, i) => IX0 + ((IX1 - IX0) * i) / N);
    for (let i = 0; i < N; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const ya = naveV(Math.abs(xa - CX)), yb = naveV(Math.abs(xb - CX));
      const toward = [CX - (xa + xb) / 2, -1.5, 0];
      quadToward(mb, 'sacred_whitewash_int', [xa, ya, IZ1], [xb, yb, IZ1], [xb, yb, CZ], [xa, ya, CZ], toward);
    }
    // apse: umbrella half-dome on the same profile
    const ring: P2[] = [];
    const corners: P2[] = [[IX0, CZ], [IX0, IZA], [CX - iw, IZN], [CX + iw, IZN], [IX1, IZA], [IX1, CZ]];
    for (let k = 0; k < corners.length - 1; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[k + 1];
      const n = k === 0 || k === corners.length - 2 ? 2 : 3;
      for (let s = 0; s < n; s++) ring.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    }
    ring.push(corners[corners.length - 1]);
    const M = 8;
    const pt = (q: P2, t: number) => {
      const x = q[0] + (CX - q[0]) * t, z = q[1] + (CZ - q[1]) * t;
      return [x, naveV(ri * (1 - t)), z];
    };
    for (let k = 0; k < ring.length - 1; k++) {
      for (let m = 0; m < M; m++) {
        const t0 = m / M, t1 = (m + 1) / M;
        const a = pt(ring[k], t0), b = pt(ring[k + 1], t0), c = pt(ring[k + 1], t1), d = pt(ring[k], t1);
        const toward = [CX - (a[0] + b[0]) / 2, -1.2, CZ - (a[2] + b[2]) / 2 + 0.01];
        if (m === M - 1) triToward(mb, 'sacred_whitewash_int', a, b, c, toward);
        else quadToward(mb, 'sacred_whitewash_int', a, b, c, d, toward);
      }
    }
    // crypt: brick barrel vault
    const NC = 12;
    for (let i = 0; i < NC; i++) {
      const xa = IX0 + ((PX - PT / 2 - IX0) * i) / NC, xb = IX0 + ((PX - PT / 2 - IX0) * (i + 1)) / NC;
      const ya = cryptV(Math.abs(xa - cryptMid)), yb = cryptV(Math.abs(xb - cryptMid));
      quadToward(mb, 'brick_int', [xa, ya, IZ1], [xb, yb, IZ1], [xb, yb, IZA], [xa, ya, IZA], [cryptMid - (xa + xb) / 2, -1.5, 0]);
    }
    // keep heads out of the low vault haunch by the partition
    physics?.addBox({ cx: PX - PT / 2 - 0.15, cy: CSPRING + 0.15, cz: (IZ1 + IZA) / 2, hx: 0.15, hy: 0.15, hz: (IZ1 - IZA) / 2, surface: 'stone' });
  }

  // ---------------------------------------------------------------- crypt stair
  {
    const sw = 0.82, sx = (PX + PT / 2 + IX1) / 2, n = 12, run = (SZ1 - SZ0) / n, sh = (F - CF) / n;
    for (let i = 0; i < n; i++) {
      const y = CF + (i + 1) * sh, z = SZ0 + (i + 0.5) * run;
      mb.withColor([0.85 + rng.float() * 0.15, 0.85 + rng.float() * 0.15, 0.85 + rng.float() * 0.15], () => {
        mb.box('sacred_crypt_floor', sx, y - 0.03, z + 0.01, sw, 0.06, run + 0.03, { uvOffset: [i * 0.37, i * 0.21] });
      });
      mb.box('stone_wall_int', sx, (CF + y - 0.06) / 2, z, sw - 0.01, y - 0.06 - CF, run, { skip: ['py', 'pz'] });
    }
    const len = SZ1 - SZ0, ang = Math.atan2(F - CF, len);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, PI, 0, 'YXZ'));
    physics?.addBox({ cx: sx, cy: (F + CF) / 2 - 0.05, cz: (SZ0 + SZ1) / 2, hx: sw / 2, hy: 0.05, hz: Math.hypot(len, F - CF) / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'stone' });
    // wall handrail on iron brackets
    const hx = IX1 - 0.06;
    mb.rod('iron_black', V3(hx, CF + 0.95, SZ0 - 0.2), V3(hx, F + 0.9, SZ1), 0.018);
    for (const t of [0.1, 0.5, 0.9]) {
      const z = SZ0 - 0.2 + (SZ1 - SZ0 + 0.2) * t, y = CF + 0.95 + (F + 0.9 - CF - 0.95) * t;
      mb.rod('iron_black', V3(hx, y, z), V3(IX1, y - 0.04, z), 0.008);
    }
    balustrade(mb, physics, [[stairVoid.x0, SZ1], [stairVoid.x0, SZ0], [IX1, SZ0]], F, 'iron_black', 0.95, true);
  }

  // ---------------------------------------------------------------- crypt: burial niches, shrine
  {
    const NX = IX0 + 0.75, top = CF + 1.56;
    const zs = [IZ1, IZ1 - 0.4, IZ1 - 2.5, IZ1 - 2.9, IZ1 - 5.0, IZA];
    const ys = [CF, CF + 0.22, CF + 0.8, CF + 0.95, CF + 1.45, top];
    const holes = [[1, 1], [1, 3], [3, 1], [3, 3]];               // [zIndex, yIndex] of niche cells
    for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (holes.some(([a, b]) => a === i && b === j)) continue;
      quadToward(mb, 'stone_wall_int', [NX, ys[j], zs[i]], [NX, ys[j], zs[i + 1]], [NX, ys[j + 1], zs[i + 1]], [NX, ys[j + 1], zs[i]], [1, 0, 0]);
    }
    quadToward(mb, 'stone_wall_int', [IX0, top, IZ1], [NX, top, IZ1], [NX, top, IZA], [IX0, top, IZA], [0, 1, 0]);
    const back = IX0 + 0.1;
    holes.forEach(([i, j], k) => {
      const za = zs[i], zb = zs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      quadToward(mb, 'stone_wall_int', [back, y0, za], [back, y0, zb], [back, y1, zb], [back, y1, za], [1, 0, 0]);
      quadToward(mb, 'stone_wall_int', [back, y0, za], [NX, y0, za], [NX, y0, zb], [back, y0, zb], [0, 1, 0]);
      quadToward(mb, 'stone_wall_int', [back, y1, za], [NX, y1, za], [NX, y1, zb], [back, y1, zb], [0, -1, 0]);
      quadToward(mb, 'stone_wall_int', [back, y0, za], [NX, y0, za], [NX, y1, za], [back, y1, za], [0, 0, -1]);
      quadToward(mb, 'stone_wall_int', [back, y0, zb], [NX, y0, zb], [NX, y1, zb], [back, y1, zb], [0, 0, 1]);
      const zc = (za + zb) / 2, yc = (y0 + y1) / 2;
      if (k === 1 || k === 2) {
        // closed with a stone plate, cross in relief, iron rosettes
        mb.box('sacred_crypt_plate', NX - 0.02, yc, zc, 0.04, y1 - y0 - 0.02, Math.abs(zb - za) - 0.02);
        mb.box('sacred_crypt_plate', NX + 0.005, yc, zc, 0.02, (y1 - y0) * 0.6, 0.05);
        mb.box('sacred_crypt_plate', NX + 0.005, yc + (y1 - y0) * 0.1, zc, 0.02, 0.05, 0.22);
        for (const dz of [-0.85, 0.85]) for (const dy of [-0.18, 0.18]) {
          mb.pushTRS(NX + 0.002, yc + dy * (y1 - y0), zc + dz, 0, 1, 1, 1, 0, -PI / 2);
          mb.cylinder('rust_metal', 0, 0, 0, 0.02, 0.016, 0.012, 8);
          mb.pop();
        }
      } else if (k === 3) {
        // an old coffin, lid pushed askew
        mb.withColor([0.55, 0.5, 0.45], () => {
          mb.box('rough_timber', (back + NX) / 2 + 0.02, y0 + 0.17, zc, 0.42, 0.34, Math.abs(zb - za) - 0.3, { uv: 'local' });
        });
        mb.pushTRS((back + NX) / 2 + 0.06, y0 + 0.36, zc + 0.15, 0.12);
        mb.withColor([0.5, 0.46, 0.42], () => mb.box('rough_timber', 0, 0, 0, 0.46, 0.03, Math.abs(zb - za) - 0.25, { uv: 'local' }));
        mb.pop();
      } else {
        // empty – dust and a few bones of mortar
        for (let d = 0; d < 6; d++) mb.box('stone_wall_int', (back + NX) / 2 + rng.range(-0.15, 0.15), y0 + 0.02, zc + rng.range(-0.8, 0.8), rng.range(0.03, 0.08), 0.04, rng.range(0.03, 0.08));
      }
    });
    physics?.addBox({ cx: (IX0 + NX) / 2, cy: (CF + top) / 2, cz: (IZ1 + IZA) / 2, hx: (NX - IX0) / 2, hy: (top - CF) / 2, hz: (IZ1 - IZA) / 2, surface: 'stone' });
    // shrine shelf on the north wall with a small crucifix
    const sz = IZA + 0.12, sxm = (NX + PX - PT / 2) / 2;
    mb.box('sacred_crypt_plate', sxm, CF + 1.02, sz, 1.0, 0.06, 0.24);
    for (const dx of [-0.38, 0.38]) mb.box('sacred_crypt_plate', sxm + dx, CF + 0.9, IZA + 0.06, 0.08, 0.2, 0.12);
    crucifix(mb, sxm, CF + 1.35, IZA + 0.03, 0.42, 0, 'furniture_wood');
    for (const dx of [-0.3, -0.18, 0.25]) graveLight(mb, sxm + dx, CF + 1.05, sz + 0.02, { wax: 0.006, soot: true });
    // processional cross leaning in the corner
    mb.pushTRS(PX - PT / 2 - 0.25, CF, IZ1 - 0.25, 0.7, 1, 1, 1, -0.12, 0.1);
    mb.rod('furniture_wood', V3(0, 0, 0), V3(0, 2.0, 0), 0.02);
    mb.box('sacred_gold', 0, 2.1, 0, 0.03, 0.34, 0.03);
    mb.box('sacred_gold', 0, 2.15, 0, 0.22, 0.03, 0.03);
    mb.pop();
  }

  // ---------------------------------------------------------------- nave furnishing
  // altar step (predella)
  const STEP = 0.16, stepZ = Z1 - 5.6;
  mb.box('furniture_oak', CX, F + STEP / 2, (IZN + stepZ) / 2, 3.1, STEP, stepZ - IZN, { skip: ['ny'], uv: 'local', uvRotate: true });
  physics?.addBox({ cx: CX, cy: F + STEP / 2, cz: (IZN + stepZ) / 2, hx: 1.55, hy: STEP / 2, hz: (stepZ - IZN) / 2, surface: 'wood' });
  {
    const a0 = F + STEP, az0 = IZN, az1 = IZN + 0.72, ax0 = CX - 0.85, ax1 = CX + 0.85;
    // stipes (plastered) with a painted antependium, mensa slab, cloth
    mb.box('sacred_whitewash_int', CX, (a0 + F + 1.0) / 2, (az0 + az1) / 2, ax1 - ax0, F + 1.0 - a0, az1 - az0, { skip: ['ny'] });
    mb.box('painted_wood_white', CX, (a0 + F + 0.95) / 2, az1 + 0.012, 1.5, F + 0.86 - a0, 0.02, { uv: 'local' });
    for (const [x, y, w, h] of [[CX, F + 0.94, 1.5, 0.03], [CX, a0 + 0.06, 1.5, 0.03], [CX - 0.74, (a0 + F + 0.95) / 2, 0.03, 0.8], [CX + 0.74, (a0 + F + 0.95) / 2, 0.03, 0.8]]) mb.box('sacred_gold', x, y, az1 + 0.025, w, h, 0.012);
    mb.box('sacred_marble_int', CX, F + 1.035, (az0 + az1 + 0.1) / 2, ax1 - ax0 + 0.2, 0.07, az1 - az0 + 0.1);
    mb.box('fabric_white', CX, F + 1.073, (az0 + az1 + 0.1) / 2, ax1 - ax0 + 0.1, 0.006, az1 - az0 + 0.06);
    mb.box('fabric_white', CX, F + 0.97, az1 + 0.052, ax1 - ax0 + 0.1, 0.2, 0.006);
    physics?.addBox({ cx: CX, cy: (a0 + F + 1.07) / 2, cz: (az0 + az1) / 2 + 0.05, hx: (ax1 - ax0) / 2 + 0.1, hy: (F + 1.07 - a0) / 2, hz: (az1 - az0) / 2 + 0.05, surface: 'stone' });
    // tabernacle, candlesticks
    const tY = F + 1.076;
    mb.box('painted_wood_white', CX, tY + 0.2, az0 + 0.2, 0.42, 0.4, 0.3, { uv: 'local' });
    mb.box('sacred_gold', CX, tY + 0.41, az0 + 0.2, 0.46, 0.03, 0.33);
    mb.box('sacred_gold', CX, tY + 0.19, az0 + 0.352, 0.2, 0.26, 0.006);
    for (const dx of [-0.6, 0.6]) {
      mb.pushTRS(CX + dx, tY, az0 + 0.22);
      mb.lathe('brass', [[0.065, 0], [0.06, 0.015], [0.022, 0.035], [0.018, 0.15], [0.032, 0.17], [0.016, 0.19], [0.016, 0.3], [0.04, 0.31], [0.04, 0.33], [0.0005, 0.335]], 10);
      mb.pop();
      mb.cylinder('candle', CX + dx, tY + 0.333, az0 + 0.22, 0.017, 0.017, 0.24, 8);
      mb.box('black_soot', CX + dx, tY + 0.58, az0 + 0.22, 0.003, 0.014, 0.003);
    }
    // retable with the crucifix
    const rz = IZN + 0.045;
    mb.box('painted_wood_white', CX, F + 1.75, rz, 1.5, 1.25, 0.08, { uv: 'local' });
    for (const [x, y, w, h] of [[CX, F + 2.37, 1.56, 0.05], [CX, F + 1.13, 1.56, 0.05], [CX - 0.77, F + 1.75, 0.05, 1.25], [CX + 0.77, F + 1.75, 0.05, 1.25]]) mb.box('sacred_gold', x, y, rz + 0.03, w, h, 0.04);
    mb.pushTRS(CX, F + 2.39, rz);
    extrude(mb, 'sacred_gold', arc(0, 0, 0.42, 0, PI, 8), -0.03, 0.03);
    mb.pop();
    crucifix(mb, CX, F + 1.22, rz + 0.06, 1.05, 0, 'furniture_wood');
  }
  // two pews on the west side of the aisle
  for (const zs of [Z1 - 2.3, Z1 - 3.45]) pew(mb, physics, IX0 + 0.06, CX - 0.6, F, zs);
  // offering box on the south wall, west of the door
  {
    const x = CX - 1.4, y = F + 1.1, z = IZ1 - 0.12;
    mb.box('furniture_wood', x, y, z, 0.3, 0.3, 0.24);
    for (const dy of [-0.11, 0.11]) mb.box('iron_black', x, y + dy, z, 0.31, 0.025, 0.245);
    mb.box('black_soot', x, y + 0.151, z, 0.08, 0.002, 0.012);
    mb.box('iron_black', x + 0.1, y - 0.02, z - 0.121, 0.03, 0.05, 0.004);
    physics?.addBox({ cx: x, cy: y, cz: z, hx: 0.15, hy: 0.15, hz: 0.12, surface: 'wood' });
    const t = ENV_TEXT.chapel.offeringBox.de.split(' — ');
    decals.add(V3(x, y + 0.02, z - 0.121), V3(-1, 0, 0), V3(0, 1, 0), 0.26, 0.12, textBlock([{ t: t[0], s: 1.1 }, { t: t[1] ?? '', s: 0.85 }], { font: FONT_PAINT, mode: 'paint', color: '#e9dfc4', wear: 0.4, seed: 71 }));
  }
  // holy water font east of the door
  mb.pushTRS(CX + 1.0, F + 1.0, IZ1);
  mb.lathe('sacred_marble_int', [[0.03, -0.12], [0.08, -0.08], [0.12, -0.02], [0.13, 0.0], [0.12, 0.01], [0.09, -0.02], [0.0005, -0.03]], 10);
  mb.pop();
  // votive picture on the east wall, a card tucked into its frame
  {
    const x = IX1, y = F + 1.75, z = Z1 - 5.25, w = 0.5, h = 0.68;
    mb.box('furniture_wood', x - 0.02, y, z, 0.04, h + 0.1, w + 0.1);
    mb.box('sacred_gold', x - 0.045, y, z, 0.012, h + 0.02, w + 0.02);
    const right = V3(0, 0, 1), up = V3(0, 1, 0);
    decals.add(V3(x - 0.052, y, z), right, up, w, h, votivePainting(), 520, 0.002);
    decals.add(V3(x - 0.058, y - h / 2 + 0.02, z + w / 2 - 0.02), V3(0, 0.26, 0.97), V3(0, 0.97, -0.26), 0.065, 0.095, tuckedCard(), 1600, 0.003);
    // spare candles in a basket below (prop), drips on the floor
  }
  // fresh candle stubs for "J." on and in front of the altar step; one is still burning
  {
    const yS = F + STEP;
    const stubs: [number, number, number, boolean, boolean][] = [
      [CX - 0.62, yS, stepZ - 0.1, true, false], [CX - 0.4, yS, stepZ - 0.08, false, true], [CX + 0.38, yS, stepZ - 0.12, true, false], [CX + 0.6, yS, stepZ - 0.07, false, false],
      [CX - 0.22, F, stepZ + 0.25, false, true], [CX + 0.05, F, stepZ + 0.3, true, true], [CX + 0.27, F, stepZ + 0.22, false, false],
    ];
    const waxOf = (i: number, lit: boolean) => (lit ? 0.025 + (i % 3) * 0.008 : 0.006);
    stubs.forEach(([x, y, z, red, lit], i) => graveLight(mb, x, y, z, { red, lit, wax: waxOf(i, lit), soot: !lit || i % 2 === 0 }));
    for (let i = 0; i < 14; i++) {
      const onStep = i < 8;
      const x = CX + rng.range(-0.8, 0.8), z = onStep ? stepZ - rng.range(0.03, 0.25) : stepZ + rng.range(0.1, 0.5);
      mb.cylinder('candle', x, (onStep ? yS : F) + 0.0005, z, rng.range(0.012, 0.035), rng.range(0.01, 0.03), 0.004, 8, 'top');
    }
    const [lx, ly, lz] = stubs[5];
    kit.light({ id: 'light:chapel_candle', position: V3(lx, ly + 0.004 + waxOf(5, true) + 0.03, lz), kind: 'candle', working: true, flicker: 0.6, intensity: 1, color: 0xffa040, room: 'chapel_nave' });
  }

  // ---------------------------------------------------------------- exterior
  {
    const ry = (f: WallFrame) => -Math.atan2(f.dz, f.dx);
    const band = (f: WallFrame, e0: number, e1: number, y: number, h: number, d: number, mat: string) => {
      const len = f.len + e0 + e1, s = (f.len + e1 - e0) / 2;
      const c = wallPoint(f, s, y, ht + d / 2);
      mb.pushTRS(c[0], c[1], c[2], ry(f));
      mb.box(mat, 0, 0, 0, len + d * 0.8, h, d, { skip: ['nz'] });
      mb.pop();
    };
    for (const [f, e0, e1] of extWalls) {
      band(f, e0, e1, E - 0.12, 0.24, 0.07, 'sacred_trim_ext');           // eaves cornice
      band(f, e0, e1, E - 0.03, 0.08, 0.14, 'sacred_trim_ext');
      band(f, e0, e1, F + 0.47, 0.06, 0.05, 'sacred_granite');           // socle ledge
    }
    // window surrounds (painted Faschen)
    for (const { wall, frame } of kit.frames) {
      if (!wall.windows?.length || wall.y0 !== yU0) continue;
      for (const w of wall.windows) {
        const o = w.o, fw = 0.12;
        const seg = (s0: number, s1: number, ya: number, yb: number) => {
          const c = wallPoint(frame, (s0 + s1) / 2, frame.y0 + (ya + yb) / 2, ht + 0.01);
          mb.pushTRS(c[0], c[1], c[2], ry(frame));
          mb.box('sacred_trim_ext', 0, 0, 0, s1 - s0, yb - ya, 0.02, { skip: ['nz'] });
          mb.pop();
        };
        seg(o.at - o.width / 2 - fw, o.at - o.width / 2, o.bottom - 0.04, o.top + fw);
        seg(o.at + o.width / 2, o.at + o.width / 2 + fw, o.bottom - 0.04, o.top + fw);
        seg(o.at - o.width / 2, o.at + o.width / 2, o.top, o.top + fw);
      }
    }
    // corner lisenes at the front
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? X0 : X1;
      mb.box('sacred_trim_ext', x - sx * 0.2, (F + 0.5 + E - 0.24) / 2, Z1 + 0.015, 0.4, E - 0.24 - F - 0.5, 0.03, { skip: ['nz'] });
      mb.box('sacred_trim_ext', x + sx * 0.015, (F + 0.5 + E - 0.24) / 2, Z1 - 0.2, 0.03, E - 0.24 - F - 0.5, 0.4, { skip: [sx < 0 ? 'px' : 'nx'] });
    }
    // granite door surround with the carved lintel
    for (const sx of [-1, 1]) mb.box('sacred_granite', CX + sx * 0.65, F + 1.15, Z1 + 0.015, 0.2, 2.3, 0.03, { skip: ['nz'] });
    mb.box('sacred_granite', CX, F + 2.44, Z1 + 0.02, 1.5, 0.28, 0.04, { skip: ['nz'] });
    decals.add(V3(CX, F + 2.44, Z1 + 0.04), V3(1, 0, 0), V3(0, 1, 0), 1.3, 0.2, textBlock([{ t: ENV_TEXT.chapel.lintel.de }], { font: FONT_ROMAN, mode: 'engrave', weight: '600', pad: 0.08, wear: 0.25, seed: 1923 }));
    // a statue niche in the gable (painted blue, empty but for a vase)
    mb.box('sacred_trim_ext', CX, E + 0.9, Z1 + 0.012, 0.7, 1.0, 0.025, { skip: ['nz'] });
    mb.box('painted_wood_white', CX, E + 0.88, Z1 + 0.03, 0.5, 0.8, 0.012);
    // front step(s) down to the cemetery
    const g = rectRange(heightAt, CX - 0.9, Z1, CX + 0.9, Z1 + 0.9).min;
    const n = Math.max(1, Math.round((F - g) / 0.17));
    for (let k = 0; k < n; k++) {
      const top = F - ((F - g) * k) / n - 0.01, z0 = Z1 + k * 0.34, z1 = Z1 + (k + 1) * 0.34 + 0.12;
      mb.box('sacred_granite', CX, (top + g - 0.3) / 2, (z0 + z1) / 2, 1.9 + k * 0.2, top - g + 0.3, z1 - z0, { skip: ['ny'] });
      physics?.addBox({ cx: CX, cy: (top + g - 0.3) / 2, cz: (z0 + z1) / 2, hx: 0.95 + k * 0.1, hy: (top - g + 0.3) / 2, hz: (z1 - z0) / 2, surface: 'stone' });
    }
    // paving closing the terrain hole beside the apse
    for (const sx of [-1, 1]) {
      const cx = sx < 0 ? X0 : X1;
      const a = [cx, 0, CZ - ow], b = [cx, 0, Z0], c = [CX + sx * ow, 0, Z0];
      const top = ptsRange(heightAt, [[cx - sx * 0.1, CZ - ow], [cx - sx * 0.1, Z0 - 0.1], [CX + sx * ow, Z0 - 0.1], [cx + sx * 0.3, Z0 - 0.3]]).max + 0.03;
      a[1] = b[1] = c[1] = top;
      triToward(mb, 'stone_slab', a, b, c, [0, 1, 0]);
      quadToward(mb, 'stone_slab', [a[0], top - 0.8, a[2]], [b[0], top - 0.8, b[2]], [b[0], top, b[2]], [a[0], top, a[2]], [sx, 0, 0]);
      quadToward(mb, 'stone_slab', [b[0], top - 0.8, b[2]], [c[0], top - 0.8, c[2]], [c[0], top, c[2]], [b[0], top, b[2]], [0, 0, -1]);
      physics?.addBox({ cx: (cx + c[0]) / 2, cy: top - 0.15, cz: (CZ - ow + Z0) / 2, hx: Math.abs(c[0] - cx) / 2, hy: 0.15, hz: Math.abs(Z0 - (CZ - ow)) / 2, surface: 'stone' });
    }
  }

  // ---------------------------------------------------------------- roof (tiles), gable, bell turret
  const pitch = (50 * PI) / 180, tan = Math.tan(pitch);
  const oh = 0.45, ohG = 0.35;
  const eY = E - oh * tan;
  const rho = W / 2 + oh, rw = rho * t22;
  const rY = eY + rho * tan;
  const Zs = Z1 + ohG;
  const cWN: number[] = [CX - rho, eY, CZ - rw], cNW: number[] = [CX - rw, eY, CZ - rho], cNE: number[] = [CX + rw, eY, CZ - rho], cEN: number[] = [CX + rho, eY, CZ - rw];
  const apex = [CX, rY, CZ];
  const th = 0.26;
  roofPlane(mb, physics, [[CX - rho, eY, Zs], cWN, apex, [CX, rY, Zs]], [-1, 0], pitch, th, 'roof_tiles', 'rough_timber', 'painted_wood_brown_ext');
  roofPlane(mb, physics, [cEN, [CX + rho, eY, Zs], [CX, rY, Zs], apex], [1, 0], pitch, th, 'roof_tiles', 'rough_timber', 'painted_wood_brown_ext');
  roofPlane(mb, physics, [cWN, cNW, apex], [-Math.SQRT1_2, -Math.SQRT1_2], pitch, th, 'roof_tiles', 'rough_timber', 'painted_wood_brown_ext');
  roofPlane(mb, physics, [cNW, cNE, apex], [0, -1], pitch, th, 'roof_tiles', 'rough_timber', 'painted_wood_brown_ext');
  roofPlane(mb, physics, [cNE, cEN, apex], [Math.SQRT1_2, -Math.SQRT1_2], pitch, th, 'roof_tiles', 'rough_timber', 'painted_wood_brown_ext');
  capLine(mb, 'roof_tiles', V3(CX, rY + 0.02, Zs), V3(CX, rY + 0.02, CZ));
  for (const c of [cWN, cNW, cNE, cEN]) capLine(mb, 'roof_tiles', V3(c[0], c[1] + 0.02, c[2]), V3(CX, rY + 0.02, CZ));
  // south gable: masonry infill, bargeboards, verge
  buildGableInfill(mb, 'x', Z1 - ht, X0, X1, E, E + (W / 2) * tan, T, 'sacred_whitewash', 'sacred_whitewash_int', 1);
  for (const s of [-1, 1]) {
    const a = V3(CX + s * rho, eY - 0.06, Zs - 0.02), b = V3(CX, rY - 0.06, Zs - 0.02);
    mb.beam('painted_wood_brown_ext', a, b, 0.04, 0.24);
    mb.beam('roof_tiles', a.clone().setY(eY + 0.03), b.clone().setY(rY + 0.03), 0.08, 0.05);
  }
  // gutters round the eaves
  {
    const gy = eY - th / Math.cos(pitch) - 0.02, go = 0.09;
    const k = (rho + go) / rho, off = (c: number[]) => [CX + (c[0] - CX) * k, gy, CZ + (c[2] - CZ) * k];
    const ring: number[][] = [[CX - rho - go, gy, Zs], off(cWN), off(cNW), off(cNE), off(cEN), [CX + rho + go, gy, Zs]];
    for (let i = 0; i < ring.length - 1; i++) gutter(mb, 'rust_metal', V3(ring[i][0], ring[i][1], ring[i][2]), V3(ring[i + 1][0], ring[i + 1][1], ring[i + 1][2]));
    for (const s of [-1, 1]) {
      const x = CX + s * (rho + go), z = Zs - 0.1;
      const g = heightAt(x, z + 0.3);
      mb.rod('rust_metal', V3(x, gy, z), V3(x, g + 0.25, z), 0.04);
      mb.rod('rust_metal', V3(x, g + 0.25, z), V3(x, g + 0.05, z + 0.25), 0.04);
    }
  }
  // bell turret (Dachreiter) on the ridge above the entrance
  {
    const tz = Z1 - 1.25, hs = 0.55, yb = rY - 0.8, yt = rY + 1.5;
    const tw = (a: P2, b: P2) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const f = wallFrame({ a, b, y0: yb, y1: yt, t: 0.05 });
      buildWallLite(mb, f, len, yb, yt, { at: len / 2, width: 0.5, bottom: rY + 0.45 - yb, top: rY + 1.2 - yb });
      // louvres
      for (let k = 0; k < 4; k++) {
        const c = wallPoint(f, len / 2, rY + 0.55 + k * 0.17, 0);
        mb.pushTRS(c[0], c[1], c[2], -Math.atan2(f.dz, f.dx), 1, 1, 1, 0.65);
        mb.box('sacred_turret_boards', 0, 0, 0, 0.5, 0.012, 0.12, { uv: 'local' });
        mb.pop();
      }
    };
    const c0: P2 = [CX - hs, tz + hs], c1: P2 = [CX + hs, tz + hs], c2: P2 = [CX + hs, tz - hs], c3: P2 = [CX - hs, tz - hs];
    tw(c0, c1); tw(c1, c2); tw(c2, c3); tw(c3, c0);
    for (const [x, z] of [c0, c1, c2, c3]) mb.box('sacred_turret_boards', x, (yb + yt) / 2, z, 0.08, yt - yb, 0.08);
    mb.box('painted_wood_brown_ext', CX, yt - 0.04, tz, 2 * hs + 0.12, 0.08, 2 * hs + 0.12);
    // bell on its yoke
    mb.box('rough_timber', CX, rY + 1.08, tz, 2 * hs - 0.06, 0.1, 0.1);
    mb.pushTRS(CX, rY + 0.62, tz);
    mb.lathe('sacred_bronze', [[0.2, 0], [0.19, 0.03], [0.15, 0.1], [0.13, 0.22], [0.12, 0.32], [0.09, 0.37], [0.0005, 0.4]], 14);
    mb.lathe('sacred_bronze', [[0.0005, 0.36], [0.1, 0.34], [0.12, 0.22], [0.14, 0.1], [0.18, 0.02], [0.19, 0.0]], 14);
    mb.pop();
    mb.rod('iron_black', V3(CX, rY + 1.02, tz), V3(CX, rY + 0.6, tz), 0.012);
    // pyramid roof, onion, cross
    const r = hs + 0.13, ap = yt + 0.85;
    const pc: number[][] = [[CX - r, yt, tz + r], [CX + r, yt, tz + r], [CX + r, yt, tz - r], [CX - r, yt, tz - r]];
    for (let i = 0; i < 4; i++) {
      const a = pc[i], b = pc[(i + 1) % 4];
      const mid = [(a[0] + b[0]) / 2 - CX, 0.6, (a[2] + b[2]) / 2 - tz];
      triToward(mb, 'sacred_patina', a, b, [CX, ap, tz], mid);
      triToward(mb, 'sacred_patina', [a[0], a[1] - 0.02, a[2]], [b[0], b[1] - 0.02, b[2]], [CX, ap - 0.04, tz], [-mid[0], -1, -mid[2]]);
    }
    mb.pushTRS(CX, yt + 0.6, tz);
    mb.lathe('sacred_patina', [[0.1, 0], [0.18, 0.07], [0.21, 0.17], [0.18, 0.29], [0.1, 0.38], [0.045, 0.46], [0.035, 0.53], [0.06, 0.57], [0.06, 0.61], [0.0005, 0.63]], 12);
    mb.pop();
    mb.box('iron_black', CX, yt + 1.43, tz, 0.025, 0.42, 0.025);
    mb.box('iron_black', CX, yt + 1.5, tz, 0.24, 0.025, 0.025);
    mb.box('iron_black', CX, yt + 1.5, tz, 0.025, 0.025, 0.24);
  }

  // ---------------------------------------------------------------- spans & anchors
  kit.span({ x0: IX0, z0: IZA, x1: IX1, z1: IZ1, floorY: CF, ceil: (x, z) => vaultAt(x, z) });
  kit.span({ x0: CX - 1.7, z0: IZN, x1: CX + 1.7, z1: IZA, floorY: F, ceil: (x, z) => vaultAt(x, z) });
  kit.anchor('chapel_altar', CX, F + STEP, stepZ, 0, 'chapel_nave');
  kit.anchor('chapel_crypt_shrine', (IX0 + 0.75 + PX - PT / 2) / 2, CF, IZA + 0.3, 0, 'chapel_crypt');

  const group = mb.build(materials, { name: 'chapel' });
  const ins = decals.build();
  if (ins) group.add(ins);
  levelsChanged();
  return kit.output(group);
}

/** Thin wall with one opening (turret boarding) – geometry only, no colliders. */
function buildWallLite(mb: MeshBuilder, f: WallFrame, len: number, y0: number, y1: number, o: { at: number; width: number; bottom: number; top: number }): void {
  const ht = f.t / 2;
  const P = (s: number, y: number, side: number) => wallPoint(f, s, y, side);
  const piece = (s0: number, s1: number, ya: number, yb: number) => {
    quadToward(mb, 'sacred_turret_boards', P(s0, ya, ht), P(s1, ya, ht), P(s1, yb, ht), P(s0, yb, ht), [f.rx, 0, f.rz]);
    quadToward(mb, 'sacred_turret_boards', P(s0, ya, -ht), P(s1, ya, -ht), P(s1, yb, -ht), P(s0, yb, -ht), [-f.rx, 0, -f.rz]);
  };
  const a = o.at - o.width / 2, b = o.at + o.width / 2;
  piece(-0.03, a, y0, y1);
  piece(b, len + 0.03, y0, y1);
  piece(a, b, y0, y0 + o.bottom);
  piece(a, b, y0 + o.top, y1);
  // reveals
  quadToward(mb, 'sacred_turret_boards', P(a, y0 + o.bottom, -ht), P(b, y0 + o.bottom, -ht), P(b, y0 + o.bottom, ht), P(a, y0 + o.bottom, ht), [0, 1, 0]);
  quadToward(mb, 'sacred_turret_boards', P(a, y0 + o.top, -ht), P(b, y0 + o.top, -ht), P(b, y0 + o.top, ht), P(a, y0 + o.top, ht), [0, -1, 0]);
}

/** Wooden crucifix with a simple corpus; base of the upright at (x, y, z), facing +z rotated by ry. */
function crucifix(mb: MeshBuilder, x: number, y: number, z: number, h: number, ry: number, wood: string): void {
  const s = h;
  mb.pushTRS(x, y, z, ry);
  mb.box(wood, 0, s / 2, 0, 0.065 * s, s, 0.04 * s, { uv: 'local', uvRotate: true });
  mb.box(wood, 0, s * 0.74, 0, 0.55 * s, 0.06 * s, 0.04 * s, { uv: 'local' });
  mb.box('painted_wood_white', 0, s * 0.92, 0.025 * s, 0.13 * s, 0.05 * s, 0.006 * s);
  const c = 'sacred_corpus', zf = 0.035 * s;
  mb.box(c, 0, s * 0.6, zf, 0.08 * s, 0.2 * s, 0.035 * s);                                      // torso
  mb.box(c, 0, s * 0.485, zf, 0.085 * s, 0.05 * s, 0.03 * s);                                    // loincloth
  mb.beam(c, V3(-0.025 * s, s * 0.47, zf), V3(-0.012 * s, s * 0.24, zf), 0.03 * s, 0.03 * s);
  mb.beam(c, V3(0.025 * s, s * 0.47, zf), V3(0.012 * s, s * 0.24, zf), 0.03 * s, 0.03 * s);
  mb.beam(c, V3(-0.04 * s, s * 0.68, zf), V3(-0.25 * s, s * 0.75, zf), 0.026 * s, 0.026 * s);
  mb.beam(c, V3(0.04 * s, s * 0.68, zf), V3(0.25 * s, s * 0.75, zf), 0.026 * s, 0.026 * s);
  sphere(mb, c, 0.008 * s, s * 0.735, zf + 0.008 * s, 0.032 * s, 7, 4, 1.15);
  mb.pop();
}

/** Pew facing north (−z); seat centre at zs, between x0 and x1. */
function pew(mb: MeshBuilder, physics: Physics | undefined, x0: number, x1: number, F: number, zs: number): void {
  const m = 'furniture_oak';
  const len = x1 - x0, cx = (x0 + x1) / 2;
  for (const x of [x0 + 0.025, x1 - 0.025]) {
    mb.box(m, x, F + 0.45, zs - 0.06, 0.05, 0.9, 0.76, { uv: 'local', uvRotate: true });
    mb.box(m, x, F + 0.94, zs + 0.18, 0.05, 0.1, 0.32, { uv: 'local' });
    mb.pushTRS(x, F + 0.9, zs - 0.28, 0, 1, 1, 1, 0, PI / 2);
    mb.cylinder(m, 0, -0.025, 0, 0.12, 0.12, 0.05, 10, 'both');
    mb.pop();
  }
  mb.box(m, cx, F + 0.445, zs - 0.02, len - 0.1, 0.03, 0.38, { uv: 'local' });
  mb.pushTRS(cx, F + 0.75, zs + 0.2, 0, 1, 1, 1, -0.12);
  mb.box(m, 0, 0, 0, len - 0.1, 0.38, 0.025, { uv: 'local' });
  mb.pop();
  mb.box(m, cx, F + 0.83, zs + 0.3, len - 0.1, 0.02, 0.12, { uv: 'local' });                      // book rest for the row behind
  mb.box(m, cx, F + 0.16, zs - 0.38, len - 0.1, 0.05, 0.16, { uv: 'local' });                     // kneeler
  physics?.addBox({ cx, cy: F + 0.47, cz: zs - 0.06, hx: len / 2, hy: 0.47, hz: 0.38, surface: 'wood' });
}

/** Naive votive painting: Madonna in a blue mantle, the 1923 dedication below. */
function votivePainting(): DrawFn {
  return (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2c3a48'); bg.addColorStop(0.7, '#41503c'); bg.addColorStop(1, '#2a2a22');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const cx = w / 2, top = h * 0.12, foot = h * 0.68;
    // halo, mantle, veil, face
    g.strokeStyle = '#d8b25a'; g.lineWidth = w * 0.02;
    g.beginPath(); g.arc(cx, top + h * 0.07, w * 0.14, 0, PI * 2); g.stroke();
    g.fillStyle = '#2f4f8a';
    g.beginPath(); g.moveTo(cx, top + h * 0.06); g.quadraticCurveTo(cx + w * 0.36, foot * 0.7, cx + w * 0.3, foot); g.lineTo(cx - w * 0.3, foot); g.quadraticCurveTo(cx - w * 0.36, foot * 0.7, cx, top + h * 0.06); g.fill();
    g.fillStyle = '#8a3a30';
    g.beginPath(); g.moveTo(cx - w * 0.08, top + h * 0.2); g.lineTo(cx + w * 0.08, top + h * 0.2); g.lineTo(cx + w * 0.12, foot); g.lineTo(cx - w * 0.12, foot); g.fill();
    g.fillStyle = '#e8e0cc';
    g.beginPath(); g.ellipse(cx, top + h * 0.08, w * 0.1, h * 0.075, 0, 0, PI * 2); g.fill();
    g.fillStyle = '#d9b89a';
    g.beginPath(); g.ellipse(cx, top + h * 0.085, w * 0.065, h * 0.05, 0, 0, PI * 2); g.fill();
    // child on her arm
    g.fillStyle = '#e8e0cc';
    g.beginPath(); g.ellipse(cx + w * 0.1, top + h * 0.3, w * 0.07, h * 0.06, -0.4, 0, PI * 2); g.fill();
    g.fillStyle = '#d9b89a';
    g.beginPath(); g.arc(cx + w * 0.13, top + h * 0.23, w * 0.04, 0, PI * 2); g.fill();
    g.strokeStyle = '#d8b25a'; g.lineWidth = w * 0.01;
    g.beginPath(); g.arc(cx + w * 0.13, top + h * 0.23, w * 0.065, 0, PI * 2); g.stroke();
    // text field
    g.fillStyle = '#d9cfb2'; g.fillRect(w * 0.06, foot + h * 0.02, w * 0.88, h * 0.27);
    const lines = ENV_TEXT.chapel.votivePlaque.de.split('\n');
    g.save();
    g.translate(w * 0.06, foot + h * 0.02);
    textBlock([{ t: lines[0], s: 1.5, color: '#7a2418' }, { t: lines[1] ?? '', s: 0.8 }, { t: lines[2] ?? '', s: 0.8 }], { font: FONT_PAINT, mode: 'paint', color: '#2a2218', pad: 0.05, wear: 0.2, seed: 1923 })(g, w * 0.88, h * 0.27);
    g.restore();
    // varnish crackle and soot from a century of candles
    const rng = new RNG(1923);
    g.strokeStyle = 'rgba(20,15,10,0.18)'; g.lineWidth = 1;
    for (let i = 0; i < 60; i++) { const x = rng.float() * w, y = rng.float() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-8, 8), y + rng.range(-8, 8)); g.stroke(); }
    const soot = g.createLinearGradient(0, h, 0, h * 0.4);
    soot.addColorStop(0, 'rgba(25,20,12,0.45)'); soot.addColorStop(1, 'rgba(25,20,12,0)');
    g.fillStyle = soot; g.fillRect(0, 0, w, h);
  };
}

function tuckedCard(): DrawFn {
  return (g, w, h) => {
    g.fillStyle = '#ece6d6'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,100,70,0.12)'; g.fillRect(0, h * 0.8, w, h * 0.2);
    const t = ENV_TEXT.chapel.tuckedCard.de;               // 'FÜR J. UND FÜR MAMA'
    const cut = t.indexOf(' FÜR ', 3);
    const l1 = cut > 0 ? t.slice(0, cut) : t, l2 = cut > 0 ? t.slice(cut + 1) : '';
    textBlock([{ t: l1 }, { t: l2 }], { font: FONT_ROUND, mode: 'paint', color: '#34343c', pad: 0.12, lead: 1.5 })(g, w, h * 0.75);
  };
}

// ===================================================================================
// 3. CEMETERY (granite wall, iron gate, ~30 graves, the nameless cross outside)
// ===================================================================================

/** Three spruces outside the east wall that shelter the nameless cross: [x, z, Forest model 0–3]. */
export const CEMETERY_SPRUCES: [number, number, number][] = [[65.6, -109.9, 2], [66.9, -105.6, 3], [62.9, -103.6, 1]];
/** The nameless cross (Josef's grave), outside the wall. */
export const NAMELESS_CROSS = { x: 63.7, z: -107.4, ry: 0.12 };

interface GraveDef {
  id: string;
  kind: 'family_tomb' | 'small_stone' | 'iron_cross' | 'wooden_cross';
  lines: string[];
  shape?: 'round' | 'gable' | 'flat' | 'shoulder' | 'cross';
  mat?: string;
  w?: number; h?: number;
  kerb?: boolean; mound?: boolean; fallen?: boolean; small?: boolean;
  lean?: number;
  wear?: number;
}

const FILLER_GRAVES: GraveDef[] = [
  { id: 'hackl_leopold', kind: 'small_stone', shape: 'round', lines: ['Leopold Hackl', 'Sägemeister', '* 14. 3. 1868   † 2. 11. 1931', 'Ruhe sanft'], kerb: true, wear: 0.5 },
  { id: 'hackl_josefa', kind: 'small_stone', shape: 'flat', lines: ['Hier ruht', 'Josefa Hackl', 'geb. Wurm', '* 1872   † 1940'], mound: true, wear: 0.45 },
  { id: 'poetscher_franz', kind: 'small_stone', shape: 'gable', mat: 'sacred_sandstone', lines: ['Franz Pötscher', '* 8. 6. 1881   † 30. 1. 1929'], wear: 0.75, lean: 0.12 },
  { id: 'poetscher_rosa', kind: 'iron_cross', lines: ['Rosa Pötscher', '1859 – 1937'], mound: true },
  { id: 'mayrhofer_alois', kind: 'small_stone', shape: 'cross', lines: ['Alois Mayrhofer', 'Kutscher', '* 1875   † 1946'], kerb: true, wear: 0.4 },
  { id: 'mayrhofer_maria', kind: 'iron_cross', lines: ['Maria Mayrhofer', '1879 – 1950'] },
  { id: 'wurm_florian', kind: 'wooden_cross', lines: ['Florian Wurm', '1899 – 1934'], lean: 0.2 },
  { id: 'lindner_engelbert', kind: 'small_stone', shape: 'shoulder', lines: ['Engelbert Lindner', '* 19. 2. 1915', '† 7. 8. 1943', 'gefallen bei Orel', 'Ruhe in Frieden'], kerb: true, wear: 0.3 },
  { id: 'hackl_katharina', kind: 'small_stone', shape: 'flat', mat: 'sacred_marble', lines: ['Katharina Hackl', '* 1903   † 1975'], kerb: true, wear: 0.2 },
  { id: 'wurm_ignaz', kind: 'iron_cross', lines: ['Ignaz Wurm', '1870 – 1944'], lean: 0.08 },
  { id: 'wurm_theresia', kind: 'wooden_cross', lines: ['Theresia Wurm', '1874 – 1958'], lean: 0.1, mound: true },
  { id: 'stoegmueller_hermann', kind: 'small_stone', shape: 'round', mat: 'sacred_granite_dark', lines: ['Hermann Stögmüller', 'Sägewerksarbeiter', '* 1921   † 1966'], kerb: true, wear: 0.15 },
  { id: 'stoegmueller_aloisia', kind: 'small_stone', shape: 'flat', lines: ['Aloisia Stögmüller', 'geb. Hackl', '* 1924   † 1981'], kerb: true, wear: 0.15 },
  { id: 'hackl_franzl', kind: 'wooden_cross', lines: ['Franzl', '1927'], small: true, lean: 0.15 },
  { id: 'leitner_matthias', kind: 'small_stone', shape: 'gable', lines: ['Matthias Leitner', 'Förster', '* 1889   † 1957', 'Waidmannsruh'], mound: true, wear: 0.35 },
  { id: 'leitner_anna', kind: 'small_stone', shape: 'round', lines: ['Anna Leitner', 'geb. Hackl', '* 1895   † 1972'], wear: 0.3 },
  { id: 'kern_augustin', kind: 'small_stone', shape: 'cross', mat: 'sacred_marble', lines: ['P. Augustin Kern OSB', 'Pfarrer i. R.', '* 1871   † 1949', 'Herr, gib ihm die ewige Ruhe'], kerb: true, wear: 0.4 },
  { id: 'poetscher_gertraud', kind: 'small_stone', shape: 'flat', lines: ['Gertraud Pötscher', '* 1902   † 1985'], kerb: true, wear: 0.15 },
  { id: 'kapeller_rudolf', kind: 'iron_cross', lines: ['Rudolf Kapeller', '1915 – 1977'] },
  { id: 'hackl_ludwig', kind: 'iron_cross', lines: ['Ludwig Hackl', '1897 – 1962'], lean: 0.1, mound: true },
  { id: 'wurm_maria', kind: 'iron_cross', lines: ['Maria Wurm', '1901 – 1969'] },
  { id: 'stoegmueller_johann', kind: 'wooden_cross', lines: ['Johann Stögmüller', '1889 – 1953'], lean: 0.28 },
  { id: 'unknown_soldier', kind: 'wooden_cross', lines: ['Unbekannter Soldat', 'Mai 1945'], mound: true },
  { id: 'illegible_cross', kind: 'wooden_cross', lines: [], lean: 0.34 },
  { id: 'illegible_stone', kind: 'small_stone', shape: 'gable', mat: 'sacred_sandstone', lines: ['… Hackl', '* 18..   † 1931'], wear: 0.95, fallen: true },
  { id: 'child_1947', kind: 'iron_cross', lines: ['Kind', '1947'], small: true },
];

export function buildCemetery(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  defineSacredMaterials(materials);
  SACRED_LEVELS.ground = heightAt;
  const C = CEMETERY;
  const kit = new BuildingKit('cemetery', physics, { mat: 'stone_wall' });
  const mb = kit.mb;
  const rng = new RNG('cemetery');
  const decals = new TextDecals('cemetery', 420, true);
  const wt = 0.5;
  const GATE = { x0: 46.6, x1: 48.4 };                   // south wall, where the garden path arrives
  const WICKET = { z0: -111.1, z1: -110.2 };             // west wall, end of the forest loop

  // ---------------------------------------------------------------- granite wall
  const wallRun = (a: P2, b: P2, gaps: [number, number][]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const ry = -Math.atan2(dz, dx);
    const spans: [number, number][] = [];
    let cur = 0;
    for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g0 > cur) spans.push([cur, g0]); cur = g1; }
    if (cur < len) spans.push([cur, len]);
    for (const [s0, s1] of spans) {
      const n = Math.max(1, Math.round((s1 - s0) / 2.4));
      let prevTop = -Infinity;
      for (let k = 0; k < n; k++) {
        const u0 = s0 + ((s1 - s0) * k) / n, u1 = s0 + ((s1 - s0) * (k + 1)) / n;
        const pa: P2 = [a[0] + dx * u0, a[1] + dz * u0], pb: P2 = [a[0] + dx * u1, a[1] + dz * u1];
        const r = ptsRange(heightAt, [pa, pb, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]]);
        let top = Math.round((r.max + 1.0) * 10) / 10;
        if (Math.abs(top - prevTop) < 0.15) top = prevTop;
        prevTop = top;
        const base = r.min - 0.4;
        const cx = (pa[0] + pb[0]) / 2, cz = (pa[1] + pb[1]) / 2;
        mb.pushTRS(cx, (top + base) / 2, cz, ry);
        mb.box('stone_wall', 0, 0, 0, u1 - u0 + 0.002, top - base, wt, { skip: ['ny'] });
        mb.pop();
        physics?.addBox({ cx, cy: (top + base) / 2, cz, hx: (u1 - u0) / 2, hy: (top - base) / 2, hz: wt / 2, ry, surface: 'stone' });
        // coping stones, a few missing or shifted
        const nc = Math.max(1, Math.round((u1 - u0) / 0.75));
        for (let c = 0; c < nc; c++) {
          if (rng.chance(0.05)) continue;
          const v0 = u0 + ((u1 - u0) * c) / nc, v1 = u0 + ((u1 - u0) * (c + 1)) / nc;
          const vm = (v0 + v1) / 2;
          mb.pushTRS(a[0] + dx * vm + rng.range(-0.02, 0.02), top + 0.045 + rng.range(-0.01, 0.01), a[1] + dz * vm + rng.range(-0.02, 0.02), ry + rng.range(-0.03, 0.03), 1, 1, 1, rng.range(-0.02, 0.02), rng.range(-0.015, 0.015));
          mb.box('sacred_granite', 0, 0, 0, v1 - v0 - 0.012, 0.09, wt + 0.12, { uvOffset: [rng.float() * 4, rng.float() * 4] });
          mb.pop();
        }
      }
    }
  };
  const wS = C.z1 - wt / 2, wN = C.z0 + wt / 2, wW = C.x0 + wt / 2, wE = C.x1 - wt / 2;
  wallRun([C.x0, wS], [C.x1, wS], [[GATE.x0 - 0.55 - C.x0, GATE.x1 + 0.55 - C.x0]]);
  wallRun([C.x1, wN], [C.x0, wN], []);
  wallRun([wW, C.z0 + wt], [wW, C.z1 - wt], [[WICKET.z0 - 0.45 - (C.z0 + wt), WICKET.z1 + 0.45 - (C.z0 + wt)]]);
  wallRun([wE, C.z1 - wt], [wE, C.z0 + wt], []);

  // ---------------------------------------------------------------- gate pillars & iron gates
  const pillar = (x: number, z: number, s: number, h: number) => {
    const g = rectRange(heightAt, x - s / 2, z - s / 2, x + s / 2, z + s / 2, 0.25);
    const top = g.max + h;
    mb.box('sacred_granite', x, (top + g.min - 0.4) / 2, z, s, top - g.min + 0.4, s, { skip: ['ny'] });
    mb.box('sacred_granite', x, top + 0.04, z, s + 0.08, 0.08, s + 0.08);
    const ap = [x, top + 0.08 + s * 0.35, z];
    const q = s / 2 + 0.04;
    const cs = [[x - q, top + 0.08, z + q], [x + q, top + 0.08, z + q], [x + q, top + 0.08, z - q], [x - q, top + 0.08, z - q]];
    for (let i = 0; i < 4; i++) triToward(mb, 'sacred_granite', cs[i], cs[(i + 1) % 4], ap, [(cs[i][0] + cs[(i + 1) % 4][0]) / 2 - x, 0.5, (cs[i][2] + cs[(i + 1) % 4][2]) / 2 - z]);
    sphere(mb, 'sacred_granite', x, ap[1] + 0.06, z, 0.09, 8, 5);
    physics?.addBox({ cx: x, cy: (top + g.min - 0.4) / 2, cz: z, hx: s / 2, hy: (top - g.min + 0.4) / 2, hz: s / 2, surface: 'stone' });
    return g.max;
  };
  const gp0 = pillar(GATE.x0 - 0.275, wS, 0.55, 1.5), gp1 = pillar(GATE.x1 + 0.275, wS, 0.55, 1.5);
  pillar(wW, WICKET.z0 - 0.225, 0.45, 1.25);
  pillar(wW, WICKET.z1 + 0.225, 0.45, 1.25);
  const gw = (GATE.x1 - GATE.x0) / 2 - 0.02;
  ironLeaf(mb, physics, GATE.x0 + 0.01, Math.min(gp0, gp1) + 0.06, wS, 1.6, gw, 1.18, 0);
  ironLeaf(mb, physics, GATE.x1 - 0.01, Math.min(gp0, gp1) + 0.06, wS, PI - 0.35, gw, 1.18, 1);
  ironLeaf(mb, physics, wW, heightAt(wW + 0.3, WICKET.z0) + 0.05, WICKET.z0 + 0.02, -0.12, WICKET.z1 - WICKET.z0 - 0.04, 0.95, 2);
  // stepping stones from the gate to the chapel
  {
    const path: P2[] = [[(GATE.x0 + GATE.x1) / 2, wS - 0.2], [(GATE.x0 + GATE.x1) / 2, -102.6 - C.z1 + C.z1], [CH.x0 + 3, CH.z1 + 1.0]];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.62);
      const ry = -Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        if (rng.chance(0.08)) continue;
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t + rng.range(-0.06, 0.06), z = az + (bz - az) * t + rng.range(-0.06, 0.06);
        const y = heightAt(x, z) + 0.025;
        mb.pushTRS(x, y - 0.05, z, ry + PI / 2 + rng.range(-0.15, 0.15));
        mb.box('sacred_granite', 0, 0, 0, rng.range(0.42, 0.56), 0.1, rng.range(0.32, 0.42), { skip: ['ny'], uvOffset: [rng.float() * 5, rng.float() * 5] });
        mb.pop();
      }
    }
  }

  // ---------------------------------------------------------------- graves
  const ctx: GraveCtx = { mb, physics, decals, h: heightAt, rng };
  // the Lindner family tomb against the north wall, Anna and Marie beside it
  const tombX = 57.85, rowN = C.z0 + wt + 0.35;
  familyTomb(ctx, tombX, C.z0 + wt + 0.02);
  const env = ENV_TEXT.gravestones;
  const anna = env.find((g) => g.id === 'stone_anna')!;
  const marie = env.find((g) => g.id === 'cross_marie')!;
  const nameless = env.find((g) => g.id === 'cross_nameless')!;
  smallStone(ctx, 60.0, rowN + 0.1, 0.05, { id: anna.id, kind: 'small_stone', shape: 'flat', mat: 'sacred_sandstone', w: 0.46, h: 0.5, lines: anna.lines, wear: 0.65, mound: true }, true);
  ironCross(ctx, 55.55, rowN + 0.15, -0.04, { id: marie.id, kind: 'iron_cross', lines: marie.lines, small: true }, true);
  // candidate plots (stone at the north end, grave towards the south)
  const plots: P2[] = [];
  const rows = [-110.4, -107.8, -105.2, -102.6, -100.0];
  for (const x of [55.55, 57.05, 58.55, 59.95]) for (const z of rows) plots.push([x, z]);
  for (const x of [42.1, 43.6, 45.1]) for (const z of [-112.95, ...rows]) plots.push([x, z]);
  for (const x of [49.4, 50.9, 52.4, 53.9]) for (const z of [-101.4, -98.9]) plots.push([x, z]);
  const keep = plots.filter(([x, z]) => !(x < 42.5 && (z === -112.95 || z === -110.4)) && !(x > 45 && x < 46 && z === -100.0) && !(x > 56.5 && x < 59 && z === -110.4));
  rng.fork('plots').shuffle(keep);
  FILLER_GRAVES.forEach((g, i) => {
    const [x, z] = keep[i];
    const ry = rng.range(-0.05, 0.05);
    if (g.kind === 'small_stone') smallStone(ctx, x + rng.range(-0.08, 0.08), z, ry, g, false);
    else if (g.kind === 'iron_cross') ironCross(ctx, x + rng.range(-0.08, 0.08), z, ry, g, false);
    else woodenCross(ctx, x + rng.range(-0.08, 0.08), z, ry, g);
  });
  // the nameless cross under the three spruces, outside the wall
  namelessCross(ctx, NAMELESS_CROSS.x, NAMELESS_CROSS.z, NAMELESS_CROSS.ry, nameless.lines);

  // ---------------------------------------------------------------- water trough with hand pump, compost corner
  {
    const x = 45.1, z = wS - 0.55, g = rectRange(heightAt, x - 0.5, z - 0.25, x + 0.5, z + 0.25, 0.25);
    const top = g.max + 0.55, b = g.min - 0.15;
    mb.pushTRS(x, 0, z, 0);
    mb.box('sacred_granite', 0, (top + b) / 2, -0.21, 1.0, top - b, 0.08, { skip: ['ny'] });
    mb.box('sacred_granite', 0, (top + b) / 2, 0.21, 1.0, top - b, 0.08, { skip: ['ny'] });
    mb.box('sacred_granite', -0.46, (top + b) / 2, 0, 0.08, top - b, 0.34, { skip: ['ny'] });
    mb.box('sacred_granite', 0.46, (top + b) / 2, 0, 0.08, top - b, 0.34, { skip: ['ny'] });
    quadToward(mb, 'sacred_water', [-0.42, top - 0.12, -0.17], [0.42, top - 0.12, -0.17], [0.42, top - 0.12, 0.17], [-0.42, top - 0.12, 0.17], [0, 1, 0]);
    mb.cylinder('iron_black', 0.3, top, 0.32, 0.05, 0.045, 0.9, 10);
    mb.rod('iron_black', V3(0.3, top + 0.7, 0.32), V3(0.3, top + 0.6, 0.05), 0.02);
    mb.rod('iron_black', V3(0.3, top + 0.85, 0.32), V3(0.75, top + 1.0, 0.32), 0.018);
    mb.pop();
    physics?.addBox({ cx: x, cy: (top + b) / 2, cz: z, hx: 0.5, hy: (top - b) / 2, hz: 0.25, surface: 'stone' });
    // compost corner (north-west): plank pen, soil heap, old wreaths
    const cx = C.x0 + wt + 0.75, cz = C.z0 + wt + 0.65, cg = heightAt(cx, cz);
    for (const [px, pz, sx, sz] of [[cx, cz + 0.55, 1.4, 0.04], [cx + 0.7, cz, 0.04, 1.1]] as const) {
      mb.pushTRS(px, cg + 0.22, pz, 0, 1, 1, 1, rng.range(-0.05, 0.05), rng.range(-0.05, 0.05));
      mb.box('sacred_wood_grey', 0, 0, 0, sx, 0.5, sz, { uv: 'local', uvRotate: sx < 0.1 });
      mb.pop();
    }
    mound(mb, 'sacred_earth', cx - 0.05, cg - 0.05, cz - 0.05, 0.3, 0.6, 0.35, 0.5);
    for (let i = 0; i < 3; i++) {
      const wx = cx + rng.range(-0.3, 0.3), wz = cz + rng.range(-0.25, 0.25), wy = cg + 0.18 + i * 0.06;
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k <= 14; k++) { const a = (k / 14) * PI * 2; ring.push(V3(wx + Math.cos(a) * 0.17, wy + Math.sin(a * 2) * 0.02, wz + Math.sin(a) * 0.17)); }
      mb.tube('sacred_wreath', ring, ring.map(() => 0.03), 5);
      mb.box('fabric_red', wx + 0.12, wy + 0.01, wz, 0.12, 0.004, 0.05);
    }
  }

  const group = mb.build(materials, { name: 'cemetery' });
  const ins = decals.build();
  if (ins) group.add(ins);
  levelsChanged();
  return kit.output(group);
}

interface GraveCtx { mb: MeshBuilder; physics: Physics | undefined; decals: TextDecals; h: HeightFn; rng: RNG }

/** Static wrought-iron gate leaf. Hinge at (x, y, z); yaw `ry` rotates the leaf (local +x) about the hinge. */
function ironLeaf(mb: MeshBuilder, physics: Physics | undefined, x: number, y: number, z: number, ry: number, w: number, h: number, seed: number): void {
  const rng = new RNG(`gate${seed}`);
  const m = frameMatrix(x, y, z, ry, 0, rng.range(-0.02, 0.02));
  mb.push(m);
  const iron = 'rust_metal';
  mb.box(iron, w / 2, 0.08, 0, w, 0.035, 0.02);
  mb.box(iron, w / 2, h * 0.62, 0, w, 0.03, 0.02);
  mb.box(iron, 0.02, h / 2, 0, 0.04, h, 0.03);
  mb.box(iron, w - 0.015, h * 0.45, 0, 0.03, h * 0.9, 0.025);
  const nb = Math.max(3, Math.round(w / 0.12));
  for (let i = 1; i < nb; i++) {
    const bx = (w * i) / nb, top = h * (0.8 + 0.18 * Math.sin((PI * i) / nb));
    mb.box(iron, bx, (0.06 + top) / 2, 0, 0.016, top - 0.06, 0.016);
    mb.pushTRS(bx, top + 0.025, 0, 0, 1, 1, 1, 0, PI / 4);
    mb.box(iron, 0, 0, 0, 0.03, 0.03, 0.012);
    mb.pop();
  }
  // scrolls between the rails
  for (let i = 0; i < nb - 1; i++) {
    const cx = (w * (i + 1)) / nb, cy = h * 0.36;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) { const a = (k / 10) * PI * 1.6; const r = 0.06 * (1 - k / 14); pts.push(V3(cx + Math.cos(a + 1) * r - 0.03, cy + Math.sin(a + 1) * r, 0)); }
    mb.tube(iron, pts, pts.map(() => 0.006), 4);
  }
  mb.pop();
  obb(physics, m, [w / 2, h / 2, 0], [w / 2, h / 2, 0.03], 'metal');
}

/** Lettering lines → plate text style. */
function stoneText(g: GraveDef, seed: number, dark: boolean): DrawFn {
  const n = g.lines.length;
  const lines: Line[] = g.lines.map((t, i) => ({ t, s: i === (g.lines[0] === 'Hier ruht' ? 1 : 0) ? 1.25 : t.startsWith('*') || t.startsWith('†') ? 0.85 : 0.95 }));
  const draw = textBlock(lines, { font: FONT_ROMAN, mode: dark ? 'gild' : 'engrave', weight: '600', wear: g.wear ?? 0.3, seed, lead: n > 4 ? 1.25 : 1.4 });
  return (c, w, h) => { lichen(c, w, h, g.wear ?? 0.3, seed + 7); draw(c, w, h); };
}

function smallStone(ctx: GraveCtx, x: number, z: number, ry: number, g: GraveDef, special: boolean): void {
  const { mb, rng } = ctx;
  const mat = g.mat ?? rng.pick(['sacred_granite', 'sacred_granite', 'sacred_marble', 'sacred_granite_dark']);
  const sw = g.w ?? rng.range(0.5, 0.72), sh = g.h ?? rng.range(0.68, 1.0), st = rng.range(0.12, 0.16), bh = rng.range(0.08, 0.15);
  const gr = rectRange(ctx.h, x - sw / 2 - 0.07, z - 0.15, x + sw / 2 + 0.07, z + 0.15, 0.2);
  const base = gr.min;
  const shape = g.shape ?? 'flat';
  const lean = g.lean ?? (special ? 0.0 : rng.chance(0.25) ? rng.range(0.03, 0.1) : rng.range(-0.015, 0.015));
  const leanSide = rng.range(-0.06, 0.06);
  let m: THREE.Matrix4;
  if (g.fallen) {
    // toppled forwards onto the grave, inscription down
    const lie = rectRange(ctx.h, x - sw / 2, z + 0.25, x + sw / 2, z + 0.25 + sh, 0.2);
    m = new THREE.Matrix4().compose(V3(x, (lie.min + lie.max) / 2 + st / 2 - 0.015, z + 0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2 - 0.04, ry + 0.2, 0.03, 'YXZ')), V3(1, 1, 1));
    mb.box(mat, x, base + 0.02, z, sw + 0.14, 0.16, st + 0.16, { skip: ['ny'] });                       // the base it fell from
  } else m = frameMatrix(x, base, z, ry, -lean, leanSide * (lean ? 0.5 : 0));
  mb.push(m);
  const yb = g.fallen ? -bh : 0;
  if (!g.fallen) mb.box(mat, 0, (bh - 0.2) / 2, 0.02, sw + 0.14, bh + 0.2, st + 0.16, { skip: ['ny'] });
  let rh = sh;
  const y0 = yb + bh, hw = sw / 2;
  if (shape === 'round') {
    const rise = sw * 0.22; rh = sh - rise;
    const R = (hw * hw + rise * rise) / (2 * rise), cy = y0 + sh - R;
    const a0 = Math.atan2(y0 + rh - cy, hw);
    extrude(mb, mat, [[-hw, y0], [hw, y0], ...arc(0, cy, R, a0, PI - a0, 8), [-hw, y0 + rh]] as P2[], -st / 2, st / 2);
  } else if (shape === 'gable') {
    rh = sh - sw * 0.24;
    extrude(mb, mat, [[-hw, y0], [hw, y0], [hw, y0 + rh], [0, y0 + sh], [-hw, y0 + rh]], -st / 2, st / 2);
  } else if (shape === 'shoulder') {
    rh = sh - 0.13;
    mb.box(mat, 0, y0 + rh / 2, 0, sw, rh, st);
    mb.box(mat, 0, y0 + rh + 0.065, 0, sw * 0.62, 0.13, st);
  } else {
    mb.box(mat, 0, y0 + sh / 2, 0, sw, sh, st);
    if (shape === 'flat') mb.box(mat, 0, y0 + sh + 0.02, 0, sw + 0.03, 0.04, st + 0.03);
    else {
      mb.box(mat, 0, y0 + sh + 0.16, 0, 0.07, 0.32, 0.07);
      mb.box(mat, 0, y0 + sh + 0.22, 0, 0.24, 0.07, 0.07);
    }
  }
  if (g.id === 'stone_anna') {
    // a lamb lying on top, its head worn away
    mound(mb, mat, 0, y0 + sh + 0.03, 0, 0, 0.11, 0.1, 0.17);
    sphere(mb, mat, 0, y0 + sh + 0.1, -0.13, 0.045, 7, 4, 0.8);
    for (const sx of [-1, 1]) mb.box(mat, sx * 0.07, y0 + sh + 0.045, 0.06, 0.04, 0.03, 0.1);
  }
  mb.pop();
  // inscription
  if (g.lines.length && !g.fallen) {
    const ph = Math.min(rh * 0.82, g.lines.length * 0.085 + 0.05);
    const cy = y0 + rh - 0.04 - ph / 2;
    const dark = mat === 'sacred_granite_dark';
    ctx.decals.addLocal(m, [0, cy, st / 2], [1, 0, 0], [0, 1, 0], sw * 0.86, ph, stoneText(g, Math.floor(x * 31 + z * 17), dark));
  }
  // collider
  obb(ctx.physics, m, [0, (yb + y0 + sh) / 2, 0], [hw + 0.07, (sh + bh) / 2, st / 2 + 0.08], 'stone');
  graveBed(ctx, x, z, ry, g, st / 2 + 0.12);
}

/** Kerb, gravel/moss fill or earth mound in front of the head stone. */
function graveBed(ctx: GraveCtx, x: number, z: number, ry: number, g: GraveDef, front: number): void {
  const { mb, rng } = ctx;
  const len = g.small ? 1.0 : 1.75, hw = g.small ? 0.3 : 0.44;
  const s = Math.sin(ry), c = Math.cos(ry);
  const W = (lx: number, lz: number): P2 => [x + lx * c + lz * s, z - lx * s + lz * c];
  if (g.kerb) {
    const strips: [number, number, number, number][] = [[-hw, front, -hw, front + len], [hw, front, hw, front + len], [-hw, front + len, hw, front + len]];
    for (const [ax, az, bx, bz] of strips) {
      if (rng.chance(0.12)) continue;   // a strip sunk away
      const [wx, wz] = W((ax + bx) / 2, (az + bz) / 2);
      const y = ctx.h(wx, wz);
      const l = Math.hypot(bx - ax, bz - az) + 0.1;
      const along = Math.abs(bz - az) > Math.abs(bx - ax);
      mb.pushTRS(wx, y, wz, ry, 1, 1, 1, rng.range(-0.02, 0.02), rng.range(-0.03, 0.03));
      mb.box('sacred_granite', 0, -0.02, 0, along ? 0.1 : l, 0.2, along ? l : 0.1, { skip: ['ny'], uvOffset: [rng.float() * 3, 0] });
      mb.pop();
    }
    const corners = [W(-hw + 0.05, front + 0.03), W(hw - 0.05, front + 0.03), W(hw - 0.05, front + len - 0.05), W(-hw + 0.05, front + len - 0.05)];
    const r = ptsRange(ctx.h, corners);
    if (r.max - r.min < 0.12) {
      const y = r.max + 0.03;
      const fill = rng.pick(['gravel', 'moss', 'sacred_earth']);
      const pts = corners.map(([px, pz]) => [px, y, pz]);
      quadToward(mb, fill, pts[0], pts[1], pts[2], pts[3], [0, 1, 0]);
    }
  } else if (g.mound) {
    const [mx, mz] = W(0, front + len / 2);
    mound(mb, 'sacred_earth', mx, ctx.h(mx, mz) - 0.07, mz, ry, hw * 0.95, 0.2, len * 0.5);
  }
}

function ironCross(ctx: GraveCtx, x: number, z: number, ry: number, g: GraveDef, special: boolean): void {
  const { mb, rng } = ctx;
  const H = g.small ? (special ? 0.78 : 0.7) : rng.range(1.0, 1.25);
  const ground = rectRange(ctx.h, x - 0.18, z - 0.15, x + 0.18, z + 0.15, 0.15).min;
  const lean = g.lean ?? rng.range(-0.02, 0.02);
  const m = frameMatrix(x, ground, z, ry, -lean, rng.range(-0.03, 0.03));
  const iron = special ? 'iron_black' : 'rust_metal';
  mb.push(m);
  mb.box('sacred_granite', 0, 0.02, 0, 0.3, 0.24, 0.24, { skip: ['ny'] });
  mb.box(iron, 0, (0.14 + H) / 2, 0, 0.03, H - 0.14, 0.03);
  const yc = H - 0.3 * (H / 1.1), arm = 0.24 * (H / 1.1);
  mb.box(iron, 0, yc, 0, arm * 2, 0.03, 0.03);
  const tre = (ex: number, ey: number, dx: number, dy: number) => {
    for (const [ox, oy] of [[dx * 0.03, dy * 0.03], [-dy * 0.026 + dx * 0.005, dx * 0.026 + dy * 0.005], [dy * 0.026 + dx * 0.005, -dx * 0.026 + dy * 0.005]]) {
      mb.pushTRS(ex + ox, ey + oy, 0, 0, 1, 1, 1, PI / 2);
      mb.cylinder(iron, 0, -0.006, 0, 0.022, 0.022, 0.012, 8);
      mb.pop();
    }
  };
  tre(0, H, 0, 1); tre(-arm, yc, -1, 0); tre(arm, yc, 1, 0);
  const ring: THREE.Vector3[] = [];
  const rr = 0.13 * (H / 1.1);
  for (let k = 0; k <= 16; k++) { const a = (k / 16) * PI * 2; ring.push(V3(Math.cos(a) * rr, yc + Math.sin(a) * rr, 0)); }
  mb.tube(iron, ring, ring.map(() => 0.006), 4);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * PI * 1.5; const r = 0.045 * (H / 1.1) * (1 - k / 12); pts.push(V3(sx * (0.06 + Math.cos(a) * r) * (H / 1.1), yc + sy * (0.06 + Math.sin(a) * r) * (H / 1.1), 0)); }
    mb.tube(iron, pts, pts.map(() => 0.005), 4);
  }
  // oval plate (enamel shown by the decal)
  const pw = special ? 0.21 : 0.19, ph = special ? 0.17 : 0.13, py = yc - rr - ph / 2 - 0.02;
  mb.pushTRS(0, py, 0.022, 0, 1, 1, ph / pw, PI / 2);
  mb.cylinder(iron, 0, -0.005, 0, pw / 2, pw / 2, 0.01, 14);
  mb.pop();
  mb.pop();
  if (g.lines.length) {
    const seed = Math.floor(x * 13 + z * 7);
    const lines: Line[] = special ? [{ t: g.lines[0], s: 1 }, { t: g.lines[1] ?? '', s: 0.9 }, { t: '', s: 1.6 }] : g.lines.map((t, i) => ({ t, s: i ? 0.85 : 1 }));
    ctx.decals.addLocal(m, [0, py, 0.029], [1, 0, 0], [0, 1, 0], pw * 0.98, ph * 0.98, enamelPlate(lines, special ? 0.05 : 0.45, seed), 900);
  }
  obb(ctx.physics, m, [0, H / 2, 0], [0.16, H / 2, 0.13], 'metal');
  if (special) {
    // Marie: no grave mound, only a little bed of moss – and a fresh candle stub
    const s = Math.sin(ry), c = Math.cos(ry);
    const pts: number[][] = [];
    const cxl = 0, czl = 0.55, gy = ctx.h(x + czl * s, z + czl * c) + 0.02;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * PI * 2;
      const lx = cxl + Math.cos(a) * 0.3 * (0.85 + rng.float() * 0.3), lz = czl + Math.sin(a) * 0.42 * (0.85 + rng.float() * 0.3);
      pts.push([x + lx * c + lz * s, gy, z - lx * s + lz * c]);
    }
    const ctr = [x + czl * s, gy + 0.01, z + czl * c];
    for (let k = 0; k < pts.length; k++) triToward(mb, 'moss', ctr, pts[k], pts[(k + 1) % pts.length], [0, 1, 0]);
    graveLight(mb, x + 0.12 * c + 0.3 * s, gy - 0.01, z - 0.12 * s + 0.3 * c, { red: true, lit: true, wax: 0.03 });
    graveLight(mb, x - 0.14 * c + 0.22 * s, gy - 0.01, z + 0.14 * s + 0.22 * c, { red: true, wax: 0.004, soot: true });
  } else graveBed(ctx, x, z, ry, g, 0.2);
}

function enamelPlate(lines: Line[], wear: number, seed: number): DrawFn {
  return (g, w, h) => {
    g.save();
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, PI * 2); g.clip();
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1d2440'; g.lineWidth = Math.max(2, w * 0.035);
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - w * 0.06, h / 2 - h * 0.08, 0, 0, PI * 2); g.stroke();
    textBlock(lines, { font: FONT_ROMAN, mode: 'paint', color: '#16161a', pad: 0.18, lead: 1.25 })(g, w, h);
    // chipped enamel showing rusty iron
    const rng = new RNG(seed);
    const n = Math.round(4 + wear * 26);
    for (let i = 0; i < n; i++) {
      const edge = rng.chance(0.7);
      const a = rng.float() * PI * 2;
      const x = edge ? w / 2 + Math.cos(a) * (w / 2 - 3) : rng.float() * w, y = edge ? h / 2 + Math.sin(a) * (h / 2 - 3) : rng.float() * h;
      g.fillStyle = rng.chance(0.5) ? '#4a2e1c' : '#2a2420';
      g.beginPath(); g.ellipse(x, y, rng.range(1, 6) * (w / 180), rng.range(1, 4) * (w / 180), rng.float() * PI, 0, PI * 2); g.fill();
    }
    g.restore();
  };
}

function woodenCross(ctx: GraveCtx, x: number, z: number, ry: number, g: GraveDef): void {
  const { mb, rng } = ctx;
  const H = g.small ? 0.65 : rng.range(0.9, 1.15);
  const ground = ctx.h(x, z);
  const lean = g.lean ?? rng.range(0.02, 0.12);
  const sideways = rng.chance(0.5);
  const m = frameMatrix(x, ground, z, ry + rng.range(-0.1, 0.1), sideways ? -lean * 0.3 : -lean, sideways ? lean : 0);
  const wood = 'sacred_wood_grey';
  mb.push(m);
  mb.withColor([0.8 + rng.float() * 0.2, 0.8 + rng.float() * 0.2, 0.8 + rng.float() * 0.2], () => {
    mb.box(wood, 0, (H - 0.35) / 2, 0, 0.07, H + 0.35, 0.05, { uv: 'local', uvRotate: true });
    const yc = H * 0.72, arm = g.small ? 0.16 : 0.24;
    mb.box(wood, 0, yc, 0.05, arm * 2, 0.065, 0.045, { uv: 'local' });
    if (!g.small && rng.chance(0.55)) {
      for (const s of [-1, 1]) {
        mb.pushTRS(s * 0.07, H + 0.07, 0.02, 0, 1, 1, 1, 0, s * -0.6);
        mb.box(wood, 0, 0, 0, 0.18, 0.012, 0.14, { uv: 'local' });
        mb.pop();
      }
    }
    if (g.lines.length) mb.box(wood, 0, yc - 0.14, 0.035, 0.3, 0.12, 0.015, { uv: 'local' });
  });
  mb.pop();
  if (g.lines.length) {
    const yc = H * 0.72;
    const lines: Line[] = g.lines.map((t, i) => ({ t, s: i ? 0.8 : 1 }));
    ctx.decals.addLocal(m, [0, yc - 0.14, 0.0435], [1, 0, 0], [0, 1, 0], 0.28, 0.11, textBlock(lines, { font: FONT_ROMAN, mode: 'paint', color: 'rgba(30,26,22,0.75)', pad: 0.08, wear: 0.7, seed: Math.floor(x * 11 + z * 5) }), 900);
  }
  obb(ctx.physics, m, [0, H / 2, 0.02], [0.2, H / 2, 0.06], 'wood');
  graveBed(ctx, x, z, ry, g, 0.15);
}

function familyTomb(ctx: GraveCtx, x: number, z: number): void {
  const { mb } = ctx;
  const tomb = ENV_TEXT.gravestones.find((g) => g.id === 'tomb_lindner')!;
  const gr = rectRange(ctx.h, x - 1.3, z - 0.2, x + 1.3, z + 0.6, 0.25);
  const m = frameMatrix(x, gr.min, z, 0);
  const G = 'sacred_granite';
  mb.push(m);
  mb.box(G, 0, 0.08, 0.25, 2.5, 0.46, 0.62, { skip: ['ny'] });                   // socle (sunk 0.15)
  extrude(mb, G, [[-1.1, 0.3], [1.1, 0.3], [1.1, 1.9], [0, 2.12], [-1.1, 1.9]], 0.1, 0.4);
  mb.box(G, 0, 1.88, 0.25, 2.34, 0.08, 0.36);                                  // cornice
  for (const sx of [-1, 1]) mb.box(G, sx * 1.0, 1.08, 0.415, 0.2, 1.56, 0.04);  // pilasters
  mb.box('sacred_granite_dark', 0, 1.1, 0.415, 1.6, 1.36, 0.035);               // polished panel
  mb.box(G, 0, 2.4, 0.25, 0.12, 0.6, 0.1);                                      // cross on top
  mb.box(G, 0, 2.5, 0.25, 0.4, 0.11, 0.1);
  // grave lantern on the socle
  mb.box('iron_black', -0.7, 0.32, 0.49, 0.14, 0.02, 0.14);
  mb.cylinder('glass', -0.7, 0.33, 0.49, 0.085, 0.085, 0.14, 4, 'none');
  mb.box('iron_black', -0.7, 0.485, 0.49, 0.17, 0.03, 0.17);
  graveLight(mb, -0.7, 0.33, 0.49, { wax: 0.02, soot: true });
  mb.pop();
  // gilded inscription; the last name cut more sharply than the others
  const L = tomb.lines;
  const lines: Line[] = L.map((t, i) => ({ t, s: i === 0 ? 1.35 : t.startsWith('*') ? 0.78 : i === 1 || i === L.length - 1 ? 0.9 : 1, crisp: i === 9 || i === 10 }));
  ctx.decals.addLocal(m, [0, 1.1, 0.4325], [1, 0, 0], [0, 1, 0], 1.5, 1.28, textBlock(lines, { font: FONT_ROMAN, mode: 'gild', weight: '600', lead: 1.18, pad: 0.05, wear: 0.35, seed: 1951 }), 440);
  obb(ctx.physics, m, [0, 1.0, 0.25], [1.25, 1.15, 0.33], 'stone');
  // kerb with white gravel
  const hw = 1.2, f0 = 0.56, f1 = 2.35;
  for (const [ax, az, bx, bz] of [[-hw, f0, -hw, f1], [hw, f0, hw, f1], [-hw, f1, hw, f1]] as const) {
    const cx = x + (ax + bx) / 2, cz = z + (az + bz) / 2, y = ctx.h(cx, cz);
    const along = ax === bx;
    mb.box('sacred_granite', cx, y + 0.02, cz, along ? 0.12 : 2 * hw + 0.12, 0.24, along ? f1 - f0 : 0.12, { skip: ['ny'] });
  }
  const pts = [[x - hw + 0.06, 0, z + f0], [x + hw - 0.06, 0, z + f0], [x + hw - 0.06, 0, z + f1 - 0.06], [x - hw + 0.06, 0, z + f1 - 0.06]];
  const y = ptsRange(ctx.h, pts.map((p) => [p[0], p[2]] as P2)).max + 0.07;
  for (const p of pts) p[1] = y;
  quadToward(mb, 'gravel', pts[0], pts[1], pts[2], pts[3], [0, 1, 0]);
}

/** Josef's grave: two spruce battens, no name, his hat, and candles that are still being lit. */
function namelessCross(ctx: GraveCtx, x: number, z: number, ry: number, lines: string[]): void {
  const { mb, rng } = ctx;
  const g = ctx.h(x, z);
  const H = 1.12;
  const m = frameMatrix(x, g, z, ry, -0.03, 0.02);
  mb.push(m);
  mb.box('sacred_batten', 0, (H - 0.4) / 2, 0, 0.06, H + 0.4, 0.04, { uv: 'local', uvRotate: true });
  mb.box('sacred_batten', 0, 0.82, 0.04, 0.5, 0.055, 0.035, { uv: 'local' });
  for (const [nx, ny] of [[-0.012, 0.835], [0.012, 0.805], [-0.2, 0.82], [0.2, 0.82]]) mb.box('iron_black', nx, ny, 0.059, 0.008, 0.008, 0.004);
  // the grey felt hat hanging on the top of the upright
  mb.pushTRS(0.0, H - 0.1, 0.0, 0.4, 1, 1, 1, -0.32, 0.18);
  mb.lathe('sacred_felt', [[0.085, -0.004], [0.152, -0.002], [0.154, 0.004], [0.088, 0.012]], 14);
  mb.lathe('sacred_felt', [[0.088, 0.0], [0.084, 0.05], [0.078, 0.095], [0.06, 0.118], [0.0005, 0.122]], 14);
  mb.cylinder('black_soot', 0, 0.012, 0, 0.0885, 0.0855, 0.025, 14, 'none');
  mb.pop();
  mb.pop();
  obb(ctx.physics, m, [0, H / 2, 0.02], [0.26, H / 2, 0.05], 'wood');
  void lines;
  // the mound of earth in front
  const s = Math.sin(ry), c = Math.cos(ry);
  const W = (lx: number, lz: number): P2 => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [mx, mz] = W(0, 1.0);
  mound(mb, 'sacred_earth', mx, ctx.h(mx, mz) - 0.08, mz, ry, 0.48, 0.24, 0.95);
  // several glass candle holders, some soot fresh, one still burning
  const lights: [number, number, { red?: boolean; lit?: boolean; wax?: number; soot?: boolean; tipped?: boolean }][] = [
    [0.3, 0.12, { lit: true, wax: 0.035, red: true }], [-0.28, 0.16, { wax: 0.006, soot: true }], [0.5, 0.75, { wax: 0.012, soot: true }],
    [-0.52, 1.1, { wax: 0.002, soot: true, red: true }], [0.42, 1.55, { tipped: true }], [-0.16, 0.14, { wax: 0.02, soot: true }],
  ];
  for (const [lx, lz, o] of lights) { const [px, pz] = W(lx, lz); graveLight(mb, px, ctx.h(px, pz) - 0.005, pz, o); }
  void rng;
}

// ===================================================================================
// 4. HUNTING STAND (Hochstand Lindnerwiese, 1962)
// ===================================================================================

export function buildHuntingStand(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  defineSacredMaterials(materials);
  SACRED_LEVELS.ground = heightAt;
  const kit = new BuildingKit('hunting_stand', physics, { mat: 'hs_boards' });
  const mb = kit.mb;
  const rng = new RNG('hunting_stand');
  const decals = new TextDecals('hunting_stand', 700, true);
  const PX = POI.huntingStand.x, PZ = POI.huntingStand.z, yaw = STAND_YAW;
  const G0 = heightAt(PX, PZ);
  SACRED_LEVELS.standGround = G0;
  const HF = STAND_FLOOR, YF = G0 + HF;
  const SM = frameMatrix(PX, G0, PZ, yaw);
  const qY = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw);
  const L = (x: number, y: number, z: number) => V3(x, y, z).applyMatrix4(SM);
  const LW = (x: number, z: number): P2 => { const v = L(x, 0, z); return [v.x, v.z]; };
  const dirW = (x: number, y: number, z: number) => V3(x, y, z).applyQuaternion(qY);

  // ---------------------------------------------------------------- legs and bracing (unpeeled spruce poles)
  const legs: { foot: THREE.Vector3; top: THREE.Vector3 }[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const f = L(sx * 1.1, 0, sz * 1.1);
    f.y = heightAt(f.x, f.z) - 0.3;
    const t = L(sx * 0.78, HF - 0.14, sz * 0.78);
    legs.push({ foot: f, top: t });
    mb.rod('hs_log', f, t.clone().add(V3(0, 0.02, 0)), 0.088, 0.075, 9, 'both');
    const d = new THREE.Vector3().subVectors(t, f);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
    const mid = f.clone().add(t).multiplyScalar(0.5);
    physics?.addBox({ cx: mid.x, cy: mid.y, cz: mid.z, hx: 0.08, hy: d.length() / 2, hz: 0.08, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'wood' });
  }
  const legAt = (i: number, y: number) => { const { foot, top } = legs[i]; const t = (y - foot.y) / (top.y - foot.y); return foot.clone().lerp(top, Math.max(0, Math.min(1, t))); };
  for (const yb of [G0 + 1.3, G0 + 2.55]) for (let i = 0; i < 4; i++) mb.rod('hs_log', legAt(i, yb), legAt((i + 1) % 4, yb), 0.045, 0.045, 7);
  for (let i = 0; i < 4; i++) {
    if (i === 0) continue;                                                     // back side stays open below the stair
    mb.rod('hs_log', legAt(i, G0 + 0.4), legAt((i + 1) % 4, G0 + 1.3), 0.04, 0.04, 6);
    mb.rod('hs_log', legAt((i + 1) % 4, G0 + 1.3), legAt(i, G0 + 2.55), 0.04, 0.04, 6);
  }

  // ---------------------------------------------------------------- platform
  mb.push(SM);
  for (const x of [-0.78, 0.78]) mb.box('rough_timber_ext', x, HF - 0.11, -0.2, 0.12, 0.16, 2.1, { uv: 'local' });
  for (const z of [-1.1, -0.4, 0.3, 0.78]) mb.box('rough_timber_ext', 0, HF - 0.06, z, 1.7, 0.06, 0.1, { uv: 'local' });
  const nb = 16;
  for (let i = 0; i < nb; i++) {
    const z = -1.15 + (i + 0.5) * (1.95 / nb);
    mb.withColor([0.85 + rng.float() * 0.15, 0.85 + rng.float() * 0.15, 0.85 + rng.float() * 0.15], () => {
      mb.box('hs_boards', 0, HF - 0.015, z, 1.62, 0.03, 1.95 / nb - 0.01, { uv: 'local', uvOffset: [rng.float() * 3, rng.float() * 3] });
    });
  }
  mb.pop();
  obb(physics, SM, [0, HF - 0.06, -0.175], [0.81, 0.06, 0.975], 'wood');

  // ---------------------------------------------------------------- cabin
  const t = 0.035, c = 0.75 - t / 2;
  const boards = { left: 'hs_boards_int', right: 'hs_boards', cap: 'hs_boards', surface: 'wood', skirting: false, y0: YF, t } as const;
  const fFront = kit.wall({ ...boards, a: LW(-c, c), b: LW(c, c), y1: YF + 2.0, ext0: t / 2, ext1: t / 2, windows: [], openings: [{ at: c, width: 1.15, bottom: 0.95, top: 1.42, kind: 'window' }] });
  kit.wall({ ...boards, a: LW(c, c), b: LW(c, -c), y1: YF + 1.75, openings: [{ at: c - 0.2, width: 0.7, bottom: 0.95, top: 1.4, kind: 'window' }] });
  const doorO: Opening = { at: c - 0.3, width: 0.62, bottom: 0, top: 1.55, kind: 'door' };
  const fBack = kit.wall({ ...boards, a: LW(c, -c), b: LW(-c, -c), y1: YF + 1.75, ext0: t / 2, ext1: t / 2, doors: [{ o: doorO, frame: 'rough_timber_ext', architrave: false }] });
  kit.wall({ ...boards, a: LW(-c, -c), b: LW(-c, c), y1: YF + 1.75, openings: [{ at: c + 0.2, width: 0.7, bottom: 0.95, top: 1.4, kind: 'window' }] });
  void fFront;
  kit.doorInWall('door:hunting_stand_front', fBack, doorO, { style: 'ledged', mat: 'rough_timber_ext', handle: 'ring', handleMat: 'iron_black', seed: 62 }, 1, -1, { sound: 'wood', open: 0.2 });
  // side gables under the shed roof
  for (const sx of [-1, 1]) {
    for (const side of [-1, 1]) {
      const x = sx * (c + side * t / 2);
      const a = L(x, HF + 1.75, -0.75), b = L(x, HF + 1.75, 0.75), d = L(x, HF + 2.0, 0.75);
      const nrmW = dirW(sx * side, 0, 0);
      triToward(mb, side > 0 ? 'hs_boards' : 'hs_boards_int', a.toArray(), b.toArray(), d.toArray(), nrmW.toArray());
    }
  }
  mb.push(SM);
  for (const [x, z] of [[-0.69, -0.69], [0.69, -0.69], [0.69, 0.69], [-0.69, 0.69]]) mb.box('rough_timber_ext', x, HF + (z > 0 ? 1.0 : 0.875), z, 0.08, z > 0 ? 2.0 : 1.75, 0.08, { uv: 'local', uvRotate: true });
  // window flaps propped open (front and both sides)
  const flap = (px: number, pz: number, ry: number, w: number) => {
    mb.pushTRS(px, HF + 1.44, pz, ry, 1, 1, 1, -1.05);
    mb.box('hs_boards', 0, -0.25, 0.02, w, 0.5, 0.025, { uv: 'local', uvRotate: true });
    mb.box('hs_boards', 0, -0.4, 0.04, w - 0.05, 0.08, 0.02, { uv: 'local' });
    mb.pop();
    mb.pushTRS(px, HF + 0.95, pz, ry);
    mb.beam('rough_timber_ext', V3(w * 0.4, 0, 0.02), V3(w * 0.4, 0.27, 0.42), 0.025, 0.025);
    mb.pop();
  };
  flap(0, 0.77, 0, 1.2);
  flap(0.77, 0.2, PI / 2, 0.75);
  flap(-0.77, 0.2, -PI / 2, 0.75);
  // bench, gun rest, a nail with a hook
  mb.box('rough_timber', 0, HF + 0.45, -0.55, 1.3, 0.035, 0.32, { uv: 'local' });
  for (const x of [-0.5, 0.5]) mb.box('rough_timber', x, HF + 0.22, -0.55, 0.05, 0.44, 0.28);
  mb.box('rough_timber', 0, HF + 0.9, 0.6, 1.3, 0.03, 0.22, { uv: 'local' });
  for (const x of [-0.55, 0.55]) mb.beam('rough_timber', V3(x, HF + 0.6, c - t / 2 - 0.01), V3(x, HF + 0.88, 0.52), 0.04, 0.04);
  for (const x of [-0.6, 0.6]) mb.box('rough_timber', x, HF + 0.9, 0.0, 0.18, 0.03, 0.9, { uv: 'local' });
  mb.box('iron_black', -0.3, HF + 1.6, -c + t / 2 + 0.03, 0.008, 0.008, 0.06);
  // roof (shed, corrugated sheets) – geometry in the stand's frame
  buildRoof(mb, { type: 'shed', shedHigh: 's', x0: -0.75, z0: -0.75, x1: 0.75, z1: 0.75, eaveY: HF + 1.75, pitch: Math.atan2(0.25, 1.5), overhang: 0.3, thickness: 0.05, tileMat: 'corrugated', innerMat: 'hs_boards_int', fasciaMat: 'hs_boards', gutters: false, rafters: null });
  for (const x of [-0.55, 0, 0.55]) mb.beam('rough_timber_ext', V3(x, HF + 1.75 - 0.3 * Math.tan(Math.atan2(0.25, 1.5)) - 0.08, -1.05), V3(x, HF + 2.0 + 0.3 * (0.25 / 1.5) - 0.08, 1.05), 0.06, 0.08);
  mb.pop();
  {
    const pitch = Math.atan2(0.25, 1.5);
    const rm = new THREE.Matrix4().multiplyMatrices(SM, new THREE.Matrix4().compose(V3(0, HF + 1.875 + 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, 0)), V3(1, 1, 1)));
    obb(physics, rm, [0, 0, 0], [1.05, 0.04, 1.08], 'metal');
    obb(physics, SM, [0, HF + 0.45, -0.55], [0.65, 0.02, 0.16], 'wood');
    obb(physics, SM, [0, HF + 0.9, 0.6], [0.65, 0.02, 0.11], 'wood');
  }

  // ---------------------------------------------------------------- steep ladder-stair at the back
  {
    const sx = 0.3, top = -1.15, ang = (48 * PI) / 180;
    let len = HF / Math.tan(ang), yb = 0;
    for (let it = 0; it < 3; it++) {
      const [bx, bz] = LW(sx, top - len);
      yb = heightAt(bx, bz) - G0;
      len = (HF - yb) / Math.tan(ang);
    }
    const rise = HF - yb, n = Math.max(6, Math.round(rise / 0.26)), run = len / n, sh = rise / n, zb = top - len;
    mb.push(SM);
    for (const s of [-1, 1]) {
      mb.beam('hs_boards', V3(sx + s * 0.33, yb - 0.1, zb - 0.05), V3(sx + s * 0.33, HF + 0.02, top + 0.02), 0.05, 0.16);
      // handrail on posts
      mb.beam('rough_timber_ext', V3(sx + s * 0.36, yb + 0.95, zb), V3(sx + s * 0.36, HF + 0.95, top), 0.045, 0.045);
      mb.box('rough_timber_ext', sx + s * 0.36, yb + 0.47, zb, 0.06, 1.0, 0.06);
      mb.box('rough_timber_ext', sx + s * 0.36, HF + 0.47, top + 0.05, 0.06, 0.95, 0.06);
    }
    for (let i = 0; i < n - 1; i++) {
      const y = yb + (i + 1) * sh, z = zb + (i + 1) * run;
      mb.box('hs_boards', sx, y - 0.017, z + 0.06, 0.62, 0.035, 0.2, { uv: 'local', uvOffset: [i * 0.3, 0] });
    }
    // landing rails beside the door
    mb.beam('rough_timber_ext', V3(-0.8, HF + 0.95, -1.15), V3(sx - 0.36, HF + 0.95, -1.15), 0.045, 0.045);
    mb.box('rough_timber_ext', -0.8, HF + 0.47, -1.15, 0.06, 0.95, 0.06);
    mb.beam('rough_timber_ext', V3(-0.8, HF + 0.95, -1.15), V3(-0.8, HF + 0.95, -0.77), 0.045, 0.045);
    mb.beam('rough_timber_ext', V3(0.8, HF + 0.95, -1.15), V3(0.8, HF + 0.95, -0.77), 0.045, 0.045);
    mb.box('rough_timber_ext', 0.8, HF + 0.47, -1.15, 0.06, 0.95, 0.06);
    mb.pop();
    const sm = new THREE.Matrix4().multiplyMatrices(SM, new THREE.Matrix4().compose(V3(sx, (yb + HF) / 2 - 0.06, (zb + top) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(rise, len), 0, 0)), V3(1, 1, 1)));
    obb(physics, sm, [0, 0, 0], [0.31, 0.05, Math.hypot(len, rise) / 2], 'wood');
    for (const s of [-1, 1]) {
      const hm = new THREE.Matrix4().multiplyMatrices(SM, new THREE.Matrix4().compose(V3(sx + s * 0.36, (yb + HF) / 2 + 0.6, (zb + top) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(rise, len), 0, 0)), V3(1, 1, 1)));
      obb(physics, hm, [0, 0, 0], [0.03, 0.5, Math.hypot(len, rise) / 2], 'wood');
    }
    obb(physics, SM, [-0.8, HF + 0.5, -0.96], [0.03, 0.5, 0.19], 'wood');
    obb(physics, SM, [0.8, HF + 0.5, -0.96], [0.03, 0.5, 0.19], 'wood');
    obb(physics, SM, [(-0.8 + sx - 0.36) / 2, HF + 0.5, -1.15], [(sx - 0.36 + 0.8) / 2, 0.5, 0.03], 'wood');
  }

  // ---------------------------------------------------------------- name plate and carvings
  {
    const plateM = frameMatrix(0, 0, 0, 0);
    plateM.multiplyMatrices(SM, frameMatrix(0, HF + 0.62, 0.75 + 0.012, 0));
    mb.push(plateM);
    mb.box('painted_wood_green', 0, 0, 0, 0.8, 0.16, 0.022, { uv: 'local' });
    for (const x of [-0.36, 0.36]) mb.box('iron_black', x, 0, 0.012, 0.01, 0.01, 0.004);
    mb.pop();
    decals.addLocal(plateM, [0, 0, 0.011], [1, 0, 0], [0, 1, 0], 0.74, 0.12, textBlock([{ t: ENV_TEXT.huntingStand.plate.de }], { font: FONT_PAINT, mode: 'paint', color: '#e6e0cc', pad: 0.06, wear: 0.55, seed: 1962 }));
    // J.H. 1962 cut into the front-right leg, reading upwards; a pale fresh "M" lower down
    const leg = legs[2];
    const axis = new THREE.Vector3().subVectors(leg.top, leg.foot).normalize();
    const outward = dirW(0.4, 0, 1).normalize();
    outward.addScaledVector(axis, -outward.dot(axis)).normalize();
    const at = (hAbove: number, r: number) => {
      const groundY = leg.foot.y + 0.3;
      const tt = (groundY + hAbove - leg.foot.y) / (leg.top.y - leg.foot.y);
      return leg.foot.clone().lerp(leg.top, tt).addScaledVector(outward, r);
    };
    const upText = new THREE.Vector3().crossVectors(outward, axis).normalize();
    decals.add(at(1.45, 0.083), axis, upText, 0.2, 0.05, carving(ENV_TEXT.huntingStand.carving.de, false), 900, 0.002);
    decals.add(at(0.95, 0.085), axis, upText, 0.05, 0.05, carving(ENV_TEXT.huntingStand.laterCarving.de, true), 900, 0.002);
  }

  // ---------------------------------------------------------------- room, span, anchor
  const ca = Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw));
  const half = (c - t / 2) / ca;
  const cc = L(0, 0, 0);
  kit.room({ id: 'hunting_stand_cabin', location: 'hunting_stand', x0: cc.x - half, z0: cc.z - half, x1: cc.x + half, z1: cc.z + half, y0: YF, y1: YF + 1.75, floor: null, ceiling: null, wall: 'hs_boards_int', env: 'room_small' });
  kit.span({ x0: cc.x - half, z0: cc.z - half, x1: cc.x + half, z1: cc.z + half, floorY: YF, ceil: YF + 1.72 });
  const shelf = L(0, HF + 0.9, 0.6);
  kit.anchor('hunting_stand_shelf', shelf.x, shelf.y, shelf.z, yaw, 'hunting_stand_cabin');

  const group = mb.build(materials, { name: 'hunting_stand' });
  const ins = decals.build();
  if (ins) group.add(ins);
  levelsChanged();
  return kit.output(group);
}

function carving(text: string, fresh: boolean): DrawFn {
  return (g, w, h) => {
    if (fresh) {
      g.fillStyle = '#d9c9a2';
      g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0.2, 0, PI * 2); g.fill();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * 0.8;
    g.font = `700 ${size}px ${FONT_SANS}`;
    const mw = g.measureText(text).width;
    if (mw > w * 0.92) { size *= (w * 0.92) / mw; g.font = `700 ${size}px ${FONT_SANS}`; }
    g.fillStyle = fresh ? 'rgba(150,120,80,0.9)' : 'rgba(205,190,160,0.55)';
    g.fillText(text, w / 2 + 1, h / 2 + 1);
    g.fillStyle = fresh ? 'rgba(70,50,30,0.85)' : 'rgba(30,24,18,0.8)';
    g.fillText(text, w / 2, h / 2);
  };
}
