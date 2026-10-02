/**
 * Acoustic environment presets and procedural impulse responses for the global reverb.
 * IRs are stereo (decorrelated per channel): discrete early reflections, a diffuse tail with
 * frequency-dependent decay (time-varying lowpass), optional flutter echo (tunnels), room
 * boom and distant discrete echoes (outdoors). They are energy-normalised; `wet` sets level.
 */
import { type Buf, Rng, addPulse, biquad, buf, clamp, hashSeed, lp1, svf, LP } from './dsp';

export type EnvironmentId =
  | 'outdoor'
  | 'forest'
  | 'room_small'
  | 'room_large'
  | 'hall'
  | 'basement'
  | 'tunnel'
  | 'barn'
  | 'attic';

export const ENVIRONMENTS: readonly EnvironmentId[] = [
  'outdoor', 'forest', 'room_small', 'room_large', 'hall', 'basement', 'tunnel', 'barn', 'attic',
];

export interface EnvPreset {
  /** Mid-band decay time (s). */
  rt60: number;
  /** Delay before the diffuse tail (s). */
  pre: number;
  /** Discrete early reflections: count, first arrival (s), spread (s), energy relative to tail. */
  early: { count: number; first: number; spread: number; energy: number };
  /** Diffuse build-up time (s) – longer = more scattered (forest). */
  build: number;
  /** Tail brightness at onset / end (Hz). */
  hfStart: number;
  hfEnd: number;
  lowCut: number;
  /** Return level of the convolver for this environment. */
  wet: number;
  flutter?: { period: number; count: number; gain: number };
  boom?: { f: number; q: number; db: number };
  echo?: ReadonlyArray<{ t: number; g: number }>;
}

export const ENV_PRESETS: Record<EnvironmentId, EnvPreset> = {
  outdoor: {
    rt60: 0.9, pre: 0.03, early: { count: 3, first: 0.006, spread: 0.05, energy: 0.25 }, build: 0.08,
    hfStart: 5000, hfEnd: 1500, lowCut: 120, wet: 0.14, echo: [{ t: 0.36, g: 0.5 }, { t: 0.64, g: 0.3 }],
  },
  forest: {
    rt60: 1.5, pre: 0.012, early: { count: 16, first: 0.008, spread: 0.09, energy: 0.35 }, build: 0.12,
    hfStart: 4500, hfEnd: 1100, lowCut: 100, wet: 0.28,
  },
  room_small: {
    rt60: 0.42, pre: 0.004, early: { count: 10, first: 0.002, spread: 0.018, energy: 0.6 }, build: 0.01,
    hfStart: 7000, hfEnd: 2500, lowCut: 120, wet: 0.22, boom: { f: 220, q: 1.2, db: 3 },
  },
  room_large: {
    rt60: 0.85, pre: 0.008, early: { count: 12, first: 0.005, spread: 0.03, energy: 0.5 }, build: 0.02,
    hfStart: 7000, hfEnd: 2200, lowCut: 100, wet: 0.26,
  },
  hall: {
    rt60: 1.8, pre: 0.018, early: { count: 14, first: 0.008, spread: 0.06, energy: 0.4 }, build: 0.04,
    hfStart: 8000, hfEnd: 2000, lowCut: 80, wet: 0.32,
  },
  basement: {
    rt60: 1.3, pre: 0.006, early: { count: 12, first: 0.003, spread: 0.025, energy: 0.55 }, build: 0.015,
    hfStart: 5000, hfEnd: 900, lowCut: 70, wet: 0.38, boom: { f: 140, q: 1, db: 4 },
  },
  tunnel: {
    rt60: 2.8, pre: 0.01, early: { count: 6, first: 0.004, spread: 0.03, energy: 0.3 }, build: 0.03,
    hfStart: 5000, hfEnd: 700, lowCut: 60, wet: 0.46, flutter: { period: 0.0115, count: 34, gain: 0.86 },
    boom: { f: 110, q: 1.2, db: 4 },
  },
  barn: {
    rt60: 1.3, pre: 0.012, early: { count: 12, first: 0.006, spread: 0.04, energy: 0.45 }, build: 0.03,
    hfStart: 6000, hfEnd: 1500, lowCut: 90, wet: 0.3,
  },
  attic: {
    rt60: 0.5, pre: 0.003, early: { count: 9, first: 0.002, spread: 0.015, energy: 0.6 }, build: 0.01,
    hfStart: 5500, hfEnd: 1800, lowCut: 120, wet: 0.24, boom: { f: 280, q: 1.5, db: 3 },
  },
};

