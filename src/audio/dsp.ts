/**
 * Small offline DSP toolkit used by the procedural sound bank.
 *
 * Everything here is a pure function over Float32Arrays (no Web Audio dependency), so the
 * bank can be rendered on the main thread in small chunks or inside a worker. The building
 * blocks are deliberately physical: contact pulses exciting modal resonator banks (wood,
 * metal, glass), stick–slip friction pulse trains (creaks, squeals), Minnaert bubbles
 * (water), granular clouds (gravel, leaves, rain) and coloured noise through modulated
 * state-variable filters (wind, air, breath).
 */

export type Buf = Float32Array<ArrayBuffer>;
export const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------- random

export class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0 || 0x9e3779b9;
  }
  /** [0,1) */
  next(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** [-1,1) */
  bi(): number {
    return this.next() * 2 - 1;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Log-uniform in [a,b] (good for frequencies). */
  logRange(a: number, b: number): number {
    return a * Math.pow(b / a, this.next());
  }
  int(a: number, bInclusive: number): number {
    return Math.floor(this.range(a, bInclusive + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** x · (1 ± amt) */
  vary(x: number, amt: number): number {
    return x * (1 + amt * this.bi());
  }
  /** Approximately normal (Irwin–Hall n=4). */
  gauss(mean = 0, std = 1): number {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + s * std * 1.7320508;
  }
  fork(salt: number): Rng {
    return new Rng((Math.floor(this.next() * 4294967296) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}

export function hashSeed(s: string, salt = 0): number {
  let h = (2166136261 ^ Math.imul(salt + 0x51ed27, 0x27d4eb2d)) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

// ------------------------------------------------------------------------------- buffers

export function buf(n: number): Buf {
  return new Float32Array(Math.max(1, Math.round(n)));
}

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** dst[at..] += src·g. With wrap, writes past the end continue at the start (seamless loops). */
export function addAt(dst: Buf, src: Buf, at: number, g = 1, wrap = false): void {
  const n = dst.length;
  let o = Math.round(at);
  if (wrap) {
    o = ((o % n) + n) % n;
    for (let i = 0; i < src.length; i++) {
      let k = o + i;
      if (k >= n) k %= n;
      dst[k] += src[i] * g;
    }
    return;
  }
  const i0 = Math.max(0, -o);
  const i1 = Math.min(src.length, n - o);
  for (let i = i0; i < i1; i++) dst[o + i] += src[i] * g;
}

/** a += b·g (same length or b shorter). */
export function mixInto(a: Buf, b: Buf, g = 1): Buf {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] += b[i] * g;
  return a;
}

export function mulInto(a: Buf, e: Buf): Buf {
  const n = Math.min(a.length, e.length);
  for (let i = 0; i < n; i++) a[i] *= e[i];
  for (let i = n; i < a.length; i++) a[i] = 0;
  return a;
}

export function scale(a: Buf, g: number): Buf {
  for (let i = 0; i < a.length; i++) a[i] *= g;
  return a;
}

export function peak(a: Buf): number {
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > p) p = v;
  }
  return p;
}

export function rms(a: Buf): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

export function normalizePeak(a: Buf, target: number): Buf {
  const p = peak(a);
  if (p > 1e-9) scale(a, target / p);
  return a;
}

/** Short fades on both ends (one-shots) so nothing clicks when started/stopped. */
export function fadeEdges(a: Buf, fs: number, inMs = 0.5, outMs = 8): Buf {
  const ni = Math.min(a.length, Math.round((inMs / 1000) * fs));
  const no = Math.min(a.length, Math.round((outMs / 1000) * fs));
  for (let i = 0; i < ni; i++) a[i] *= i / ni;
  for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

/** Remove trailing near-silence (keeps a short margin). */
export function trimTail(a: Buf, fs: number, thresh = 1e-4, marginMs = 20): Buf {
  const p = peak(a) * thresh;
  let end = a.length - 1;
  while (end > 0 && Math.abs(a[end]) <= p) end--;
  const n = Math.min(a.length, end + Math.round((marginMs / 1000) * fs));
  return n < a.length ? a.slice(0, Math.max(1, n)) : a;
}

/** Linear-interpolating resample by `ratio` (>1 = higher pitch, shorter). */
export function resample(a: Buf, ratio: number): Buf {
  const n = Math.max(1, Math.floor(a.length / ratio));
  const out = buf(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const k = Math.floor(x);
    const t = x - k;
    const s0 = a[k] ?? 0;
    const s1 = a[k + 1] ?? 0;
    out[i] = s0 + (s1 - s0) * t;
  }
  return out;
}

// ------------------------------------------------------------------------------- noise

/** Seed for the inline xorshift32 noise generators (fast, plenty random for audio). */
function noiseSeed(rng: Rng): number {
  return (Math.floor(rng.next() * 4294967295) | 1) >>> 0;
}

export function white(n: number, rng: Rng, amp = 1): Buf {
  const b = buf(n);
  let x = noiseSeed(rng);
  const k = amp / 2147483648;
  for (let i = 0; i < b.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b[i] = (x | 0) * k;
  }
  return b;
}

/** Pink noise (Paul Kellet's refined filter), roughly unit RMS·0.3. */
export function pink(n: number, rng: Rng, amp = 1): Buf {
  const b = buf(n);
  let x = noiseSeed(rng);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const s = 0.11 * amp;
  for (let i = 0; i < b.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const w = (x | 0) / 2147483648;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * s;
    b6 = w * 0.115926;
  }
  return b;
}

/** Brown (red) noise via leaky integrator. */
export function brown(n: number, rng: Rng, amp = 1): Buf {
  const b = buf(n);
  let x = noiseSeed(rng);
  let z = 0;
  const s = 3.5 * amp;
  for (let i = 0; i < b.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    z = (z + 0.02 * ((x | 0) / 2147483648)) / 1.02;
    b[i] = z * s;
  }
  return b;
}

// ------------------------------------------------------------------------------- filters

export function lp1(b: Buf, fc: number, fs: number): Buf {
  const a = Math.exp((-TAU * fc) / fs);
  const g = 1 - a;
  let z = 0;
  for (let i = 0; i < b.length; i++) {
    z += g * (b[i] - z);
    b[i] = z;
  }
  return b;
}

export function hp1(b: Buf, fc: number, fs: number): Buf {
  const a = Math.exp((-TAU * fc) / fs);
  const g = 1 - a;
  let z = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    z += g * (x - z);
    b[i] = x - z;
  }
  return b;
}

export type BqType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'ls' | 'hs';

/** RBJ cookbook biquad, in place (transposed direct form II). */
export function biquad(b: Buf, type: BqType, fc: number, q: number, fs: number, db = 0): Buf {
  const f = clamp(fc, 5, fs * 0.49);
  const w = (TAU * f) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  const A = Math.pow(10, db / 40);
  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lp':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'hp':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'bp':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case 'ls': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
      break;
    }
    case 'hs': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
      break;
    }
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let z1 = 0, z2 = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    b[i] = y;
  }
  return b;
}

/** Band-limit helper: 2nd-order HP then LP. */
export function band(b: Buf, lo: number, hi: number, fs: number, q = 0.707): Buf {
  if (lo > 0) biquad(b, 'hp', lo, q, fs);
  if (hi < fs * 0.49) biquad(b, 'lp', hi, q, fs);
  return b;
}

export type SvfMode = 0 | 1 | 2; // lp | bp (unity peak) | hp
export const LP: SvfMode = 0;
export const BP: SvfMode = 1;
export const HP: SvfMode = 2;

/**
 * Topology-preserving state-variable filter with (optionally) per-sample cutoff and Q.
 * Modulated coefficients are refreshed every 16 samples, plenty for slow modulation.
 */
export function svf(b: Buf, fc: number | Buf, q: number | Buf, fs: number, mode: SvfMode): Buf {
  const n = b.length;
  const nyq = fs * 0.48;
  const fcA = typeof fc === 'number' ? null : fc;
  const qA = typeof q === 'number' ? null : q;
  const fcN = typeof fc === 'number' ? fc : 0;
  const qN = typeof q === 'number' ? q : 0;
  const block = fcA || qA ? 16 : n;
  let ic1 = 0, ic2 = 0;
  for (let i0 = 0; i0 < n; i0 += block) {
    const f = clamp(fcA ? fcA[i0] : fcN, 5, nyq);
    const k = 1 / Math.max(0.05, qA ? qA[i0] : qN);
    const g = Math.tan((Math.PI * f) / fs);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const i1 = Math.min(n, i0 + block);
    if (mode === 0) {
      for (let i = i0; i < i1; i++) {
        const v3 = b[i] - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        b[i] = v2;
      }
    } else if (mode === 1) {
      for (let i = i0; i < i1; i++) {
        const v3 = b[i] - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        b[i] = v1 * k;
      }
    } else {
      for (let i = i0; i < i1; i++) {
        const x = b[i];
        const v3 = x - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        b[i] = x - k * v1 - v2;
      }
    }
  }
  return b;
}

/** Run an in-place filter chain over a loop so the result is exactly periodic (seamless). */
export function circular(b: Buf, fx: (x: Buf) => void): Buf {
  const n = b.length;
  const d = buf(n * 2);
  d.set(b, 0);
  d.set(b, n);
  fx(d);
  b.set(d.subarray(n));
  return b;
}

// ------------------------------------------------------------------------------- envelopes & control

/** Piecewise-linear envelope from [time(s), value] points. */
export function envelope(n: number, fs: number, pts: ReadonlyArray<readonly [number, number]>): Buf {
  return segments(n, fs, pts, false);
}

/** Smooth (smoothstep-interpolated) curve through [time(s), value] points. */
export function curve(n: number, fs: number, pts: ReadonlyArray<readonly [number, number]>): Buf {
  return segments(n, fs, pts, true);
}

function segments(n: number, fs: number, pts: ReadonlyArray<readonly [number, number]>, smooth: boolean): Buf {
  const e = buf(n);
  const N = e.length;
  if (!pts.length) return e;
  let i = Math.min(N, Math.max(0, Math.ceil(pts[0][0] * fs)));
  e.fill(pts[0][1], 0, i);
  for (let k = 0; k < pts.length - 1 && i < N; k++) {
    const t0 = pts[k][0] * fs;
    const v0 = pts[k][1];
    const t1 = pts[k + 1][0] * fs;
    const dv = pts[k + 1][1] - v0;
    const iEnd = Math.min(N, Math.ceil(t1));
    const inv = t1 > t0 ? 1 / (t1 - t0) : 0;
    for (; i < iEnd; i++) {
      let u = inv ? (i - t0) * inv : 1;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      e[i] = v0 + dv * (smooth ? u * u * (3 - 2 * u) : u);
    }
  }
  if (i < N) e.fill(pts[pts.length - 1][1], i);
  return e;
}

/** Attack + exponential (t60) decay envelope. */
export function expEnv(n: number, fs: number, attack: number, t60: number, delay = 0): Buf {
  const e = buf(n);
  const na = Math.max(1, attack * fs);
  const d0 = Math.round(delay * fs);
  const k = -6.9078 / (Math.max(1e-4, t60) * fs);
  for (let i = d0; i < e.length; i++) {
    const j = i - d0;
    e[i] = j < na ? j / na : Math.exp(k * (j - na));
  }
  return e;
}

/**
 * Smooth random control signal in roughly [-1,1] (Catmull–Rom through random knots).
 * With `periodic`, the curve wraps seamlessly over the buffer length.
 */
export function smoothRandom(n: number, fs: number, rate: number, rng: Rng, periodic = false): Buf {
  const out = buf(n);
  const len = out.length;
  const K = Math.max(periodic ? 3 : 2, Math.round((len / fs) * rate));
  const knots = new Float32Array(K + 4);
  for (let i = 0; i < knots.length; i++) knots[i] = rng.bi();
  const kv = (k: number): number => (periodic ? knots[((k % K) + K) % K] : knots[clamp(k + 1, 0, knots.length - 1)]);
  const step = len / K;
  const inv = 1 / step;
  for (let k = 0; k < K; k++) {
    const p0 = kv(k - 1), p1 = kv(k), p2 = kv(k + 1), p3 = kv(k + 2);
    const c0 = p1;
    const c1 = 0.5 * (p2 - p0);
    const c2 = 0.5 * (2 * p0 - 5 * p1 + 4 * p2 - p3);
    const c3 = 0.5 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const i0 = Math.ceil(k * step);
    const i1 = Math.min(len, Math.ceil((k + 1) * step));
    for (let i = i0; i < i1; i++) {
      const t = i * inv - k;
      out[i] = ((c3 * t + c2) * t + c1) * t + c0;
    }
  }
  return out;
}

/** Map a [-1,1] control to [lo,hi] with an optional power curve (in place). */
export function mapCtl(c: Buf, lo: number, hi: number, pow = 1): Buf {
  for (let i = 0; i < c.length; i++) {
    const u = clamp((c[i] + 1) * 0.5, 0, 1);
    c[i] = lo + (hi - lo) * (pow === 1 ? u : Math.pow(u, pow));
  }
  return c;
}

/**
 * Turn a buffer rendered `xf` samples longer than the loop into a seamless loop by
 * equal-power crossfading its tail into its head.
 */
export function loopify(b: Buf, xf: number): Buf {
  const L = b.length - xf;
  const out = b.slice(0, L);
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    const wi = Math.sin(t * Math.PI * 0.5);
    const wo = Math.cos(t * Math.PI * 0.5);
    out[i] = b[i] * wi + b[L + i] * wo;
  }
  return out;
}

// ------------------------------------------------------------------------------- excitation & resonators

export interface Mode {
  f: number;
  t60: number;
  a: number;
}

/**
 * Bank of two-pole resonators ("modal synthesis"). An excitation of unit area produces
 * ringing of amplitude ≈ mode.a. Rendering of a mode stops once it has decayed after the
 * last non-zero excitation sample, so sparse impacts are cheap.
 */
export function modal(exc: Buf, modes: readonly Mode[], fs: number, out?: Buf): Buf {
  const o = out ?? buf(exc.length);
  const n = Math.min(exc.length, o.length);
  let last = n - 1;
  while (last > 0 && exc[last] === 0) last--;
  for (const m of modes) {
    if (!(m.f > 0) || m.f >= fs * 0.46 || m.a === 0) continue;
    const w = (TAU * m.f) / fs;
    const r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * fs));
    const c1 = 2 * r * Math.cos(w);
    const c2 = -r * r;
    const g = m.a * Math.sin(w);
    let y1 = 0, y2 = 0;
    const thr = 1e-6 * Math.abs(m.a);
    for (let i = 0; i < n; i++) {
      const y = g * exc[i] + c1 * y1 + c2 * y2;
      y2 = y1;
      y1 = y;
      o[i] += y;
      if (i > last && (i & 63) === 0 && Math.abs(y1) + Math.abs(y2) < thr) break;
    }
  }
  return o;
}

