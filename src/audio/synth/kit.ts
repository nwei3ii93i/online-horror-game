/**
 * Shared higher-level building blocks for the recipes (thumps, scuffs, grit, clicks,
 * friction creaks, formant noise). All layers are peak-normalised before being mixed so the
 * amplitudes passed in are directly comparable.
 */
import {
  type Buf, type Mode, Rng, addAt, band, biquad, buf, crackle, creak, curve, envelope, hit, hp1, lp1,
  modes, normalizePeak, pool, scatter, smoothRandom, svf, white, BP, mulInto, mixInto, normalizeRms,
} from '../dsp';

export type Pts = ReadonlyArray<readonly [number, number]>;

/** Low "body-weight" thump: low-passed noise with a fast attack and exponential decay. */
export function thumpInto(dst: Buf, fs: number, rng: Rng, t: number, hz: number, ms: number, amp: number): void {
  const n = Math.round((ms / 1000) * fs * 3);
  const b = white(n, rng);
  biquad(b, 'lp', hz, 0.9, fs);
  biquad(b, 'lp', hz * 1.25, 0.7, fs);
  const k = -6.9078 / ((ms / 1000) * fs);
  const att = 0.003 * fs;
  for (let i = 0; i < n; i++) b[i] *= Math.exp(k * i) * Math.min(1, i / att);
  normalizePeak(b, 1);
  addAt(dst, b, t * fs, amp);
}

/** Sandy/gritty texture: a short burst of tiny crackles. */
export function gritInto(dst: Buf, fs: number, rng: Rng, t: number, dur: number, count: number, lo: number, hi: number, amp: number): void {
  const grains = pool(12, () => crackle(fs, rng, 0.06, 0.3, lo, hi));
  scatter(dst, fs, rng, {
    t0: t, t1: t + dur, count, grains, amp, ampPow: 2,
    shape: (u) => Math.sin(Math.PI * u),
  });
}

/** Noise swish with fine "flutter" (blades, fabric, paper), peak-normalised then scaled. */
export function swishInto(dst: Buf, fs: number, rng: Rng, t: number, dur: number, lo: number, hi: number, amp: number, attackFrac = 0.2, flutter = 0.4, flutterRate = 150): void {
  const n = Math.round(dur * fs);
  const s = white(n, rng);
  band(s, lo, hi, fs, 0.7);
  const e = envelope(n, fs, [[0, 0], [dur * attackFrac, 1], [dur, 0]]);
  const fl = smoothRandom(n, fs, flutterRate, rng);
  for (let i = 0; i < n; i++) s[i] *= e[i] * e[i] * (1 - flutter + flutter * Math.abs(fl[i]) * 1.4);
  normalizePeak(s, 1);
  addAt(dst, s, t * fs, amp);
}

/** Small metallic click (latch, bolt, spring). */
export function metalClickInto(dst: Buf, fs: number, rng: Rng, t: number, amp: number, fLo = 1900, fHi = 2800, t60 = 0.025): void {
  const m = modes(rng.range(fLo, fHi), [1, 1.48, 2.11, 2.93, 3.87], [t60, t60 * 0.85, t60 * 0.7, t60 * 0.55, t60 * 0.4], [1, 0.75, 0.55, 0.4, 0.25], rng, 0.06);
  addAt(dst, hit(fs, rng, { contactMs: rng.range(0.06, 0.14), modes: m, click: 0.45, clickMs: 0.35, clickHp: 2500 }), t * fs, amp);
}

/** Wooden door / panel modes. */
export function doorModes(rng: Rng, f0 = rng.range(70, 88), t60Scale = 1): Mode[] {
  return modes(f0, [1, 1.7, 2.8, 4.1, 6.2, 9.4, 13.5, 19.2],
    [0.28, 0.22, 0.17, 0.13, 0.1, 0.07, 0.05, 0.04].map((x) => x * t60Scale),
    [0.75, 0.9, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18], rng, 0.05);
}

/** Old wooden floorboard modes (with a hollow joist cavity). */
export function floorModes(rng: Rng, f0 = rng.range(88, 125)): Mode[] {
  return modes(f0, [1, 1.93, 2.71, 4.12, 5.6, 7.45, 9.9, 13.1, 17.3],
    [0.12, 0.11, 0.09, 0.075, 0.058, 0.045, 0.035, 0.025, 0.018],
    [0.55, 0.8, 0.75, 0.6, 0.45, 0.34, 0.24, 0.15, 0.09], rng, 0.06);
}

/** Friction creak through given modes, with natural pitch wobble and pressure flutter. */
export function creakLayer(fs: number, rng: Rng, o: {
  dur: number;
  rate: Pts;
  amp: Pts;
  jitter: number;
  modes: readonly Mode[];
  wobble?: number;
  wobbleRate?: number;
  flutter?: number;
  pulseMs?: number;
  grit?: number;
  gritHz?: number;
}): Buf {
  const n = Math.round(o.dur * fs);
  const rate = curve(n, fs, o.rate);
  const amp = curve(n, fs, o.amp);
  const wob = smoothRandom(n, fs, o.wobbleRate ?? 7, rng);
  const fl = smoothRandom(n, fs, 11, rng);
  const w = o.wobble ?? 0.06;
  const f = o.flutter ?? 0.3;
  for (let i = 0; i < n; i++) {
    rate[i] = Math.max(1, rate[i] * (1 + w * wob[i]));
    amp[i] = Math.max(0, amp[i] * (1 - f + f * (0.5 + 0.5 * fl[i])));
  }
  const c = creak(fs, rng, { rate, amp, jitter: o.jitter, modes: o.modes, pulseMs: o.pulseMs ?? 0.3, grit: o.grit ?? 0.06, gritHz: o.gritHz });
  return normalizePeak(c, 1);
}

/** Formant-filtered noise (breath, whisper-like air). formants: [freqCurve, q, gain]. */
export function formantNoise(fs: number, rng: Rng, n: number, formants: ReadonlyArray<readonly [Buf | number, number, number]>, hiss = 0, hissHz = 3500): Buf {
  const src = white(n, rng);
  const out = buf(n);
  for (const [fc, q, g] of formants) {
    const b = src.slice();
    svf(b, fc, q, fs, BP);
    svf(b, fc, q * 0.7, fs, BP);
    mixInto(out, b, g);
  }
  if (hiss) {
    const h = src.slice();
    hp1(h, hissHz, fs);
    hp1(h, hissHz, fs);
    normalizeRms(h, 1);
    const r = Math.sqrt(out.reduce((s, x) => s + x * x, 0) / n) || 1;
    mixInto(out, h, hiss * r);
  }
  return out;
}

/** Apply an envelope given as points (in place). */
export function shape(b: Buf, fs: number, pts: Pts, smooth = false): Buf {
  return mulInto(b, smooth ? curve(b.length, fs, pts) : envelope(b.length, fs, pts));
}

/** Two cascaded lowpasses for a steeper "through walls / far away" rolloff. */
export function muffle(b: Buf, fs: number, hz: number): Buf {
  biquad(b, 'lp', hz, 0.6, fs);
  lp1(b, hz * 1.4, fs);
  return b;
}

/** Simple bell (raised cosine) density shape for scatter(). */
export const bell = (u: number): number => Math.sin(Math.PI * u);
/** Fast attack, exponential decay density for scatter(). */
export const strike = (k = 4, a = 25) => (u: number): number => Math.exp(-u * k) * Math.min(1, u * a);
