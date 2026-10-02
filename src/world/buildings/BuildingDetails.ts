import * as THREE from 'three/webgpu';
import type { MeshBuilder } from '../architecture/MeshBuilder';
import type { MaterialLibrary, MatSpec } from '../../materials/MaterialLibrary';
import type { Physics } from '../../physics/Physics';
import type { InteriorSpan } from '../architecture/BuildingKit';
import type { Opening } from '../architecture/Walls';
import type { RNG } from '../../core/Random';

/**
 * Small geometry helpers shared by the outbuildings (Outbuildings.ts) and the service
 * tunnels (Tunnels.ts): pipes with bends, puddles, heaps, board walls, railings, ladder
 * stairs, hay bales, cart wheels and interior-span snapping.
 */

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ materials
/** Register builder-local materials once (the library keeps them in a global table). */
export function defineMaterials(materials: MaterialLibrary, specs: Record<string, MatSpec>): void {
  for (const [name, spec] of Object.entries(specs)) if (!materials.has(name)) materials.define(name, spec);
}

/** Concrete / brick finishes of the 1958 service tunnel (also used where the pump house meets it). */
export const TUNNEL_MATS: Record<string, MatSpec> = {
  tunnel_wall: { tex: 'concrete', scale: 3, color: '#a39f97' },
  tunnel_wall_damp: { tex: 'concrete', scale: 3, color: '#6b665e', roughness: 0.55 },
  tunnel_ceiling: { tex: 'concrete', scale: 3, color: '#8d8881' },
  tunnel_floor: { tex: 'concrete', scale: 2.5, color: '#76726b', roughness: 0.85 },
  tunnel_water: { color: '#090a0a', roughness: 0.04 },
  tunnel_brick: { tex: 'brick', scale: 2.08, color: '#9c8e84' },
  tunnel_brick_new: { tex: 'brick', scale: 2.08, color: '#c39b85' },
  tunnel_brick_damp: { tex: 'brick', scale: 2.08, color: '#62574f', roughness: 0.6 },
  coal_floor: { tex: 'concrete', scale: 2, color: '#47423c', roughness: 0.95 },
  coal: { color: '#121110', roughness: 0.42 },
  pipe_lagging: { tex: 'fabric_white', scale: 0.4, color: '#9c9384', vertexColors: true },
  water_streak: { color: '#2c2823', roughness: 0.3 },
};

// ------------------------------------------------------------------ interior spans
/** Resolution of the interior map (World.INTERIOR_RES); its origin lies on this grid. */
const GRID = 0.25;
export const floorGrid = (v: number): number => Math.floor(v / GRID + 1e-6) * GRID;
export const ceilGrid = (v: number): number => Math.ceil(v / GRID - 1e-6) * GRID;

/**
 * Interior span from the INNER wall faces, snapped outward to the interior-map grid so the
 * cells holding the inner faces count as indoors while the outer faces (≥ one cell away)
 * stay outdoors.
 */
export function spanFromInner(x0: number, z0: number, x1: number, z1: number, floorY: number, ceil: InteriorSpan['ceil'], margin = 0): InteriorSpan {
  return { x0: floorGrid(x0 - margin), z0: floorGrid(z0 - margin), x1: ceilGrid(x1 + margin), z1: ceilGrid(z1 + margin), floorY, ceil };
}

// ------------------------------------------------------------------ doors
/**
 * Opening for kit.doorInWall that puts the hinge exactly at `hingeS` and the leaf's free
 * edge at `tipS` (distances along the wall frame). Returns the opening and the hinge side.
 */
export function leafOpening(hingeS: number, tipS: number, bottom: number, top: number): { o: Opening; hingeSide: 1 | -1 } {
  const lining = 0.054;
  const hingeSide: 1 | -1 = hingeS < tipS ? -1 : 1;
  const L = Math.abs(tipS - hingeS);
  const W = L + 2 * lining - 0.01;
  const at = hingeS - hingeSide * (W / 2 - lining);
  return { o: { at, width: W, bottom, top, kind: 'door' }, hingeSide };
}

