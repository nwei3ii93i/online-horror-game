import { Noise } from '../materials/texgen/noise';
import {
  PADS, PATHS, CLEARINGS, HOLES, WORLD_HALF, rectDist, smoothPolyline, PathDef, SurfaceLayer, inRect, Rect,
} from './Layout';

export const TERRAIN_RES = 1;            // metres per height sample
export const TERRAIN_N = WORLD_HALF * 2 / TERRAIN_RES + 1; // vertices per side
export const SPLAT_N = 1024;
export const SPLAT_LAYERS = ['forest', 'meadow', 'mud', 'gravel', 'asphalt', 'rock', 'moss'] as const;
export type SplatLayer = typeof SPLAT_LAYERS[number];

export interface TerrainArrays {
  heights: Float32Array; open: Float32Array; pathDist: Float32Array; pathClear: Float32Array; splat0: Uint8Array; splat1: Uint8Array;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU-side terrain model: height field, surface splat weights and an "openness"
 * field (0 = deep forest, 1 = maintained ground) that drives vegetation placement.
 * Deterministic from the seed, so every client builds an identical world.
 */
export class TerrainData {
  readonly n = TERRAIN_N;
  readonly heights = new Float32Array(TERRAIN_N * TERRAIN_N);
  /** Openness at height-grid resolution. */
  readonly open = new Float32Array(TERRAIN_N * TERRAIN_N);
  /** Distance to nearest path centre (clamped, metres) at grid resolution. */
  readonly pathDist = new Float32Array(TERRAIN_N * TERRAIN_N).fill(99);
  readonly pathClear = new Float32Array(TERRAIN_N * TERRAIN_N);
  splat0!: Uint8Array; // forest, meadow, mud, gravel
  splat1!: Uint8Array; // asphalt, rock, moss, (wet)
  private noise: Noise;

  constructor(readonly seed = 1987, pre?: TerrainArrays) {
    this.noise = new Noise(seed);
    if (pre) {
      this.heights.set(pre.heights); this.open.set(pre.open); this.pathDist.set(pre.pathDist); this.pathClear.set(pre.pathClear);
      this.splat0 = pre.splat0; this.splat1 = pre.splat1;
      return;
    }
    this.generateHeights();
    this.applyPads();
    this.applyPaths();
    this.computeOpenness();
    this.generateSplat();
  }

  toArrays(): TerrainArrays {
    return { heights: this.heights, open: this.open, pathDist: this.pathDist, pathClear: this.pathClear, splat0: this.splat0, splat1: this.splat1 };
  }

  /** Generate in a worker (keeps the main thread responsive during loading). */
  static async generateAsync(seed = 1987): Promise<TerrainData> {
    try {
      const w = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      const arrays = await new Promise<TerrainArrays>((resolve, reject) => {
        w.onmessage = (e) => resolve(e.data as TerrainArrays);
        w.onerror = (e) => reject(e);
        w.postMessage({ seed });
      });
      w.terminate();
      return new TerrainData(seed, arrays);
    } catch (e) {
      console.warn('terrain worker failed, generating on main thread', e);
      return new TerrainData(seed);
    }
  }

  // ---------------------------------------------------------------- heights
  private baseHeight(x: number, z: number): number {
    const nz = this.noise;
    const P = 4096;
    const f = (s: number, ox = 0, oz = 0) => nz.perlin(x / s + ox + 500, z / s + oz + 500, P, P);
    let h = f(240) * 11 + f(110, 3.1, 7.7) * 5 + f(46, 1.3, 2.2) * 1.8 + f(17, 9.1, 4.4) * 0.45 + f(6, 2, 2) * 0.12;
    // valley falls away to the south (road climbs from there)
    h -= Math.max(0, z - 40) * 0.045;
    // forested ridge to the north
    h += smooth(-40, -260, z) * 9;
    // cemetery knoll north-east of the manor
    const dc = Math.hypot(x - 51, z - 105 * -1);
    h += Math.exp(-(dc * dc) / (2 * 26 * 26)) * 6;
    // stream ravine east
    const ds = Math.abs(x - 112 - Math.sin(z / 40) * 14);
    h -= Math.exp(-(ds * ds) / (2 * 7 * 7)) * 3.2;
    // estate plateau: soften terrain near the core
    const dCore = Math.hypot(x / 1.4, (z + 20) / 1.1);
    const core = Math.exp(-(dCore * dCore) / (2 * 60 * 60));
    h = h * (1 - core * 0.85);
    return h;
  }