/** Build modes from a fundamental, ratio list, per-mode t60 & amplitude, with jitter. */
export function modes(
  f0: number,
  ratios: readonly number[],
  t60: readonly number[] | number,
  amps: readonly number[] | number,
  rng?: Rng,
  jitter = 0,
): Mode[] {
  return ratios.map((r, i) => ({
    f: f0 * r * (rng && jitter ? 1 + jitter * rng.bi() : 1),
    t60: typeof t60 === 'number' ? t60 : t60[Math.min(i, t60.length - 1)],
    a: (typeof amps === 'number' ? amps : amps[Math.min(i, amps.length - 1)]) * (rng && jitter ? 1 + 0.3 * rng.bi() : 1),
  }));
}

/** Add a half-sine contact pulse of unit area (soft → long contact → darker). */
export function addPulse(dst: Buf, at: number, contactMs: number, amp: number, fs: number): void {
  const P = Math.max(1, Math.round((contactMs / 1000) * fs));
  const o = Math.round(at);
  const norm = Math.PI / (2 * P);
  for (let k = 0; k < P; k++) {
    const i = o + k;
    if (i < 0 || i >= dst.length) continue;
    dst[i] += amp * norm * Math.sin((Math.PI * (k + 0.5)) / P);
  }
}

/** Add a decaying white-noise burst. */
export function addBurst(dst: Buf, at: number, ms: number, amp: number, rng: Rng, fs: number): void {
  const n = Math.max(1, Math.round((ms / 1000) * fs));
  const o = Math.round(at);
  for (let k = 0; k < n; k++) {
    const i = o + k;
    if (i < 0 || i >= dst.length) continue;
    const e = Math.exp((-5 * k) / n);
    dst[i] += amp * e * rng.bi();
  }
}

