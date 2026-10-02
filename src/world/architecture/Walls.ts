import { MeshBuilder } from './MeshBuilder';
import type { Physics, StaticBox } from '../../physics/Physics';

export interface Opening {
  /** Distance from wall start `a` to the opening centre (m). */
  at: number;
  width: number;
  /** Sill height above wall base. 0 for doors. */
  bottom: number;
  /** Head height above wall base. */
  top: number;
  kind?: 'door' | 'window' | 'hole' | 'arch';
  id?: string;
}

export interface FaceSpec {
  mat: string;
  /** Lower band in a different finish (oil dado, stone socle, tiles). */
  dado?: { mat: string; h: number };
}

export interface WallDef {
  a: [number, number];
  b: [number, number];
  y0: number;
  y1: number;
  t: number;
  /** Face on the left of a→b (seen from above, +X east, −Z north). */
  left?: FaceSpec | string | null;
  right?: FaceSpec | string | null;
  /** Material for reveals, ends and top. */
  cap?: string;
  openings?: Opening[];
  ext0?: number;
  ext1?: number;
  /** Skip collider creation. */
  noCollide?: boolean;
  surface?: string;
  /** Skip the top face (hidden under slab / roof). */
  noTop?: boolean;
}

const asFace = (f: FaceSpec | string | null | undefined): FaceSpec | null =>
  f == null ? null : typeof f === 'string' ? { mat: f } : f;

/** Geometry info of a wall, used by window/door builders and skirting. */
export interface WallFrame {
  ax: number; az: number;
  dx: number; dz: number;     // unit direction a→b
  rx: number; rz: number;     // unit right normal
  len: number;
  t: number;
  y0: number; y1: number;
}

export function wallFrame(w: WallDef): WallFrame {
  const dx0 = w.b[0] - w.a[0], dz0 = w.b[1] - w.a[1];
  const len = Math.hypot(dx0, dz0);
  const dx = dx0 / len, dz = dz0 / len;
  return { ax: w.a[0], az: w.a[1], dx, dz, rx: -dz, rz: dx, len, t: w.t, y0: w.y0, y1: w.y1 };
}

/** World point at distance s along the wall, height y, lateral offset `side` (+ = right). */
export function wallPoint(f: WallFrame, s: number, y: number, side: number): [number, number, number] {
  return [f.ax + f.dx * s + f.rx * side, y, f.az + f.dz * s + f.rz * side];
}

/**
 * Builds a wall with rectangular openings as a set of box pieces with per-side
 * finishes, reveals in the cap material and an optional dado band. Adds colliders.
 */