  private generateHeights(): void {
    const n = this.n;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * TERRAIN_RES;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * TERRAIN_RES;
        this.heights[j * n + i] = this.baseHeight(x, z);
      }
    }
  }

  private applyPads(): void {
    const n = this.n;
    for (const p of PADS) {
      const m = p.blend;
      const i0 = Math.max(0, this.toI(p.x0 - m)), i1 = Math.min(n - 1, this.toI(p.x1 + m) + 1);
      const j0 = Math.max(0, this.toI(p.z0 - m)), j1 = Math.min(n - 1, this.toI(p.z1 + m) + 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = this.toX(i), z = this.toX(j);
          const d = rectDist(p, x, z);
          const wob = this.noise.perlin(x * 0.15 + 3, z * 0.15 + 7, 4096, 4096) * m * 0.25;
          const w = 1 - smooth(0, m, d + wob);
          if (w <= 0) continue;
          const k = j * n + i;
          this.heights[k] += (p.y - this.heights[k]) * w;
        }
      }
    }
  }

  private applyPaths(): void {
    const n = this.n;
    for (const path of PATHS) {
      const pts = smoothPolyline(path.points, 8);
      // longitudinal profile: terrain height at samples, low-pass filtered along the path
      const prof = pts.map(([x, z]) => this.heightAt(x, z));
      const smoothR = path.id === 'road' ? 6 : 3;
      const profS = prof.map((_, k) => {
        let s = 0, c = 0;
        for (let q = -smoothR; q <= smoothR; q++) {
          const v = prof[Math.max(0, Math.min(prof.length - 1, k + q))];
          s += v; c++;
        }
        return s / c;
      });
      const half = path.width / 2;
      const reach = half + path.soft + 4;
      // per-vertex best distance & profile for this path
      const best = new Map<number, { d: number; h: number }>();
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
        const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
        const i0 = Math.max(0, this.toI(Math.min(ax, bx) - reach)), i1 = Math.min(n - 1, this.toI(Math.max(ax, bx) + reach) + 1);
        const j0 = Math.max(0, this.toI(Math.min(az, bz) - reach)), j1 = Math.min(n - 1, this.toI(Math.max(az, bz) + reach) + 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = this.toX(i), z = this.toX(j);
          let t = ((x - ax) * vx + (z - az) * vz) / len2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          if (d > reach) continue;
          const k = j * n + i;
          const cur = best.get(k);
          if (!cur || d < cur.d) best.set(k, { d, h: profS[s] + (profS[s + 1] - profS[s]) * t });
        }
      }
      for (const [k, { d, h }] of best) {
        const w = (1 - smooth(half, half + path.soft + 3, d)) * path.flatten;
        // slight camber: road crown and drainage ditch at the edges
        let target = h;
        if (path.id === 'road') target += 0.06 * (1 - Math.min(1, d / half)) - 0.18 * smooth(half, half + 1.2, d) * (1 - smooth(half + 1.2, half + 2.5, d));
        this.heights[k] += (target - this.heights[k]) * w;
        if (d < this.pathDist[k]) this.pathDist[k] = d;
        const clr = 1 - smooth(path.clearance * 0.6, path.clearance + 1.5, d);
        if (clr > this.pathClear[k]) this.pathClear[k] = clr;
      }
      (path as PathDef & { _pts?: [number, number][] })._pts = pts;
    }
  }

  // ---------------------------------------------------------------- openness
  private computeOpenness(): void {
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.toX(i), z = this.toX(j);
      let o = 0;
      for (const p of PADS) {
        const d = rectDist(p, x, z);
        o = Math.max(o, 1 - smooth(2, 16, d));
      }
      for (const c of CLEARINGS) {
        const d = Math.hypot(x - c.x, z - c.z) - c.r;
        o = Math.max(o, 1 - smooth(-4, 8, d));
      }
      const k = j * n + i;
      o = Math.max(o, this.pathClear[k] * 0.9);
      // ragged forest edge
      const edge = this.noise.perlin(x * 0.07 + 11, z * 0.07 + 3, 4096, 4096) * 0.35;
      this.open[k] = Math.max(0, Math.min(1, o + edge * o * (1 - o) * 4));
    }
  }

  // ---------------------------------------------------------------- splat
  private surfaceWeights(x: number, z: number, out: Float32Array): void {
    out.fill(0);
    const nz = this.noise;
    const P = 4096;
    const h = this.heightAt(x, z);
    const slope = this.slopeAt(x, z);
    const open = this.sample(this.open, x, z);
    const n1 = nz.perlin(x * 0.08 + 1, z * 0.08 + 9, P, P);
    const n2 = nz.perlin(x * 0.3 + 5, z * 0.3 + 2, P, P);
    // base: forest floor vs overgrown meadow
    const meadow = smooth(0.25, 0.75, open + n1 * 0.25);
    out[0] = 1 - meadow;
    out[1] = meadow;
    // moss patches in the forest, mud in hollows
    out[6] = (1 - meadow) * smooth(0.15, 0.55, n1 * 0.6 + n2 * 0.5);
    const hollow = smooth(0.2, 0.6, -nz.perlin(x * 0.04 + 7, z * 0.04 + 1, P, P));
    out[2] = hollow * 0.6 * (0.5 + 0.5 * meadow);
    // steep → rock
    out[5] = smooth(0.55, 0.95, slope + n2 * 0.15);
    // pads
    for (const p of PADS) {
      if (!p.surface) continue;
      const d = rectDist(p, x, z) + n2 * 1.2 + n1 * 0.8;
      const w = 1 - smooth(-0.5, 2.5, d);
      if (w > 0) this.addLayer(out, p.surface, w);
    }
    // paths
    for (const path of PATHS) {
      const pts = (path as PathDef & { _pts?: [number, number][] })._pts!;
      // quick reject
      const k = this.idx(x, z);
      if (this.pathDist[k] > path.width + 4) continue;
      let d = Infinity;
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
        const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.min(d, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
      }
      const half = path.width / 2;
      const edgeN = n2 * path.soft * 0.9 + n1 * 0.4;
      const w = 1 - smooth(half - path.soft * 0.4, half + path.soft * 0.6, d + edgeN);
      if (w > 0) {
        if (path.surface === 'asphalt') {
          // broken asphalt: gravel and moss eat in from the edges, grass strip in the middle where traffic stopped
          const broken = smooth(0.1, 0.6, n2 * 0.7 + 0.25 + smooth(half * 0.5, half, d) * 0.6);
          this.addLayer(out, 'asphalt', w * (1 - broken));
          this.addLayer(out, 'gravel', w * broken * 0.8);
          this.addLayer(out, 'mud', w * broken * 0.3);
          const shoulder = smooth(half - 0.6, half + 0.4, d) * (1 - smooth(half + 0.4, half + 2.2, d));
          this.addLayer(out, 'mud', shoulder * 0.5);
        } else if (path.surface === 'leaves') {
          this.addLayer(out, 'mud', w * 0.45);
          this.addLayer(out, 'forest', w * 0.55);
        } else {
          this.addLayer(out, path.surface, w);
        }
      }
    }
    // vehicle ruts / mud at hard-standing edges
    for (const c of CLEARINGS) {
      const d = Math.hypot(x - c.x, z - c.z) - c.r;
      const w = 1 - smooth(-6, 4, d + n1 * 4);
      if (w > 0) this.addLayer(out, c.surface, w * 0.8);
    }
    void h;
  }

  private addLayer(out: Float32Array, s: SurfaceLayer, w: number): void {
    const map: Record<SurfaceLayer, number> = { forest: 0, meadow: 1, mud: 2, gravel: 3, asphalt: 4, rock: 5, moss: 6, leaves: 0 };
    const li = map[s];
    // layer w "paints over" everything else
    for (let i = 0; i < 7; i++) out[i] *= 1 - w;
    out[li] += w;
  }

  private generateSplat(): void {
    const N = SPLAT_N;
    this.splat0 = new Uint8Array(N * N * 4);
    this.splat1 = new Uint8Array(N * N * 4);
    const w = new Float32Array(7);
    const span = WORLD_HALF * 2;
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + (j + 0.5) / N * span;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + (i + 0.5) / N * span;
        this.surfaceWeights(x, z, w);
        let s = 0;
        for (let k = 0; k < 7; k++) s += w[k];
        s = s > 0 ? 255 / s : 0;
        const o = (j * N + i) * 4;
        this.splat0[o] = w[0] * s; this.splat0[o + 1] = w[1] * s; this.splat0[o + 2] = w[2] * s; this.splat0[o + 3] = w[3] * s;
        this.splat1[o] = w[4] * s; this.splat1[o + 1] = w[5] * s; this.splat1[o + 2] = w[6] * s; this.splat1[o + 3] = 0;
      }
    }
  }

  // ---------------------------------------------------------------- queries
  toI(x: number): number { return Math.floor((x + WORLD_HALF) / TERRAIN_RES); }
  toX(i: number): number { return -WORLD_HALF + i * TERRAIN_RES; }
  idx(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.n - 1, Math.round((x + WORLD_HALF) / TERRAIN_RES)));
    const j = Math.max(0, Math.min(this.n - 1, Math.round((z + WORLD_HALF) / TERRAIN_RES)));
    return j * this.n + i;
  }

  sample(field: Float32Array, x: number, z: number): number {
    const fx = (x + WORLD_HALF) / TERRAIN_RES, fz = (z + WORLD_HALF) / TERRAIN_RES;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.n - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const n = this.n;
    const a = field[j * n + i], b = field[j * n + i + 1], c = field[(j + 1) * n + i], d = field[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** Height consistent with the rendered triangulation (diagonal split). */
  heightAt(x: number, z: number): number {
    const fx = (x + WORLD_HALF) / TERRAIN_RES, fz = (z + WORLD_HALF) / TERRAIN_RES;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.n - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const n = this.n, H = this.heights;
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = TERRAIN_RES;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l; out.y = 2 * e / l; out.z = -hz / l;
  }

  slopeAt(x: number, z: number): number {
    const e = TERRAIN_RES;
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(hx, hz);
  }

  openAt(x: number, z: number): number { return this.sample(this.open, x, z); }
  pathDistAt(x: number, z: number): number { return this.pathDist[this.idx(x, z)]; }
  pathClearAt(x: number, z: number): number { return this.sample(this.pathClear, x, z); }

  isHole(x: number, z: number): boolean {
    for (const h of HOLES) if (inRect(h, x, z)) return true;
    return false;
  }

  holeRects(): Rect[] { return HOLES; }

  /** Splat weights (0..1) for a position – used by footsteps and decals. */
  surfaceAt(x: number, z: number): SplatLayer {
    const N = SPLAT_N, span = WORLD_HALF * 2;
    const i = Math.max(0, Math.min(N - 1, Math.floor((x + WORLD_HALF) / span * N)));
    const j = Math.max(0, Math.min(N - 1, Math.floor((z + WORLD_HALF) / span * N)));
    const o = (j * N + i) * 4;
    const w = [this.splat0[o], this.splat0[o + 1], this.splat0[o + 2], this.splat0[o + 3], this.splat1[o], this.splat1[o + 1], this.splat1[o + 2]];
    let bi = 0;
    for (let k = 1; k < 7; k++) if (w[k] > w[bi]) bi = k;
    return SPLAT_LAYERS[bi];
  }
}