export interface HitSpec {
  /** Contact time of the striking object (ms). Short = hard/bright. */
  contactMs: number;
  modes: readonly Mode[];
  /** Broadband click layer amplitude + length (ms) + highpass (Hz). */
  click?: number;
  clickMs?: number;
  clickHp?: number;
  /** Low noise thump layer amplitude, lowpass (Hz), decay (ms). */
  thud?: number;
  thudHz?: number;
  thudMs?: number;
  /** Extra tail allowance (s). */
  tail?: number;
}

/**
 * Render a single impact into its own buffer. Each layer is peak-normalised before mixing so
 * that the amplitudes in the spec are directly comparable: modal ring = 1, click, thud.
 */
export function hit(fs: number, rng: Rng, s: HitSpec, amp = 1): Buf {
  let maxT = 0.02;
  for (const m of s.modes) maxT = Math.max(maxT, m.t60);
  const thudMs = s.thudMs ?? 30;
  maxT = Math.max(maxT, (thudMs / 1000) * 2.5) + (s.tail ?? 0);
  const n = Math.ceil((maxT * 1.05 + s.contactMs / 1000 + 0.004) * fs);
  const exc = buf(n);
  addPulse(exc, 0, s.contactMs, 1, fs);
  const out = s.modes.length ? normalizePeak(modal(exc, s.modes, fs), 1) : buf(n);
  if (s.click) {
    const c = buf(Math.round(((s.clickMs ?? 1) / 1000) * fs) + 8);
    addBurst(c, 0, s.clickMs ?? 1, 1, rng, fs);
    hp1(c, s.clickHp ?? 1500, fs);
    normalizePeak(c, 1);
    addAt(out, c, 0, s.click);
  }
  if (s.thud) {
    const tn = Math.round((thudMs / 1000) * fs * 2.5);
    const t = white(tn, rng);
    biquad(t, 'lp', s.thudHz ?? 150, 0.8, fs);
    biquad(t, 'lp', (s.thudHz ?? 150) * 1.3, 0.6, fs);
    const k = -6.9078 / ((thudMs / 1000) * fs);
    const att = 0.002 * fs;
    for (let i = 0; i < tn; i++) t[i] *= Math.exp(k * i) * Math.min(1, i / att);
    normalizePeak(t, 1);
    addAt(out, t, 0, s.thud);
  }
  if (amp !== 1) scale(out, amp);
  return out;
}