// ------------------------------------------------------------------ pipes
/** Tube along a polyline with rounded bends (bend radius ≈ 2.5 r). */
export function pipe(mb: MeshBuilder, mat: string, pts: THREE.Vector3[], r: number, sides = 10, bend = r * 2.5): void {
  const clean: THREE.Vector3[] = [];
  for (const p of pts) if (!clean.length || clean[clean.length - 1].distanceTo(p) > 1e-4) clean.push(p.clone());
  if (clean.length < 2) return;
  const path: THREE.Vector3[] = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const p = clean[i], a = clean[i - 1], b = clean[i + 1];
    const da = new THREE.Vector3().subVectors(a, p), db = new THREE.Vector3().subVectors(b, p);
    const la = da.length(), lb = db.length();
    da.normalize(); db.normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(da.dot(db), -1, 1));
    if (ang > Math.PI - 1e-3) { path.push(p); continue; }
    const t = Math.min(bend / Math.tan(ang / 2), la * 0.45, lb * 0.45);
    const p0 = p.clone().addScaledVector(da, t), p1 = p.clone().addScaledVector(db, t);
    const n = 6;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      path.push(p0.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(p, 2 * u * (1 - u)).addScaledVector(p1, u * u));
    }
  }
  path.push(clean[clean.length - 1]);
  const dedup: THREE.Vector3[] = [];
  for (const p of path) if (!dedup.length || dedup[dedup.length - 1].distanceTo(p) > 1e-4) dedup.push(p);
  if (dedup.length < 2) return;
  mb.tube(mat, dedup, dedup.map(() => r), sides);
}

/** Flange / collar disc centred at p, perpendicular to dir. */
export function flange(mb: MeshBuilder, mat: string, p: THREE.Vector3, dir: THREE.Vector3, r: number, t = 0.02, segments = 12): void {
  const d = dir.clone().normalize();
  mb.rod(mat, p.clone().addScaledVector(d, -t / 2), p.clone().addScaledVector(d, t / 2), r, r, segments);
}

// ------------------------------------------------------------------ ground clutter
/** Smooth periodic noise around a circle (k random harmonics) used for irregular outlines. */
function ringNoise(rng: RNG, amp: number): (a: number) => number {
  const h = [1, 2, 3, 5].map((f) => ({ f, ph: rng.range(0, Math.PI * 2), a: rng.range(0.3, 1) / f }));
  const norm = h.reduce((s, x) => s + x.a, 0);
  return (a: number) => 1 + (amp / norm) * h.reduce((s, x) => s + x.a * Math.sin(a * x.f + x.ph), 0);
}

/** Flat irregular puddle (glossy) lying at height y. */
export function puddle(mb: MeshBuilder, mat: string, cx: number, cz: number, y: number, rx: number, rz: number, rng: RNG, segs = 14): void {
  const nz = ringNoise(rng, 0.3);
  const rot = rng.range(0, Math.PI);
  const pts: number[][] = [];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    const r = nz(a);
    const lx = Math.cos(a) * rx * r, lz = Math.sin(a) * rz * r;
    pts.push([cx + lx * Math.cos(rot) - lz * Math.sin(rot), y, cz + lx * Math.sin(rot) + lz * Math.cos(rot)]);
  }
  const c = [cx, y, cz];
  for (let k = 0; k < segs; k++) mb.tri(mat, c, pts[(k + 1) % segs], pts[k]);
}