export function buildWall(mb: MeshBuilder, w: WallDef, physics?: Physics): WallFrame {
  const f = wallFrame(w);
  const left = asFace(w.left), right = asFace(w.right);
  const cap = w.cap ?? left?.mat ?? right?.mat ?? 'plaster_int';
  const s0 = -(w.ext0 ?? 0), s1 = f.len + (w.ext1 ?? 0);
  const ops = (w.openings ?? []).slice().sort((p, q) => p.at - q.at);
  const H = w.y1 - w.y0;
  const ht = w.t / 2;

  type Piece = { a: number; b: number; ya: number; yb: number; endA: boolean; endB: boolean; topIsReveal: boolean; bottomVisible: boolean };
  const pieces: Piece[] = [];
  let cursor = s0;
  let prevWasOpening = false;
  for (const o of ops) {
    const oa = o.at - o.width / 2, ob = o.at + o.width / 2;
    if (oa > cursor + 1e-4) pieces.push({ a: cursor, b: oa, ya: w.y0, yb: w.y1, endA: prevWasOpening, endB: true, topIsReveal: false, bottomVisible: false });
    // below opening (sill)
    if (o.bottom > 1e-3) pieces.push({ a: oa, b: ob, ya: w.y0, yb: w.y0 + o.bottom, endA: false, endB: false, topIsReveal: true, bottomVisible: false });
    // above opening (lintel)
    if (o.top < H - 1e-3) pieces.push({ a: oa, b: ob, ya: w.y0 + o.top, yb: w.y1, endA: false, endB: false, topIsReveal: false, bottomVisible: true });
    cursor = ob;
    prevWasOpening = true;
  }
  if (s1 > cursor + 1e-4) pieces.push({ a: cursor, b: s1, ya: w.y0, yb: w.y1, endA: prevWasOpening, endB: false, topIsReveal: false, bottomVisible: false });

  for (const p of pieces) {
    const A = (s: number, y: number, side: number) => wallPoint(f, s, y, side);
    // left face (normal = -right)
    const nL = [-f.rx, 0, -f.rz], nR = [f.rx, 0, f.rz];
    const faceQuads = (face: FaceSpec | null, side: number, n: number[]) => {
      if (!face) return;
      const bands: [number, number, string][] = [];
      if (face.dado && face.dado.h > 0) {
        const dh = w.y0 + face.dado.h;
        if (p.ya < dh) bands.push([p.ya, Math.min(p.yb, dh), face.dado.mat]);
        if (p.yb > dh) bands.push([Math.max(p.ya, dh), p.yb, face.mat]);
      } else bands.push([p.ya, p.yb, face.mat]);
      for (const [ya, yb, m] of bands) {
        if (side < 0) mb.quad(m, A(p.b, ya, side), A(p.a, ya, side), A(p.a, yb, side), A(p.b, yb, side), n);
        else mb.quad(m, A(p.a, ya, side), A(p.b, ya, side), A(p.b, yb, side), A(p.a, yb, side), n);
      }
    };
    faceQuads(left, -ht, nL);
    faceQuads(right, ht, nR);
    // top
    const isWallTop = Math.abs(p.yb - w.y1) < 1e-4;
    if ((p.topIsReveal || (isWallTop && !w.noTop))) {
      mb.quad(cap, A(p.a, p.yb, ht), A(p.b, p.yb, ht), A(p.b, p.yb, -ht), A(p.a, p.yb, -ht), [0, 1, 0]);
    }
    if (p.bottomVisible) {
      mb.quad(cap, A(p.a, p.ya, -ht), A(p.b, p.ya, -ht), A(p.b, p.ya, ht), A(p.a, p.ya, ht), [0, -1, 0]);
    }
    // ends (jambs at openings)
    const nA = [-f.dx, 0, -f.dz], nB = [f.dx, 0, f.dz];
    if (p.endA) mb.quad(cap, A(p.a, p.ya, -ht), A(p.a, p.ya, ht), A(p.a, p.yb, ht), A(p.a, p.yb, -ht), nA);
    if (p.endB) mb.quad(cap, A(p.b, p.ya, ht), A(p.b, p.ya, -ht), A(p.b, p.yb, -ht), A(p.b, p.yb, ht), nB);

    if (physics && !w.noCollide) {
      const cs = (p.a + p.b) / 2;
      const c = wallPoint(f, cs, (p.ya + p.yb) / 2, 0);
      const box: StaticBox = {
        cx: c[0], cy: c[1], cz: c[2],
        hx: (p.b - p.a) / 2, hy: (p.yb - p.ya) / 2, hz: ht,
        ry: -Math.atan2(f.dz, f.dx),
        surface: w.surface ?? 'stone',
      };
      physics.addBox(box);
    }
  }
  return f;
}

/** Skirting board along one side of a wall, interrupted by door openings. */
export function buildSkirting(mb: MeshBuilder, w: WallDef, side: 'left' | 'right', mat: string, h = 0.14, d = 0.022, from = 0, to?: number): void {
  const f = wallFrame(w);
  const sgn = side === 'right' ? 1 : -1;
  const off = sgn * (w.t / 2 + d / 2);
  const end = to ?? f.len;
  const doors = (w.openings ?? []).filter((o) => o.bottom < 0.05).map((o) => [o.at - o.width / 2 - 0.08, o.at + o.width / 2 + 0.08]).sort((p, q) => p[0] - q[0]);
  let cur = from;
  const seg = (a: number, b: number) => {
    if (b - a < 0.02) return;
    const c = wallPoint(f, (a + b) / 2, w.y0 + h / 2, off);
    mb.pushTRS(c[0], c[1], c[2], -Math.atan2(f.dz, f.dx));
    mb.box(mat, 0, 0, 0, b - a, h, d, { uv: 'local' });
    // top bead
    mb.box(mat, 0, h / 2 + 0.006, sgn * -0.003, b - a, 0.012, d * 0.6, { uv: 'local' });
    mb.pop();
  };
  for (const [a, b] of doors) {
    if (b < cur) continue;
    seg(cur, Math.min(a, end));
    cur = Math.max(cur, b);
  }
  seg(cur, end);
}

/** Moulded cornice where wall meets ceiling (simple 3-step profile). */
export function buildCornice(mb: MeshBuilder, w: WallDef, side: 'left' | 'right', mat: string, ceilingY: number, size = 0.09): void {
  const f = wallFrame(w);
  const sgn = side === 'right' ? 1 : -1;
  const steps: [number, number][] = [[size, size * 0.35], [size * 0.66, size * 0.7], [size * 0.33, size]];
  for (const [depth, hgt] of steps) {
    const c = wallPoint(f, f.len / 2, ceilingY - hgt / 2, sgn * (w.t / 2 + depth / 2));
    mb.pushTRS(c[0], c[1], c[2], -Math.atan2(f.dz, f.dx));
    mb.box(mat, 0, 0, 0, f.len, hgt, depth, { uv: 'local' });
    mb.pop();
  }
}