/** Normalise to a target RMS. */
export function normalizeRms(a: Buf, target: number): Buf {
  const r = rms(a);
  if (r > 1e-12) scale(a, target / r);
  return a;
}

/** Shaped noise layer: band-limited noise times an envelope. */
export function noiseLayer(n: number, fs: number, rng: Rng, lo: number, hi: number, env: Buf | null, amp = 1, q = 0.707): Buf {
  const b = white(n, rng, amp);
  band(b, lo, hi, fs, q);
  if (env) mulInto(b, env);
  return b;
}

/** Add a band-limited noise "scuff"/swish with a soft attack and decay. */
export function scuffInto(dst: Buf, fs: number, rng: Rng, t: number, dur: number, lo: number, hi: number, amp: number, attackFrac = 0.3): void {
  const n = Math.round(dur * fs);
  const e = envelope(n, fs, [[0, 0], [dur * attackFrac, 1], [dur, 0]]);
  for (let i = 0; i < n; i++) e[i] = e[i] * e[i];
  const s = noiseLayer(n, fs, rng, lo, hi, e, 1);
  normalizePeak(s, 1);
  addAt(dst, s, t * fs, amp);
}

// ------------------------------------------------------------------------------- granular

/**
 * Scatter `count` grains between t0 and t1 seconds. `shape(u)` (0..1) is the density over
 * the interval (rejection sampled). Amplitudes are heavy-tailed via ampPow (>1 = mostly small).
 */