/** Low irregular mound (rubble, hay, coal) on the plane y. Facets oriented outward. */
export function heap(mb: MeshBuilder, mat: string, cx: number, y: number, cz: number, rx: number, rz: number, h: number, rng: RNG, nu = 12, nv = 4): void {
  const nz = ringNoise(rng, 0.25);
  const rot = rng.range(0, Math.PI);
  const ring = (v: number): number[][] => {
    const t = v / nv;
    const rr = Math.sqrt(Math.max(0, 1 - t * t));
    const out: number[][] = [];
    for (let k = 0; k < nu; k++) {
      const a = (k / nu) * Math.PI * 2;
      const n = nz(a + v * 0.7);
      const lx = Math.cos(a) * rx * rr * n, lz = Math.sin(a) * rz * rr * n;
      const yy = y + h * t * (0.85 + 0.3 * rng.float()) * (v === 0 ? 0 : 1);
      out.push([cx + lx * Math.cos(rot) - lz * Math.sin(rot), v === 0 ? y : yy, cz + lx * Math.sin(rot) + lz * Math.cos(rot)]);
    }
    return out;
  };
  const rings: number[][][] = [];
  for (let v = 0; v < nv; v++) rings.push(ring(v));
  const top = [cx, y + h, cz];
  const centre = [cx, y - h, cz];
  const tri = (a: number[], b: number[], c: number[]) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    const m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) mb.tri(mat, a, c, b); else mb.tri(mat, a, b, c);
  };
  for (let v = 0; v < nv - 1; v++) for (let k = 0; k < nu; k++) {
    const a = rings[v][k], b = rings[v][(k + 1) % nu], c = rings[v + 1][(k + 1) % nu], d = rings[v + 1][k];
    tri(a, b, c); tri(a, c, d);
  }
  const last = rings[nv - 1];
  for (let k = 0; k < nu; k++) tri(last[k], last[(k + 1) % nu], top);
}

/** Scatter of loose bricks / stones (small rotated boxes) inside a rectangle. */
export function scatterBlocks(mb: MeshBuilder, mat: string, x0: number, z0: number, x1: number, z1: number, y: number, n: number, rng: RNG, size: [number, number, number] = [0.24, 0.07, 0.115]): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0, x1), z = rng.range(z0, z1);
    const tilt = rng.range(-0.35, 0.35), roll = rng.range(-0.3, 0.3);
    const sc = rng.range(0.45, 1);
    const sx = size[0] * sc, sy = size[1], sz = size[2];
    // rest the lowest corner on the floor (2 mm sunk so it never floats)
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, 0, roll, 'YXZ'));
    let low = 0;
    for (const cx of [-sx / 2, sx / 2]) for (const cy of [-sy / 2, sy / 2]) for (const cz of [-sz / 2, sz / 2]) low = Math.min(low, new THREE.Vector3(cx, cy, cz).applyMatrix4(rot).y);
    mb.pushTRS(x, y - low - 0.002, z, rng.range(0, Math.PI), 1, 1, 1, tilt, roll);
    mb.box(mat, 0, 0, 0, sx, sy, sz, { uv: 'local', uvOffset: [rng.float() * 3, rng.float() * 3] });
    mb.pop();
  }
}

// ------------------------------------------------------------------ wall & floor details
/** Irregular flat patch on a wall plane (exposed brick in render, soot, damp). */
export function wallPatch(mb: MeshBuilder, mat: string, c: THREE.Vector3, n: THREE.Vector3, rw: number, rh: number, rng: RNG, segs = 12): void {
  const u = new THREE.Vector3(-n.z, 0, n.x).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const pts: number[][] = [];
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(a * 2 + ph[0]) + 0.12 * Math.sin(a * 3 + ph[1]) + 0.07 * Math.sin(a * 5 + ph[2]);
    const p = c.clone().addScaledVector(u, Math.cos(a) * rw * r).addScaledVector(up, Math.sin(a) * rh * r);
    pts.push([p.x, p.y, p.z]);
  }
  const cc = [c.x, c.y, c.z];
  // orient each fan triangle toward n
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[(k + 1) % segs];
    const e1 = [a[0] - cc[0], a[1] - cc[1], a[2] - cc[2]], e2 = [b[0] - cc[0], b[1] - cc[1], b[2] - cc[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n.x + cr[1] * n.y + cr[2] * n.z >= 0) mb.tri(mat, cc, a, b); else mb.tri(mat, cc, b, a);
  }
}

