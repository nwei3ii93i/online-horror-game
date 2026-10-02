/**
 * Tileable noise primitives for procedural texture synthesis.
 * Everything here is periodic so generated textures tile seamlessly.
 * Pure functions on numbers – runs in workers, the main thread and Node.
 */

export class Noise {
  private perm = new Uint16Array(1024);
  private gx = new Float32Array(256);
  private gy = new Float32Array(256);
  readonly seed: number;

  constructor(seed = 1) {
    this.seed = seed;
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const p = new Uint16Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 1024; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  /** Hash two lattice integers to [0,256). */
  h(i: number, j: number): number {
    return this.perm[(this.perm[i & 255] + (j & 255)) & 1023];
  }

  /** Random value in [0,1) for integer lattice point. */
  rand(i: number, j: number, salt = 0): number {
    return this.perm[(this.perm[(this.perm[(i + salt * 31) & 255] + (j & 255)) & 1023] + (salt & 255)) & 1023] / 256
      + this.perm[(this.h(j * 7 + 3, i * 13 + salt) + 17) & 1023] / 65536;
  }

  /** Periodic gradient (Perlin) noise. Period px × py lattice cells. Range ≈ [-1,1]. */
  perlin(x: number, y: number, px: number, py: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const g00 = this.h(x0, y0), g10 = this.h(x1, y0), g01 = this.h(x0, y1), g11 = this.h(x1, y1);
    const gx = this.gx, gy = this.gy;
    const n00 = gx[g00] * xf + gy[g00] * yf;
    const n10 = gx[g10] * (xf - 1) + gy[g10] * yf;
    const n01 = gx[g01] * xf + gy[g01] * (yf - 1);
    const n11 = gx[g11] * (xf - 1) + gy[g11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return (a + v * (b - a)) * 1.414;
  }

  /** Periodic value noise in [0,1]. */
  value(x: number, y: number, px: number, py: number, salt = 0): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.rand(x0, y0, salt), b = this.rand(x1, y0, salt);
    const c = this.rand(x0, y1, salt), d = this.rand(x1, y1, salt);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /**
   * Tileable fBm on texture coords u,v ∈ [0,1). `freq` = lattice cells across the tile
   * for the first octave (integer). Returns ≈ [-1,1].
   */
  fbm(u: number, v: number, freq: number, octaves = 5, gain = 0.5, lacunarity = 2): number {
    let sum = 0, amp = 1, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      const p = Math.max(1, Math.round(f));
      sum += amp * this.perlin(u * p + o * 17.13, v * p + o * 31.7, p, p);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  /** Anisotropic fbm: separate integer frequencies along u and v (for wood grain, streaks). */
  fbm2(u: number, v: number, fu: number, fv: number, octaves = 4, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0, a = fu, b = fv;
    for (let o = 0; o < octaves; o++) {
      const pa = Math.max(1, Math.round(a)), pb = Math.max(1, Math.round(b));
      sum += amp * this.perlin(u * pa + o * 7.7, v * pb + o * 3.1, pa, pb);
      norm += amp;
      amp *= gain; a *= 2; b *= 2;
    }
    return sum / norm;
  }

  /** Ridged multifractal, tileable, in [0,1]. */
  ridged(u: number, v: number, freq: number, octaves = 5, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      const p = Math.max(1, Math.round(f));
      const n = 1 - Math.abs(this.perlin(u * p + o * 11.1, v * p + o * 5.3, p, p));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  /**
   * Tileable Worley noise. `cells` cells across the tile. Writes F1, F2 distances
   * (in cell units) and the id of the nearest feature into `out`.
   */
  worley(u: number, v: number, cells: number, out: WorleyResult, jitter = 1): WorleyResult {
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, id = 0, cx = 0, cy = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const ci = xi + i, cj = yi + j;
        const wi = ((ci % cells) + cells) % cells, wj = ((cj % cells) + cells) % cells;
        const px = ci + 0.5 + (this.rand(wi, wj, 1) - 0.5) * jitter;
        const py = cj + 0.5 + (this.rand(wi, wj, 2) - 0.5) * jitter;
        const dx = px - x, dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = wi + wj * cells; cx = px; cy = py; }
        else if (d < f2) f2 = d;
      }
    }
    out.f1 = f1; out.f2 = f2; out.id = id; out.cx = cx / cells; out.cy = cy / cells;
    return out;
  }
}

export interface WorleyResult { f1: number; f2: number; id: number; cx: number; cy: number }
export const worleyResult = (): WorleyResult => ({ f1: 0, f2: 0, id: 0, cx: 0, cy: 0 });

// ---------- scalar helpers ----------
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);
/** Integer hash → [0,1) */
export const ihash = (n: number) => {
  let h = Math.imul(n | 0, 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
export const ihash2 = (a: number, b: number) => ihash(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
