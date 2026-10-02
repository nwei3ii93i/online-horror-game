import { Noise, clamp, smoothstep, ihash2, fract } from './noise';
import { TexBuilder } from './TexBuilder';

/** Running-bond brick layout. Returns per-texel info (re-used object). */
export interface BrickInfo {
  mortar: number;   // 0 = brick face, 1 = full mortar
  id: number;       // unique brick id
  lx: number;       // local coords in brick [0,1]
  ly: number;
  edge: number;     // distance to nearest brick edge in brick-height units
  row: number;
  col: number;
}

export function brickAt(u: number, v: number, cols: number, rows: number, joint: number, out: BrickInfo, stagger = 0.5): BrickInfo {
  const y = v * rows;
  const row = Math.floor(y);
  const x = u * cols + (row & 1) * stagger;
  const col = Math.floor(x);
  const lx = x - col, ly = y - row;
  // joint in units of the brick height; horizontal joint is scaled by aspect
  const aspect = rows / cols; // brick width in brick-height units (square tile)
  const dx = Math.min(lx, 1 - lx) * aspect; // in brick-height units
  const dy = Math.min(ly, 1 - ly);
  const edge = Math.min(dx, dy);
  const m = 1 - smoothstep(joint * 0.5, joint * 0.5 + 0.04, edge);
  out.mortar = m;
  out.id = ((((col % cols) + cols) % cols) + row * 1013) | 0;
  out.lx = lx; out.ly = ly; out.edge = edge; out.row = row; out.col = col;
  return out;
}

export const brickInfo = (): BrickInfo => ({ mortar: 0, id: 0, lx: 0, ly: 0, edge: 0, row: 0, col: 0 });

/** Distance-field style crack network: thin dark lines. Returns 0..1 crack intensity. */
export function crackNetwork(noise: Noise, u: number, v: number, freq: number, width: number, warp = 0.08): number {
  const wu = u + noise.fbm(u, v, 3, 3) * warp;
  const wv = v + noise.fbm(u + 0.37, v + 0.71, 3, 3) * warp;
  const r = noise.ridged(wu, wv, freq, 4, 0.55);
  return smoothstep(1 - width, 1, r);
}

/** Stamp a soft-edged elliptical "leaf"/blob into the builder with wrap-around. */
export function stamp(
  b: TexBuilder,
  cu: number, cv: number,
  radiusU: number, radiusV: number,
  angle: number,
  fn: (lx: number, ly: number, i: number) => void,
): void {
  const n = b.n;
  const r = Math.max(radiusU, radiusV);
  const x0 = Math.floor((cu - r) * n), x1 = Math.ceil((cu + r) * n);
  const y0 = Math.floor((cv - r) * n), y1 = Math.ceil((cv + r) * n);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = y0; y <= y1; y++) {
    const yy = ((y % n) + n) % n;
    const pv = (y + 0.5) / n - cv;
    for (let x = x0; x <= x1; x++) {
      const xx = ((x % n) + n) % n;
      const pu = (x + 0.5) / n - cu;
      const lx = (pu * ca + pv * sa) / radiusU;
      const ly = (-pu * sa + pv * ca) / radiusV;
      if (lx * lx + ly * ly > 1.6) continue;
      fn(lx, ly, yy * n + xx);
    }
  }
}

/** Water tide-mark stains: returns {stain darkness, ring intensity}. */
export function waterStain(noise: Noise, u: number, v: number, freq: number, threshold: number): [number, number] {
  const s = noise.fbm(u + 0.13, v + 0.57, freq, 5, 0.55);
  const t = (s - threshold);
  const inside = smoothstep(0, 0.08, t);
  const ring = Math.exp(-Math.pow(t / 0.012, 2)) * (t > -0.03 ? 1 : 0);
  // secondary inner rings
  const ring2 = Math.exp(-Math.pow((t - 0.07) / 0.008, 2)) * 0.5;
  return [inside, clamp(ring + ring2)];
}

/** Wood grain value for a plank. Returns grain darkness in [0,1] and ring factor. */
export function woodGrain(noise: Noise, u: number, v: number, seed: number, ringScale: number, along: 'u' | 'v'): number {
  const a = along === 'u' ? u : v;
  const c = along === 'u' ? v : u;
  // warped distance from an imaginary pith → growth rings
  const w = noise.fbm2(along === 'u' ? u : v, along === 'u' ? v : u, 2, 6, 3, 0.5) * 0.6;
  const r = (c * ringScale + w * 3 + seed * 13.1);
  const rings = fract(r);
  const ringLine = Math.pow(smoothstep(0.0, 0.85, rings), 6);
  const fine = noise.fbm2(a, c, 4, 96, 3, 0.5) * 0.5 + 0.5;
  return clamp(ringLine * 0.6 + fine * 0.4);
}

/** Pseudo-random per id value. */
export const idRand = (id: number, salt: number) => ihash2(id, salt * 7919 + 13);