/** Floor drain: cast-iron grate over a dark sump. */
export function drainGrate(mb: MeshBuilder, x: number, y: number, z: number, s = 0.3): void {
  mb.quad('black_soot', [x - s / 2, y - 0.03, z + s / 2], [x + s / 2, y - 0.03, z + s / 2], [x + s / 2, y - 0.03, z - s / 2], [x - s / 2, y - 0.03, z - s / 2], [0, 1, 0]);
  mb.box('iron_black', x, y + 0.003, z - s / 2 + 0.012, s, 0.012, 0.024, { skip: ['ny'] });
  mb.box('iron_black', x, y + 0.003, z + s / 2 - 0.012, s, 0.012, 0.024, { skip: ['ny'] });
  for (let k = 0; k < 7; k++) mb.box('iron_black', x - s / 2 + 0.03 + k * ((s - 0.06) / 6), y + 0.003, z, 0.012, 0.012, s - 0.048, { skip: ['ny'] });
}

/** Quad whose winding is flipped if needed so its front face looks along n. */
export function orientedQuad(mb: MeshBuilder, mat: string, a: number[], b: number[], c: number[], d: number[], n: number[], uvs?: number[][]): void {
  // diagonals: robust even when one edge has collapsed to a point
  const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) mb.quad(mat, a, d, c, b, n, uvs ? [uvs[0], uvs[3], uvs[2], uvs[1]] : undefined);
  else mb.quad(mat, a, b, c, d, n, uvs);
}

// ------------------------------------------------------------------ railings & stairs
/** Steel pipe railing along a polyline; colliders per segment. */
export function pipeRailing(mb: MeshBuilder, physics: Physics | undefined, pts: [number, number][], y: number, mat: string, h = 1.0, r = 0.021): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    mb.rod(mat, V(ax, y + h, az), V(bx, y + h, bz), r, r, 8);
    mb.rod(mat, V(ax, y + h * 0.5, az), V(bx, y + h * 0.5, bz), r * 0.8, r * 0.8, 6);
    const n = Math.max(1, Math.round(len / 1.1));
    for (let k = 0; k <= n; k++) {
      if (i > 0 && k === 0) continue;
      const t = k / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      mb.rod(mat, V(x, y, z), V(x, y + h + r, z), r, r, 8);
      mb.cylinder(mat, x, y, z, r * 2.6, r * 2.6, 0.012, 10);
    }
    physics?.addBox({ cx: (ax + bx) / 2, cy: y + h / 2, cz: (az + bz) / 2, hx: len / 2, hy: h / 2, hz: 0.04, ry: -Math.atan2(bz - az, bx - ax), surface: 'metal' });
  }
}

/** Rough timber post-and-rail barrier. */
export function timberRailing(mb: MeshBuilder, physics: Physics | undefined, pts: [number, number][], y: number, mat: string, h = 1.0): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    mb.beam(mat, V(ax, y + h - 0.05, az), V(bx, y + h - 0.05, bz), 0.1, 0.08);
    mb.beam(mat, V(ax, y + h * 0.48, az), V(bx, y + h * 0.48, bz), 0.08, 0.06);
    const n = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= n; k++) {
      if (i > 0 && k === 0) continue;
      const t = k / n;
      mb.box(mat, ax + (bx - ax) * t, y + h / 2, az + (bz - az) * t, 0.11, h, 0.11, { uv: 'local', uvRotate: true });
    }
    physics?.addBox({ cx: (ax + bx) / 2, cy: y + h / 2, cz: (az + bz) / 2, hx: len / 2, hy: h / 2, hz: 0.05, ry: -Math.atan2(bz - az, bx - ax), surface: 'wood' });
  }
}

export interface LadderStairDef {
  /** Bottom-front centre of the flight and direction of ascent (0 = toward −Z, as buildStairs). */
  x: number; z: number; y: number; dir: number;
  width: number; rise: number; steps: number; run: number;
  mat: string; railMat?: string; rail?: 'left' | 'right' | 'both' | null; surface?: string;
}

/**
 * Open ladder-stair (Leiterstiege): two strings and loose treads without risers. The collider
 * is a single ramp (must stay ≤ 50° for the character controller).
 */