export function scatter(
  dst: Buf,
  fs: number,
  rng: Rng,
  o: {
    t0: number;
    t1: number;
    count: number;
    grains: readonly Buf[];
    amp: number;
    ampPow?: number;
    shape?: (u: number) => number;
    wrap?: boolean;
  },
): void {
  const pw = o.ampPow ?? 1;
  for (let c = 0; c < o.count; c++) {
    let u = rng.next();
    if (o.shape) {
      for (let tries = 0; tries < 24; tries++) {
        if (rng.next() <= o.shape(u)) break;
        u = rng.next();
      }
    }
    const at = (o.t0 + u * (o.t1 - o.t0)) * fs;
    const g = o.amp * Math.pow(rng.next(), pw) * rng.sign();
    addAt(dst, rng.pick(o.grains), at, g, o.wrap);
  }
}

/** Times (s) of a Poisson process with time-varying rate (events/s), via thinning. */
export function poissonTimes(dur: number, rate: (t: number) => number, maxRate: number, rng: Rng): number[] {
  const out: number[] = [];
  if (maxRate <= 0) return out;
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.next()) / maxRate;
    if (t >= dur) break;
    if (rng.next() * maxRate <= rate(t)) out.push(t);
  }
  return out;
}

/** Make a pool of grains. */
export function pool(count: number, make: (i: number) => Buf): Buf[] {
  const out: Buf[] = [];
  for (let i = 0; i < count; i++) out.push(make(i));
  return out;
}

