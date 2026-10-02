import { Noise, clamp } from './noise';

/**
 * CPU-side PBR texture canvas. Generators paint into float channels; `pack()` turns
 * the channels into two RGBA8 textures:
 *   A: albedo.rgb (sRGB) + alpha  (alpha = height by default, metalness or opacity on request)
 *   B: normal.xy (tangent space, OpenGL convention) + roughness + ambient occlusion
 * Row 0 is v = 0 (bottom) – i.e. +v is "up" on walls.
 */
export type AlphaMode = 'height' | 'metal' | 'opacity';

export interface PackedTexture {
  size: number;
  a: Uint8Array; // albedo + alpha
  b: Uint8Array; // normal xy, roughness, ao
  alphaMode: AlphaMode;
}

export class TexBuilder {
  readonly n: number;
  readonly h: Float32Array;
  readonly col: Float32Array;
  readonly rough: Float32Array;
  readonly ao: Float32Array;
  readonly metal: Float32Array;
  opacity: Float32Array | null = null;
  normalStrength = 1;
  /** Strength of cavity AO derived from the height field. */
  cavity = 0.6;
  cavityRadius = 0.01;
  alphaMode: AlphaMode = 'height';

  constructor(size: number, readonly noise: Noise) {
    this.n = size;
    const c = size * size;
    this.h = new Float32Array(c);
    this.col = new Float32Array(c * 3);
    this.rough = new Float32Array(c).fill(0.8);
    this.ao = new Float32Array(c).fill(1);
    this.metal = new Float32Array(c);
  }

  /** Iterate all texels. u,v are texel-centre coords in [0,1). */
  each(fn: (u: number, v: number, i: number, x: number, y: number) => void): void {
    const n = this.n, inv = 1 / n;
    let i = 0;
    for (let y = 0; y < n; y++) {
      const v = (y + 0.5) * inv;
      for (let x = 0; x < n; x++, i++) fn((x + 0.5) * inv, v, i, x, y);
    }
  }

  setColor(i: number, r: number, g: number, b: number): void {
    const k = i * 3;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
  }

  mulColor(i: number, f: number): void {
    const k = i * 3;
    this.col[k] *= f; this.col[k + 1] *= f; this.col[k + 2] *= f;
  }

  mixColor(i: number, c: readonly number[], t: number): void {
    if (t <= 0) return;
    const k = i * 3;
    if (t > 1) t = 1;
    this.col[k] += (c[0] - this.col[k]) * t;
    this.col[k + 1] += (c[1] - this.col[k + 1]) * t;
    this.col[k + 2] += (c[2] - this.col[k + 2]) * t;
  }

  /** Bilinear wrapped sample of a scalar field at uv. */
  static sample(field: Float32Array, n: number, u: number, v: number): number {
    const x = u * n - 0.5, y = v * n - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const xa = ((x0 % n) + n) % n, ya = ((y0 % n) + n) % n;
    const xb = (xa + 1) % n, yb = (ya + 1) % n;
    const a = field[ya * n + xa], b = field[ya * n + xb], c = field[yb * n + xa], d = field[yb * n + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** Separable wrapped box blur (approx gaussian after 2 passes). Radius in texels. */
  static blur(src: Float32Array, n: number, radius: number, passes = 2): Float32Array {
    let a = Float32Array.from(src);
    let b = new Float32Array(src.length);
    const r = Math.max(1, Math.round(radius));
    const w = 1 / (2 * r + 1);
    for (let p = 0; p < passes; p++) {
      // horizontal
      for (let y = 0; y < n; y++) {
        const row = y * n;
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += a[row + ((k % n) + n) % n];
        for (let x = 0; x < n; x++) {
          b[row + x] = acc * w;
          const add = row + ((x + r + 1) % n);
          const rem = row + (((x - r) % n) + n) % n;
          acc += a[add] - a[rem];
        }
      }
      // vertical
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += b[(((k % n) + n) % n) * n + x];
        for (let y = 0; y < n; y++) {
          a[y * n + x] = acc * w;
          const add = ((y + r + 1) % n) * n + x;
          const rem = ((((y - r) % n) + n) % n) * n + x;
          acc += b[add] - b[rem];
        }
      }
    }
    return a;
  }

  pack(): PackedTexture {
    const n = this.n, c = n * n;
    const A = new Uint8Array(c * 4);
    const B = new Uint8Array(c * 4);
    const h = this.h;

    // Cavity AO from height: compare against blurred neighbourhood.
    let cav: Float32Array | null = null;
    if (this.cavity > 0) {
      const blurred = TexBuilder.blur(h, n, Math.max(1, this.cavityRadius * n), 2);
      cav = new Float32Array(c);
      let maxd = 1e-6;
      for (let i = 0; i < c; i++) { const d = blurred[i] - h[i]; cav[i] = d; if (d > maxd) maxd = d; }
      const inv = 1 / maxd;
      for (let i = 0; i < c; i++) cav[i] = clamp(1 - Math.max(0, cav[i] * inv) * this.cavity);
    }

    // Height range for normalisation of alpha.
    let hmin = Infinity, hmax = -Infinity;
    for (let i = 0; i < c; i++) { const v = h[i]; if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
    const hr = hmax - hmin > 1e-6 ? 1 / (hmax - hmin) : 0;

    const s = this.normalStrength * n / 256;
    for (let y = 0; y < n; y++) {
      const ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n, yc = y * n;
      for (let x = 0; x < n; x++) {
        const i = yc + x;
        const xm = (x - 1 + n) % n, xp = (x + 1) % n;
        // Sobel
        const tl = h[yp + xm], t = h[yp + x], tr = h[yp + xp];
        const l = h[yc + xm], r = h[yc + xp];
        const bl = h[ym + xm], bo = h[ym + x], br = h[ym + xp];
        const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        const dy = (tl + 2 * t + tr) - (bl + 2 * bo + br);
        let nx = -dx * s, ny = -dy * s, nz = 1;
        const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= il; ny *= il;
        const o = i * 4;
        const k = i * 3;
        A[o] = toByte(this.col[k]);
        A[o + 1] = toByte(this.col[k + 1]);
        A[o + 2] = toByte(this.col[k + 2]);
        let alpha: number;
        if (this.alphaMode === 'metal') alpha = this.metal[i];
        else if (this.alphaMode === 'opacity') alpha = this.opacity ? this.opacity[i] : 1;
        else alpha = (h[i] - hmin) * hr;
        A[o + 3] = toByte(alpha);
        B[o] = toByte(nx * 0.5 + 0.5);
        B[o + 1] = toByte(ny * 0.5 + 0.5);
        B[o + 2] = toByte(this.rough[i]);
        B[o + 3] = toByte(this.ao[i] * (cav ? cav[i] : 1));
      }
    }
    return { size: n, a: A, b: B, alphaMode: this.alphaMode };
  }
}

const toByte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/** Parse a #rrggbb colour into sRGB floats. */
export function hex(c: string): number[] {
  const v = parseInt(c.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function mix3(a: readonly number[], b: readonly number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function jitterColor(c: readonly number[], amount: number, r1: number, r2: number, r3: number): [number, number, number] {
  return [
    clamp(c[0] * (1 + (r1 - 0.5) * amount)),
    clamp(c[1] * (1 + (r2 - 0.5) * amount)),
    clamp(c[2] * (1 + (r3 - 0.5) * amount)),
  ];
}