export function ladderStair(mb: MeshBuilder, physics: Physics | undefined, d: LadderStairDef): void {
  const sh = d.rise / d.steps, len = d.run * d.steps;
  mb.pushTRS(d.x, d.y, d.z, d.dir);
  for (let i = 0; i < d.steps; i++) {
    const y = (i + 1) * sh;
    mb.box(d.mat, 0, y - 0.02, -(i + 0.5) * d.run, d.width, 0.04, Math.min(d.run + 0.02, 0.24), { uv: 'local', uvOffset: [i * 0.31, i * 0.17] });
  }
  for (const sx of [-d.width / 2 - 0.035, d.width / 2 + 0.035]) {
    mb.beam(d.mat, V(sx, 0.09, 0.06), V(sx, d.rise + 0.09, -len), 0.06, 0.18, V(1, 0, 0));
  }
  if (d.rail) {
    const sides = d.rail === 'both' ? [-1, 1] : d.rail === 'left' ? [-1] : [1];
    const rm = d.railMat ?? d.mat;
    for (const s of sides) {
      const x = s * (d.width / 2 + 0.035);
      mb.beam(rm, V(x, 0.95, 0.02), V(x, d.rise + 0.95, -len), 0.05, 0.05, V(1, 0, 0));
      mb.box(rm, x, 0.5, 0.0, 0.06, 1.0, 0.06);
      mb.box(rm, x, d.rise / 2 + 0.5, -len / 2, 0.05, 1.0, 0.05);
    }
  }
  mb.pop();
  if (physics) {
    const slopeLen = Math.hypot(len, d.rise);
    const ang = Math.atan2(d.rise, len);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, d.dir, 0, 'YXZ'));
    const c = V(0, d.rise / 2 - 0.05, -len / 2).applyAxisAngle(V(0, 1, 0), d.dir);
    physics.addBox({ cx: d.x + c.x, cy: d.y + c.y, cz: d.z + c.z, hx: d.width / 2, hy: 0.05, hz: slopeLen / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: d.surface ?? 'wood' });
  }
}

/** Vertical faces round a rectangular slab void (stairwell edges), facing into the void. */
export function voidEdges(mb: MeshBuilder, mat: string, v: { x0: number; z0: number; x1: number; z1: number }, yTop: number, thick: number, sides: ('n' | 's' | 'e' | 'w')[]): void {
  const y0 = yTop - thick, y1 = yTop;
  if (sides.includes('n')) mb.quad(mat, [v.x1, y0, v.z0], [v.x0, y0, v.z0], [v.x0, y1, v.z0], [v.x1, y1, v.z0], [0, 0, 1]);
  if (sides.includes('s')) mb.quad(mat, [v.x0, y0, v.z1], [v.x1, y0, v.z1], [v.x1, y1, v.z1], [v.x0, y1, v.z1], [0, 0, -1]);
  if (sides.includes('w')) mb.quad(mat, [v.x0, y0, v.z0], [v.x0, y0, v.z1], [v.x0, y1, v.z1], [v.x0, y1, v.z0], [1, 0, 0]);
  if (sides.includes('e')) mb.quad(mat, [v.x1, y0, v.z1], [v.x1, y0, v.z0], [v.x1, y1, v.z0], [v.x1, y1, v.z1], [-1, 0, 0]);
}

// ------------------------------------------------------------------ board walls
export interface BoardRunDef {
  /** Centre line of the cladding; the RIGHT side of a→b is the outer (weather) face. */
  a: [number, number]; b: [number, number];
  y0: number;
  /** Top of the boards as a function of the distance s along a→b (gables slope). */
  top: (s: number) => number;
  t?: number;
  outMat: string; inMat: string;
  rng: RNG;
  /** Board widths and gap range (m). Widths stay ≤ 0.225 so each board maps to one texture plank. */
  widths?: [number, number]; gaps?: [number, number];
  /** Probability that a board is missing (bigger light gaps). */
  missing?: number;
  /** Openings: no boards for s∈[s0,s1] between y0 and y1. */
  openings?: { s0: number; s1: number; y0: number; y1: number }[];
}