/** Tiny resonant tick: one or two decaying sinusoids with a sharp onset. */
export function tick(fs: number, rng: Rng, fLo: number, fHi: number, t60Lo: number, t60Hi: number, partials = 2): Buf {
  const t60 = rng.range(t60Lo, t60Hi);
  const n = Math.max(8, Math.round(t60 * fs));
  const out = buf(n);
  for (let p = 0; p < partials; p++) {
    const f = Math.min(fs * 0.45, rng.logRange(fLo, fHi));
    const a = p === 0 ? 1 : rng.range(0.3, 0.8);
    const ph = rng.next() * TAU;
    const w = (TAU * f) / fs;
    const k = -6.9078 / (t60 * fs * (p === 0 ? 1 : 0.7));
    for (let i = 0; i < n; i++) out[i] += a * Math.sin(ph + w * i) * Math.exp(k * i);
  }
  out[0] += rng.bi() * 0.6;
  if (n > 1) out[1] += rng.bi() * 0.3;
  const ai = Math.min(n, 3);
  for (let i = 0; i < ai; i++) out[i] *= (i + 1) / (ai + 1) + 0.25;
  return normalizePeak(out, 1);
}

/** Very short band-limited noise grain (crackle). */
export function crackle(fs: number, rng: Rng, msLo: number, msHi: number, lo: number, hi: number): Buf {
  const ms = rng.range(msLo, msHi);
  const n = Math.max(4, Math.round((ms / 1000) * fs) + 16);
  const g = buf(n);
  addBurst(g, 0, ms, 1, rng, fs);
  band(g, lo, hi, fs, 0.8);
  return normalizePeak(g, 1);
}

// ------------------------------------------------------------------------------- water

/**
 * Minnaert bubble (after van den Doel): a damped sinusoid whose pitch rises as the bubble
 * reaches the surface. `rise` is the fractional pitch increase per decay time constant
 * (≈0.1 for small bubbles in a stream, 0.2–0.5 for a drip "plink").
 */
export function bubble(fs: number, f0: number, opts: { tau?: number; rise?: number; amp?: number; maxDur?: number } = {}): Buf {
  const d = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
  const tau = opts.tau ?? 1 / d;
  const sigma = (opts.rise ?? 0.1) / tau;
  const n = Math.max(16, Math.round(Math.min(tau * 5, opts.maxDur ?? 0.25) * fs));
  const out = buf(n);
  const amp = opts.amp ?? 1;
  const fmax = Math.min(fs * 0.45, f0 * 4);
  let ph = 0;
  const att = Math.max(2, Math.round(0.0004 * fs));
  const k = -1 / (tau * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f = Math.min(fmax, f0 * (1 + sigma * t));
    ph += (TAU * f) / fs;
    out[i] = amp * Math.sin(ph) * Math.exp(k * i) * (i < att ? i / att : 1);
  }
  const fo = Math.min(n, Math.round(0.003 * fs));
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return out;
}

// ------------------------------------------------------------------------------- friction

export interface CreakSpec {
  /** Stick–slip pulse rate (Hz) per sample. ~5–40 crackly, 50–200 groan, 300+ squeal. */
  rate: Buf;
  /** Pressure / amplitude per sample. */
  amp: Buf;
  /** Period randomisation 0..0.6 (roughness). */
  jitter?: number;
  ampJitter?: number;
  /** Slip pulse width in ms (longer = softer). */
  pulseMs?: number;
  modes: readonly Mode[];
  /** Amount of raw, high-passed slip noise mixed in. */
  grit?: number;
  gritHz?: number;
}