/** Map loose gameplay strings ("manor_hall", "cellar", "outside") to an environment. */
export function normalizeEnvironment(s: string | null | undefined): EnvironmentId {
  if (!s) return 'outdoor';
  const k = s.toLowerCase();
  if ((ENVIRONMENTS as readonly string[]).includes(k)) return k as EnvironmentId;
  if (k.includes('tunnel') || k.includes('passage')) return 'tunnel';
  if (k.includes('basement') || k.includes('cellar') || k.includes('crypt') || k.includes('vault')) return 'basement';
  if (k.includes('attic') || k.includes('loft')) return 'attic';
  if (k.includes('barn') || k.includes('workshop') || k.includes('shed') || k.includes('stable')) return 'barn';
  if (k.includes('hall') || k.includes('chapel') || k.includes('church') || k.includes('stair')) return 'hall';
  if (k.includes('forest') || k.includes('wood') || k.includes('tree')) return 'forest';
  if (k.includes('large') || k.includes('greenhouse') || k.includes('living') || k.includes('dining')) return 'room_large';
  if (k.includes('room') || k.includes('house') || k.includes('indoor') || k.includes('interior') || k.includes('kitchen') || k.includes('bath')) return 'room_small';
  return 'outdoor';
}

/** Render a stereo impulse response for a preset. */
export function generateIR(fs: number, p: EnvPreset, seed = 1): [Buf, Buf] {
  const len = Math.min(5, p.pre + p.rt60 * 1.25 + 0.06 + (p.echo ? 0.8 : 0));
  const n = Math.round(len * fs);
  const out: Buf[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(hashSeed('ir', seed * 7 + ch));
    const tail = buf(n);
    const k = -6.9078 / (p.rt60 * fs);
    const pre = Math.round(p.pre * fs);
    const build = Math.max(1, p.build * fs);
    for (let i = pre; i < n; i++) {
      const j = i - pre;
      const bu = j < build ? j / build : 1;
      tail[i] = rng.bi() * Math.exp(k * j) * bu;
    }
    // frequency-dependent decay: the tail darkens as it decays
    const fc = buf(n);
    const ratio = p.hfEnd / p.hfStart;
    for (let i = 0; i < n; i++) fc[i] = p.hfStart * Math.pow(ratio, clamp((i - pre) / (p.rt60 * fs), 0, 1));
    svf(tail, fc, 0.6, fs, LP);
    let eTail = 0;
    for (let i = 0; i < n; i++) eTail += tail[i] * tail[i];

    // discrete early reflections (soft pulses so they are not clicky)
    const early = buf(n);
    const times: number[] = [];
    for (let r = 0; r < p.early.count; r++) times.push(p.early.first + Math.pow(rng.next(), 1.4) * p.early.spread);
    times.sort((a, b) => a - b);
    const eEach = (eTail * p.early.energy) / Math.max(1, p.early.count);
    for (let r = 0; r < times.length; r++) {
      const decay = Math.exp((-3 * r) / Math.max(1, times.length));
      const a = Math.sqrt(eEach) * decay * rng.range(0.6, 1.2) * rng.sign();
      addPulse(early, times[r] * fs, rng.range(0.12, 0.35), a * 3, fs);
    }
    lp1(early, p.hfStart * 1.2, fs);

    // flutter echo between parallel walls (tunnel)
    if (p.flutter) {
      let a = Math.sqrt(eTail * 0.02);
      for (let r = 1; r <= p.flutter.count; r++) {
        const t = r * p.flutter.period * (1 + 0.01 * rng.bi());
        addPulse(early, t * fs, 0.3 + r * 0.03, a * rng.sign() * 3, fs);
        a *= p.flutter.gain;
      }
    }
    // distant discrete echoes (tree line, buildings)
    if (p.echo) {
      for (const e of p.echo) {
        const t = e.t * (1 + 0.05 * rng.bi());
        const burst = buf(0.03 * fs);
        for (let i = 0; i < burst.length; i++) burst[i] = rng.bi() * Math.exp((-6 * i) / burst.length);
        lp1(burst, 1500, fs);
        lp1(burst, 1800, fs);
        let eb = 0;
        for (let i = 0; i < burst.length; i++) eb += burst[i] * burst[i];
        const g = Math.sqrt((eTail * e.g) / Math.max(1e-9, eb));
        const o = Math.round(t * fs);
        for (let i = 0; i < burst.length && o + i < n; i++) early[o + i] += burst[i] * g;
      }
    }
    for (let i = 0; i < n; i++) tail[i] += early[i];
    biquad(tail, 'hp', p.lowCut, 0.7, fs);
    if (p.boom) biquad(tail, 'peak', p.boom.f, p.boom.q, fs, p.boom.db);
    // tiny fade at the end
    const fo = Math.round(0.03 * fs);
    for (let i = 0; i < fo; i++) tail[n - 1 - i] *= i / fo;
    out.push(tail);
  }
  // energy-normalise (unit energy per channel on average)
  let e = 0;
  for (const c of out) for (let i = 0; i < c.length; i++) e += c[i] * c[i];
  const g = 1 / Math.sqrt(Math.max(1e-12, e / 2));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= g;
  return [out[0], out[1]];
}