/** Vertical board cladding with real gaps (light shows through) — no colliders. */
export function boardRun(mb: MeshBuilder, d: BoardRunDef): number {
  const dx0 = d.b[0] - d.a[0], dz0 = d.b[1] - d.a[1];
  const L = Math.hypot(dx0, dz0);
  const dx = dx0 / L, dz = dz0 / L, rx = -dz, rz = dx;
  const ht = (d.t ?? 0.024) / 2;
  const [wMin, wMax] = d.widths ?? [0.16, 0.225];
  const [gMin, gMax] = d.gaps ?? [0.004, 0.022];
  const P = (s: number, y: number, o: number): number[] => [d.a[0] + dx * s + rx * o, y, d.a[1] + dz * s + rz * o];
  const nR = [rx, 0, rz], nL = [-rx, 0, -rz], nA = [-dx, 0, -dz], nB = [dx, 0, dz];
  let count = 0;
  const piece = (s0: number, s1: number, yb: number, yt0: number, yt1: number, u0: number, bottomVisible: boolean, topVisible: boolean) => {
    if (yt0 - yb < 0.02 && yt1 - yb < 0.02) return;
    const w = s1 - s0;
    const uv = (s: number, y: number) => [u0 + (s - s0), y];
    mb.quad(d.outMat, P(s0, yb, ht), P(s1, yb, ht), P(s1, yt1, ht), P(s0, yt0, ht), nR, [uv(s0, yb), uv(s1, yb), uv(s1, yt1), uv(s0, yt0)]);
    mb.quad(d.inMat, P(s1, yb, -ht), P(s0, yb, -ht), P(s0, yt0, -ht), P(s1, yt1, -ht), nL, [uv(s1, yb), uv(s0, yb), uv(s0, yt0), uv(s1, yt1)]);
    const e = 2 * ht;
    mb.quad(d.inMat, P(s0, yb, -ht), P(s0, yb, ht), P(s0, yt0, ht), P(s0, yt0, -ht), nA, [[u0, yb], [u0 + e, yb], [u0 + e, yt0], [u0, yt0]]);
    mb.quad(d.inMat, P(s1, yb, ht), P(s1, yb, -ht), P(s1, yt1, -ht), P(s1, yt1, ht), nB, [[u0, yb], [u0 + e, yb], [u0 + e, yt1], [u0, yt1]]);
    if (bottomVisible) mb.quad(d.inMat, P(s0, yb, -ht), P(s1, yb, -ht), P(s1, yb, ht), P(s0, yb, ht), [0, -1, 0], [[u0, 0], [u0 + w, 0], [u0 + w, e], [u0, e]]);
    if (topVisible) mb.quad(d.inMat, P(s0, yt0, ht), P(s1, yt1, ht), P(s1, yt1, -ht), P(s0, yt0, -ht), [0, 1, 0], [[u0, 0], [u0 + w, 0], [u0 + w, e], [u0, e]]);
    count++;
  };
  const ops = (d.openings ?? []).slice().sort((p, q) => p.s0 - q.s0);
  let s = 0;
  while (s < L - 0.01) {
    const w = Math.min(d.rng.range(wMin, wMax), L - s);
    const gap = d.rng.range(gMin, gMax);
    const s0 = s, s1 = s + w;
    s = s1 + gap;
    if (d.missing && d.rng.chance(d.missing)) continue;
    // texture column: the board samples one plank of the 12-plank texture tile
    const col = d.rng.int(0, 11);
    const u0 = col * 0.25 + (0.25 - Math.min(w, 0.24)) / 2;
    const yt0 = d.top(s0), yt1 = d.top(s1);
    // cut out openings that overlap this board
    const hit = ops.filter((o) => s1 > o.s0 && s0 < o.s1);
    if (!hit.length) { piece(s0, s1, d.y0, yt0, yt1, u0, false, false); continue; }
    // split the board at opening edges along s, then vertically around each opening
    const cuts = [s0, ...hit.flatMap((o) => [o.s0, o.s1]).filter((c) => c > s0 && c < s1), s1].sort((p, q) => p - q);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      const o = hit.find((q) => mid > q.s0 && mid < q.s1);
      const ta = d.top(a), tb = d.top(b);
      if (!o) { piece(a, b, d.y0, ta, tb, u0 + (a - s0), false, false); continue; }
      if (o.y0 > d.y0 + 0.02) piece(a, b, d.y0, Math.min(o.y0, ta), Math.min(o.y0, tb), u0 + (a - s0), false, true);
      if (o.y1 < Math.max(ta, tb) - 0.02) piece(a, b, o.y1, ta, tb, u0 + (a - s0), true, false);
    }
  }
  return count;
}