/** Stick–slip friction: irregular slip pulses exciting body resonances (doors, boards, trees). */
export function creak(fs: number, rng: Rng, s: CreakSpec): Buf {
  const n = s.rate.length;
  const exc = buf(n);
  const jit = s.jitter ?? 0.15;
  const aj = s.ampJitter ?? 0.35;
  const pw = Math.max(1, Math.round(((s.pulseMs ?? 0.35) / 1000) * fs));
  let ph = rng.next();
  for (let i = 0; i < n; i++) {
    ph += s.rate[i] / fs;
    if (ph >= 1) {
      ph -= 1 + jit * rng.next();
      const a = s.amp[i] * Math.max(0, 1 + aj * rng.bi());
      if (a <= 0) continue;
      for (let k = 0; k < pw && i + k < n; k++) {
        const e = 1 - k / pw;
        exc[i + k] += a * (k === 0 ? 1 : 0.6 * rng.bi()) * e;
      }
    }
  }
  const out = modal(exc, s.modes, fs);
  if (s.grit) {
    hp1(exc, s.gritHz ?? 2500, fs);
    mixInto(out, exc, s.grit);
  }
  return out;
}

// ------------------------------------------------------------------------------- space

/**
 * Compact Freeverb-style mono reverb (8 damped combs + 4 allpasses). Returns the WET signal,
 * longer than the input by pre + tail seconds, with a unit-energy response (a steady input
 * gives roughly equal wet RMS). Used to bake distance/space into far sounds.
 */
export function reverb(input: Buf, fs: number, o: { rt60: number; damp: number; pre?: number; tail?: number; size?: number }): Buf {
  const pre = Math.round((o.pre ?? 0.01) * fs);
  const tail = o.tail ?? o.rt60;
  const n = input.length + pre + Math.round(tail * fs);
  const sc = (fs / 44100) * (o.size ?? 1);
  const combL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => Math.max(8, Math.round(l * sc)));
  const apL = [556, 441, 341, 225].map((l) => Math.max(4, Math.round(l * (fs / 44100))));
  const d1 = Math.exp((-TAU * o.damp) / fs);
  const d2 = 1 - d1;
  let gAvg = 0;
  for (const L of combL) gAvg += Math.pow(10, (-3 * L) / (o.rt60 * fs)) / combL.length;
  const inGain = Math.sqrt((1 - gAvg * gAvg) / combL.length);
  const x = buf(n);
  for (let i = 0; i < input.length; i++) x[i + pre] = input[i] * inGain;
  const sum = buf(n);
  for (const L of combL) {
    const g = Math.pow(10, (-3 * L) / (o.rt60 * fs));
    const cb = new Float32Array(L);
    let idx = 0;
    let f = 0;
    for (let t = 0; t < n; t++) {
      const y = cb[idx];
      f = y * d2 + f * d1;
      cb[idx] = x[t] + f * g;
      if (++idx >= L) idx = 0;
      sum[t] += y;
    }
  }
  for (const L of apL) {
    const ab = new Float32Array(L);
    let idx = 0;
    for (let t = 0; t < n; t++) {
      const bo = ab[idx];
      const v = sum[t];
      ab[idx] = v + bo * 0.5;
      if (++idx >= L) idx = 0;
      sum[t] = bo - v;
    }
  }
  return sum;
}

/** dry + wet reverb mix (returns a new, longer buffer). */
export function withReverb(dry: Buf, fs: number, wet: number, o: { rt60: number; damp: number; pre?: number; tail?: number; size?: number }): Buf {
  const w = reverb(dry, fs, o);
  if (wet !== 1) scale(w, wet);
  addAt(w, dry, 0, 1);
  return w;
}

/** Discrete echoes (valley / building facades), each progressively darker. */
export function echoes(dry: Buf, fs: number, taps: ReadonlyArray<{ t: number; g: number; lp: number }>): Buf {
  let maxT = 0;
  for (const tp of taps) maxT = Math.max(maxT, tp.t);
  const out = buf(dry.length + Math.round(maxT * fs) + 8);
  addAt(out, dry, 0, 1);
  for (const tp of taps) {
    const e = dry.slice();
    lp1(e, tp.lp, fs);
    lp1(e, tp.lp * 1.3, fs);
    addAt(out, e, tp.t * fs, tp.g);
  }
  return out;
}

/** Make sure no NaN/Infinity can reach the audio graph. Returns number of bad samples fixed. */
export function sanitize(a: Buf): number {
  let bad = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) {
      a[i] = 0;
      bad++;
    }
  }
  return bad;
}