// ------------------------------------------------------------------ farm bits
/** Small rectangular hay bale with two strings, base centred at (x, y, z). */
export function hayBale(mb: MeshBuilder, mat: string, twine: string, x: number, y: number, z: number, ry: number, rng: RNG, size: [number, number, number] = [0.9, 0.36, 0.46]): void {
  const [lx, ly, lz] = size.map((v) => v * rng.range(0.95, 1.05));
  mb.pushTRS(x, y, z, ry + rng.range(-0.06, 0.06), 1, 1, 1, 0, rng.range(-0.03, 0.03));
  mb.box(mat, 0, ly / 2, 0, lx, ly, lz, { uv: 'local', uvOffset: [rng.float() * 4, rng.float() * 4] });
  for (const bx of [-lx * 0.25, lx * 0.25]) {
    mb.box(twine, bx, ly + 0.002, 0, 0.012, 0.004, lz + 0.006, { skip: ['ny'] });
    mb.box(twine, bx, ly / 2, lz / 2 + 0.002, 0.012, ly, 0.004, { skip: ['nz'] });
    mb.box(twine, bx, ly / 2, -lz / 2 - 0.002, 0.012, ly, 0.004, { skip: ['pz'] });
  }
  mb.pop();
}

/**
 * Wooden spoked cart wheel with an iron tyre, built around the local Z axis. The caller
 * positions it with mb.push (centre at origin).
 */
export function cartWheel(mb: MeshBuilder, wood: string, iron: string, r: number, spokes = 12, broken = 0, rng?: RNG): void {
  const seg = 16;
  const rimIn = r - 0.075, rimMid = r - 0.04;
  for (let i = 0; i < seg; i++) {
    if (broken && rng && i < broken) continue;
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = V(Math.cos(a0) * rimMid, Math.sin(a0) * rimMid, 0), p1 = V(Math.cos(a1) * rimMid, Math.sin(a1) * rimMid, 0);
    mb.beam(wood, p0, p1, 0.075, 0.065, V(0, 0, 1));
    const q0 = V(Math.cos(a0) * (r - 0.006), Math.sin(a0) * (r - 0.006), 0), q1 = V(Math.cos(a1) * (r - 0.006), Math.sin(a1) * (r - 0.006), 0);
    mb.beam(iron, q0, q1, 0.013, 0.07, V(0, 0, 1));
  }
  mb.rod(wood, V(0, 0, -0.13), V(0, 0, 0.13), 0.1, 0.1, 12);
  mb.rod(iron, V(0, 0, -0.14), V(0, 0, -0.11), 0.105, 0.105, 12);
  mb.rod(iron, V(0, 0, 0.11), V(0, 0, 0.14), 0.105, 0.105, 12);
  for (let k = 0; k < spokes; k++) {
    if (broken && rng && k === 1) continue;
    const a = (k / spokes) * Math.PI * 2 + 0.13;
    mb.rod(wood, V(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0), V(Math.cos(a) * (rimIn + 0.01), Math.sin(a) * (rimIn + 0.01), 0), 0.022, 0.016, 6);
  }
}

/** Wheel leaning against a wall: base contact at (x, y, z), wheel plane at yaw ry, leaning back by `lean` (rad). */
export function leaningWheel(mb: MeshBuilder, wood: string, iron: string, x: number, y: number, z: number, ry: number, lean: number, r: number, broken = 0, rng?: RNG): void {
  mb.pushTRS(x, y, z, ry, 1, 1, 1, -lean);
  mb.pushTRS(0, r, 0);
  cartWheel(mb, wood, iron, r, 12, broken, rng);
  mb.pop();
  mb.pop();
}
