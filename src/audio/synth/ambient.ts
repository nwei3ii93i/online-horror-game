/**
 * Ambient one-shots: nature (owl, crow, dog, thunder, trees, branches, leaves), structure
 * (house settling, floor creaks, metal roof sheets, shutters), water drips and body sounds
 * (heartbeat, breathing). Distant sounds have distance baked in (air absorption lowpass,
 * diffuse reverberation, discrete valley echoes) and are rendered at reduced sample rates.
 */
import {
  type Buf, type Mode, Rng, TAU, addAt, addBurst, addPulse, band, biquad, brown, bubble, buf, clamp, crackle,
  curve, echoes, envelope, hit, hp1, lp1, mapCtl, modal, modes, mulInto, mixInto, normalizePeak, normalizeRms,
  pink, poissonTimes, pool, scatter, scuffInto, smoothRandom, svf, tick, trimTail, white, withReverb, BP, LP,
} from '../dsp';
import { bell, creakLayer, formantNoise, muffle, strike, swishInto, thumpInto, type Pts } from './kit';

const u01 = (x: number): number => clamp((x + 1) * 0.5, 0, 1);

/** Band-limited harmonic oscillator following a frequency curve. */
function harmonicOsc(fs: number, f: Buf, harm: readonly number[], jitter?: Buf, phase0 = 0): Buf {
  const n = f.length;
  const out = buf(n);
  let ph = phase0;
  const nyq = fs * 0.45;
  for (let i = 0; i < n; i++) {
    const fi = f[i] * (jitter ? 1 + jitter[i] : 1);
    ph += (TAU * fi) / fs;
    let s = 0;
    for (let h = 0; h < harm.length; h++) {
      if (fi * (h + 1) >= nyq) break;
      s += harm[h] * Math.sin(ph * (h + 1));
    }
    out[i] = s;
  }
  return out;
}

// ------------------------------------------------------------------------------- water

export function drip(fs: number, rng: Rng): Buf {
  const out = buf(0.35 * fs);
  const c = buf(0.002 * fs);
  addBurst(c, 0, 0.15, 1, rng, fs);
  hp1(c, 3000, fs);
  normalizePeak(c, 1);
  addAt(out, c, 0, 0.2);
  const f0 = rng.logRange(900, 2600);
  addAt(out, bubble(fs, f0, { rise: rng.range(0.2, 0.45), tau: rng.range(0.012, 0.035) }), 0.0015 * fs, 1);
  if (rng.chance(0.4)) addAt(out, bubble(fs, f0 * rng.range(1.2, 1.8), { rise: rng.range(0.15, 0.35), tau: rng.range(0.008, 0.02) }), rng.range(0.01, 0.04) * fs, rng.range(0.3, 0.5));
  scuffInto(out, fs, rng, 0, 0.02, 2500, 10000, 0.05, 0.05);
  return trimTail(out, fs, 1e-4, 10);
}

// ------------------------------------------------------------------------------- trees & forest

function trunkModes(rng: Rng): Mode[] {
  return [
    ...modes(rng.range(110, 170), [1, 1.73, 2.6, 3.7, 5.2, 7.3, 10.1], [0.2, 0.16, 0.12, 0.09, 0.07, 0.05, 0.035], [0.7, 0.9, 0.8, 0.6, 0.45, 0.3, 0.2], rng, 0.05),
    ...modes(rng.range(800, 1100), [1, 1.5, 2.2], 0.03, 0.35, rng, 0.05),
  ];
}

export function treeCreak(fs: number, rng: Rng, v: number): Buf {
  const style = v % 4;
  const dur = style === 3 ? rng.range(1.6, 2.2) : rng.range(2.2, 3.6);
  const m = trunkModes(rng);
  const amp: Pts = [[0, 0], [dur * 0.25, 1], [dur * 0.7, 0.85], [dur, 0]];
  let c: Buf;
  if (style === 0) {
    c = creakLayer(fs, rng, { dur, rate: [[0, 6], [dur * 0.3, 18], [dur * 0.6, 30], [dur, 10]], amp, jitter: 0.45, modes: m, pulseMs: 1.2, wobble: 0.1, flutter: 0.4 });
  } else if (style === 1) {
    c = creakLayer(fs, rng, { dur, rate: [[0, 55], [dur * 0.4, rng.range(85, 100)], [dur * 0.7, rng.range(105, 125)], [dur, 70]], amp, jitter: 0.07, modes: m, pulseMs: 0.6, wobble: 0.05 });
  } else if (style === 2) {
    const n = Math.round(dur * fs);
    const gate = smoothRandom(n, fs, 3, rng);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const t = (k / 12) * dur;
      const g = gate[Math.min(n - 1, Math.round(t * fs))] > 0 ? 1 : 0.1;
      pts.push([t, g * Math.sin(Math.PI * (k / 12)) + 0.02]);
    }
    c = creakLayer(fs, rng, { dur, rate: [[0, 25], [dur * 0.5, 50], [dur, 30]], amp: pts, jitter: 0.3, modes: m, pulseMs: 0.8, flutter: 0.5 });
  } else {
    c = creakLayer(fs, rng, {
      dur, rate: [[0, 260], [dur * 0.3, rng.range(360, 420)], [dur * 0.5, 300], [dur, 380]],
      amp: [[0, 0], [dur * 0.15, 1], [dur * 0.4, 0.6], [dur * 0.5, 0.05], [dur * 0.6, 0.8], [dur, 0]],
      jitter: 0.03, modes: [...modes(rng.range(700, 900), [1, 1.6, 2.3, 3.1], 0.04, [1, 0.7, 0.5, 0.3], rng, 0.05), ...m.slice(0, 4)], pulseMs: 0.4,
    });
  }
  biquad(c, 'lp', 3200, 0.7, fs);
  hp1(c, 60, fs);
  return trimTail(withReverb(c, fs, 0.35, { rt60: 1.3, damp: 2500, pre: 0.02 }), fs, 2e-4, 30);
}

export function branchSnapDistant(fs: number, rng: Rng, v: number): Buf {
  const dry = buf(1 * fs);
  const crack = (t: number, a: number) => {
    const m = modes(rng.range(800, 1500), [1, 1.6, 2.3, 3.1], [0.03, 0.025, 0.02, 0.015], [1, 0.7, 0.5, 0.35], rng, 0.08);
    addAt(dry, hit(fs, rng, { contactMs: 0.1, modes: m, click: 0.9, clickMs: 1.5, clickHp: 600 }), t * fs, a);
    const ns = rng.int(3, 8);
    for (let k = 0; k < ns; k++) addAt(dry, crackle(fs, rng, 0.3, 1.5, 700, 8000), (t + rng.range(0.01, 0.07)) * fs, a * rng.range(0.25, 0.6));
  };
  crack(0.02, 1);
  if (v % 2 === 1) crack(rng.range(0.09, 0.22), rng.range(0.5, 0.75));
  const debris = pool(12, () => crackle(fs, rng, 0.2, 1, 1000, 7000));
  scatter(dry, fs, rng, { t0: 0.25, t1: 0.8, count: rng.int(15, 35), grains: debris, amp: 0.18, ampPow: 2, shape: bell });
  if (rng.chance(0.5)) thumpInto(dry, fs, rng, rng.range(0.35, 0.7), 200, 40, 0.3);
  biquad(dry, 'lp', 3500, 0.7, fs);
  hp1(dry, 100, fs);
  return trimTail(withReverb(dry, fs, 0.45, { rt60: 1.4, damp: 2200, pre: 0.015 }), fs, 2e-4, 30);
}

export function leavesRustleGust(fs: number, rng: Rng): Buf {
  const dur = rng.range(3.5, 4.5);
  const n = Math.round(dur * fs);
  const rise = rng.range(1, 1.5);
  const env = curve(n, fs, [[0, 0], [rise, 1], [rise + rng.range(0.3, 0.8), 0.9], [dur, 0]]);
  const wob = smoothRandom(n, fs, 2.5, rng);
  for (let i = 0; i < n; i++) env[i] *= 0.75 + 0.25 * wob[i];
  const out = buf(n);
  const grains = pool(32, () => crackle(fs, rng, 0.1, 0.8, 1500, 9000));
  const times = poissonTimes(dur, (t) => 900 * env[Math.min(n - 1, Math.round(t * fs))] ** 2, 900, rng);
  for (const t of times) addAt(out, rng.pick(grains), t * fs, Math.pow(rng.next(), 2.5) * env[Math.min(n - 1, Math.round(t * fs))] * rng.sign());
  normalizePeak(out, 1);
  const sw = white(n, rng);
  band(sw, 1000, 6000, fs);
  for (let i = 0; i < n; i++) sw[i] *= Math.pow(env[i], 1.5);
  normalizePeak(sw, 1);
  mixInto(out, sw, 0.5);
  const wh = pink(n, rng);
  band(wh, 80, 500, fs);
  mulInto(wh, env);
  normalizePeak(wh, 1);
  mixInto(out, wh, 0.35);
  lp1(out, 7000, fs);
  return out;
}

// ------------------------------------------------------------------------------- birds & dogs

function owlNote(fs: number, rng: Rng, dur: number, f0: number, fpts: Pts, apts: Pts, trem?: { rate: number; depth: number }): Buf {
  const n = Math.round(dur * fs);
  const f = curve(n, fs, fpts.map(([t, m]) => [t * dur, m * f0] as const));
  const vib = smoothRandom(n, fs, 9, rng);
  for (let i = 0; i < n; i++) f[i] *= 1 + 0.004 * vib[i];
  const tone = harmonicOsc(fs, f, [1, 0.1, 0.035, 0.012], undefined, rng.next() * TAU);
  const e = curve(n, fs, apts.map(([t, a]) => [t * dur, a] as const));
  if (trem) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      e[i] *= 1 - trem.depth * (1 - u * 0.5) * (0.5 + 0.5 * Math.sin((TAU * trem.rate * i) / fs));
    }
  }
  // breathy component tracking the pitch
  const br = white(n, rng);
  svf(br, f, 6, fs, BP);
  normalizePeak(br, 1);
  const air = white(n, rng);
  band(air, 300, 2500, fs);
  normalizePeak(air, 1);
  normalizePeak(tone, 1);
  for (let i = 0; i < n; i++) tone[i] = (tone[i] + 0.1 * br[i] + 0.025 * air[i]) * e[i];
  return tone;
}

function owlMale1(fs: number, rng: Rng, f0: number): Buf {
  const d = rng.range(0.7, 0.9);
  return owlNote(fs, rng, d, f0, [[0, 0.86], [0.15, 1], [0.6, 1.03], [1, 0.92]], [[0, 0], [0.09, 1], [0.7, 0.85], [1, 0]]);
}

function owlMale2(fs: number, rng: Rng, f0: number): Buf {
  const out = buf(2.6 * fs);
  let t = 0;
  addAt(out, owlNote(fs, rng, 0.12, f0 * 0.95, [[0, 0.95], [1, 0.97]], [[0, 0], [0.25, 1], [1, 0]]), 0);
  t += 0.12 + rng.range(0.25, 0.35);
  const k = rng.int(3, 5);
  for (let i = 0; i < k; i++) {
    const d = rng.range(0.05, 0.07);
    const pm = 1.02 - (0.05 * i) / k;
    addAt(out, owlNote(fs, rng, d, f0, [[0, pm], [1, pm * 0.98]], [[0, 0], [0.3, 1], [1, 0]]), t * fs, 0.75);
    t += d + rng.range(0.02, 0.035);
  }
  t += 0.02;
  const fd = rng.range(0.7, 1);
  addAt(out, owlNote(fs, rng, fd, f0, [[0, 1.02], [0.4, 1], [1, 0.9]], [[0, 0], [0.08, 1], [0.75, 0.75], [1, 0]], { rate: rng.range(10, 14), depth: 0.35 }), t * fs, 1);
  return out;
}

function owlFemale(fs: number, rng: Rng): Buf {
  const out = buf(0.5 * fs);
  const f0 = rng.range(900, 1100);
  const ke = white(Math.round(0.05 * fs), rng);
  svf(ke, f0 * 1.45, 4, fs, BP);
  normalizePeak(ke, 1);
  mulInto(ke, envelope(ke.length, fs, [[0, 0], [0.008, 1], [0.05, 0]]));
  addAt(out, ke, 0.01 * fs, 0.6);
  const wd = 0.22;
  const n = Math.round(wd * fs);
  const f = curve(n, fs, [[0, f0], [wd * 0.3, f0 * 1.45], [wd, f0 * 1.1]]);
  const jit = smoothRandom(n, fs, 120, rng);
  for (let i = 0; i < n; i++) jit[i] *= 0.02;
  const s = harmonicOsc(fs, f, [1, 0.7, 0.5, 0.35, 0.25, 0.15], jit);
  const nz = white(n, rng);
  band(nz, 800, 4000, fs);
  normalizePeak(s, 1);
  normalizePeak(nz, 1);
  mixInto(s, nz, 0.3);
  mulInto(s, envelope(n, fs, [[0, 0], [0.02, 1], [wd * 0.6, 0.8], [wd, 0]]));
  addAt(out, s, 0.09 * fs, 1);
  return out;
}

export function owlHoot(fs: number, rng: Rng, v: number): Buf {
  const f0 = rng.range(540, 640);
  let dry: Buf;
  if (v === 0) {
    const a = owlMale1(fs, rng, f0);
    const b = owlMale2(fs, rng, f0);
    const gap = rng.range(2.2, 3.2);
    dry = buf((a.length / fs + gap + b.length / fs) * fs);
    addAt(dry, a, 0);
    addAt(dry, b, (a.length / fs + gap) * fs);
  } else if (v === 1) {
    dry = owlMale1(fs, rng, f0);
  } else if (v === 2) {
    dry = owlMale2(fs, rng, f0);
  } else {
    const a = owlFemale(fs, rng);
    dry = buf(a.length * 3);
    addAt(dry, a, 0);
    if (rng.chance(0.6)) addAt(dry, owlFemale(fs, rng), rng.range(0.9, 1.3) * fs, 0.8);
  }
  biquad(dry, 'lp', 2800, 0.7, fs);
  hp1(dry, 150, fs);
  return trimTail(withReverb(dry, fs, 0.45, { rt60: 1.6, damp: 2000, pre: 0.02 }), fs, 2e-4, 40);
}

function harshCall(fs: number, rng: Rng, dur: number, fpts: Pts, f0: number, formants: ReadonlyArray<readonly [number, number, number]>, noise: number): Buf {
  const n = Math.round(dur * fs);
  const f = curve(n, fs, fpts.map(([t, m]) => [t * dur, m * f0] as const));
  const jit = smoothRandom(n, fs, 90, rng);
  for (let i = 0; i < n; i++) jit[i] *= 0.025;
  const harm: number[] = [];
  for (let h = 1; h <= 12; h++) harm.push(1 / Math.pow(h, 0.6));
  const src = harmonicOsc(fs, f, harm, jit);
  // subharmonic roughness
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (Math.PI * f[i]) / fs;
    src[i] *= 1 + 0.35 * Math.sin(ph);
  }
  normalizePeak(src, 1);
  const nz = white(n, rng);
  band(nz, 800, 3500, fs);
  normalizePeak(nz, 1);
  mixInto(src, nz, noise);
  const out = buf(n);
  for (const [fc, q, g] of formants) {
    const b = src.slice();
    svf(b, fc, q, fs, BP);
    mixInto(out, b, g);
  }
  mixInto(out, src, 0.08);
  mulInto(out, envelope(n, fs, [[0, 0], [0.02, 1], [dur - 0.08, 0.85], [dur, 0]]));
  return normalizePeak(out, 1);
}

export function crowCawDistant(fs: number, rng: Rng, v: number): Buf {
  const count = 2 + (v % 3);
  const f0 = rng.range(480, 600);
  const caws: Buf[] = [];
  for (let k = 0; k < count; k++) {
    const d = rng.range(0.28, 0.42) * (1 - k * 0.06);
    caws.push(harshCall(fs, rng, d, [[0, 1], [0.25, 1.12], [1, 0.85]], f0 * (1 - k * 0.02), [[1150, 4, 1], [1750, 5, 0.7], [2700, 5, 0.4]], 0.3));
  }
  let tot = 0.05;
  for (const c of caws) tot += c.length / fs + 0.6;
  const dry = buf(tot * fs);
  let t = 0.02;
  caws.forEach((c, k) => {
    addAt(dry, c, t * fs, 1 - k * 0.1);
    t += c.length / fs + rng.range(0.35, 0.6);
  });
  biquad(dry, 'lp', 2600, 0.7, fs);
  hp1(dry, 250, fs);
  return trimTail(withReverb(dry, fs, 0.45, { rt60: 1.4, damp: 2000, pre: 0.02 }), fs, 2e-4, 40);
}

export function dogBarkDistant(fs: number, rng: Rng, v: number): Buf {
  const f0 = rng.range(420, 560);
  const bark = () => harshCall(fs, rng, rng.range(0.12, 0.18), [[0, 1.05], [0.2, 1], [1, 0.75]], f0 * rng.range(0.95, 1.05), [[550, 3, 1], [1300, 4, 0.8], [2400, 4, 0.4]], 0.45);
  const dry = buf(2.6 * fs);
  let t = 0.02;
  const n1 = rng.int(2, 3);
  for (let k = 0; k < n1; k++) {
    addAt(dry, bark(), t * fs, rng.range(0.8, 1));
    t += rng.range(0.28, 0.45);
  }
  if (v % 2 === 0) {
    t += rng.range(0.8, 1.2);
    const n2 = rng.int(1, 2);
    for (let k = 0; k < n2; k++) {
      addAt(dry, bark(), t * fs, rng.range(0.7, 0.9));
      t += rng.range(0.3, 0.45);
    }
  }
  muffle(dry, fs, 900);
  hp1(dry, 180, fs);
  hp1(dry, 180, fs);
  const ech = echoes(dry, fs, [
    { t: rng.range(0.7, 1.1), g: 0.35, lp: 700 },
    { t: rng.range(1.6, 2.3), g: 0.2, lp: 550 },
    { t: rng.range(2.6, 3.1), g: 0.1, lp: 450 },
  ]);
  return trimTail(withReverb(ech, fs, 0.55, { rt60: 2.2, damp: 900, pre: 0.04 }), fs, 2e-4, 40);
}

export function thunderDistant(fs: number, rng: Rng): Buf {
  const dur = rng.range(9, 11);
  const n = Math.round(dur * fs);
  const exc = buf(n);
  const onset = rng.range(0.1, 0.5);
  const m = rng.int(4, 8);
  const centers: { c: number; s: number; w: number }[] = [];
  for (let k = 0; k < m; k++) {
    centers.push({
      c: onset + (k === 0 ? 0 : rng.range(0, dur * 0.55)),
      s: rng.range(0.15, 0.8),
      w: Math.pow(0.65, k) * rng.range(0.5, 1),
    });
  }
  let wsum = 0;
  for (const c of centers) wsum += c.w;
  const total = 1500;
  for (const c of centers) {
    const cnt = Math.round((total * c.w) / wsum);
    for (let i = 0; i < cnt; i++) {
      const t = c.c + Math.abs(rng.gauss(0, c.s)) * (rng.chance(0.85) ? 1 : -0.3);
      if (t < 0 || t >= dur - 0.05) continue;
      const len = rng.range(2, 10);
      const a = Math.pow(rng.next(), 2) * c.w * (0.6 + 0.4 * Math.exp(-(t - onset) / 3));
      addPulse(exc, t * fs, len, a, fs);
      addPulse(exc, (t + len / 1000) * fs, len, -a * 0.9, fs);
    }
  }
  const fc = curve(n, fs, [[0, 550], [onset + 1, 350], [dur * 0.5, 180], [dur, 110]]);
  svf(exc, fc, 0.6, fs, LP);
  lp1(exc, 800, fs);
  normalizePeak(exc, 1);
  const rum = brown(n, rng);
  biquad(rum, 'lp', 110, 0.7, fs);
  const env = curve(n, fs, [[0, 0], [onset + rng.range(0.5, 1), 1], [dur * 0.6, 0.4], [dur, 0]]);
  const sw = smoothRandom(n, fs, 1.5, rng);
  for (let i = 0; i < n; i++) rum[i] *= env[i] * (0.6 + 0.4 * sw[i]);
  normalizePeak(rum, 1);
  mixInto(exc, rum, 0.6);
  hp1(exc, 22, fs);
  hp1(exc, 22, fs);
  const fe = Math.round(0.5 * fs);
  for (let i = 0; i < fe; i++) exc[n - 1 - i] *= i / fe;
  return trimTail(withReverb(exc, fs, 0.4, { rt60: 2.5, damp: 500, pre: 0.05 }), fs, 2e-4, 50);
}

// ------------------------------------------------------------------------------- house / structure

function beamModes(rng: Rng, f0 = rng.range(130, 180)): Mode[] {
  return [
    ...modes(f0, [1, 1.6, 2.6, 3.9, 6], [0.12, 0.1, 0.08, 0.06, 0.04], [0.8, 0.9, 0.7, 0.5, 0.35], rng, 0.05),
    ...modes(rng.range(700, 1000), [1, 1.6], 0.03, 0.4, rng, 0.05),
  ];
}

function settleTick(fs: number, rng: Rng): Buf {
  const m = [
    ...modes(rng.range(600, 1300), [1, 1.48, 2.15, 3.05], [0.04, 0.035, 0.025, 0.02], [1, 0.7, 0.5, 0.3], rng, 0.06),
    ...modes(rng.range(140, 200), [1, 1.7], 0.06, 0.3, rng, 0.05),
  ];
  return hit(fs, rng, { contactMs: rng.range(0.08, 0.12), modes: m, click: 0.5, clickMs: 0.5, clickHp: 1500 });
}

export function houseSettle(fs: number, rng: Rng, v: number): Buf {
  const style = v % 6;
  const out = buf(1.2 * fs);
  if (style <= 1) {
    addAt(out, settleTick(fs, rng), 0.01 * fs, 1);
    if (rng.chance(0.5)) addAt(out, settleTick(fs, rng), rng.range(0.12, 0.4) * fs, 0.4);
  } else if (style <= 3) {
    const d = rng.range(0.2, 0.4);
    addAt(out, creakLayer(fs, rng, { dur: d, rate: [[0, 20], [d * 0.5, 55], [d, 30]], amp: [[0, 0], [d * 0.3, 1], [d, 0]], jitter: 0.4, modes: beamModes(rng), grit: 0.1, pulseMs: 0.6 }), 0.01 * fs, 1);
  } else if (style === 4) {
    let t = 0.01;
    for (const a of [1, 0.6, 0.35]) {
      addAt(out, settleTick(fs, rng), t * fs, a);
      t += rng.range(0.15, 0.4);
    }
  } else {
    const d = rng.range(0.6, 0.9);
    const c = creakLayer(fs, rng, { dur: d, rate: [[0, 40], [d * 0.5, 70], [d, 45]], amp: [[0, 0], [d * 0.3, 1], [d * 0.8, 0.7], [d, 0]], jitter: 0.15, modes: beamModes(rng, rng.range(90, 120)), pulseMs: 0.7 });
    biquad(c, 'lp', 1200, 0.7, fs);
    addAt(out, normalizePeak(c, 1), 0.01 * fs, 1);
  }
  biquad(out, 'lp', 5000, 0.7, fs);
  hp1(out, 60, fs);
  return trimTail(out, fs, 2e-4, 20);
}

export function floorCreak(fs: number, rng: Rng, v: number): Buf {
  const style = v % 5;
  const board = [
    ...modes(rng.range(320, 560), [1, 1.47, 2.12, 2.93, 3.85], [0.05, 0.045, 0.035, 0.03, 0.02], [1, 0.75, 0.55, 0.4, 0.25], rng, 0.05),
    ...modes(rng.range(110, 160), [1, 1.6], 0.09, 0.55, rng, 0.05),
  ];
  let c: Buf;
  if (style === 1) {
    const d1 = rng.range(0.12, 0.18), d2 = rng.range(0.3, 0.4);
    c = buf((d1 + d2 + 0.1) * fs);
    addAt(c, creakLayer(fs, rng, { dur: d1, rate: [[0, 70], [d1, 110]], amp: [[0, 0], [d1 * 0.3, 0.8], [d1, 0]], jitter: 0.25, modes: board }), 0, 0.8);
    addAt(c, creakLayer(fs, rng, { dur: d2, rate: [[0, 90], [d2 * 0.5, 160], [d2, 100]], amp: [[0, 0], [d2 * 0.3, 1], [d2, 0]], jitter: 0.2, modes: board }), (d1 + 0.05) * fs, 1);
  } else {
    const d = rng.range(0.4, 0.85);
    const presets: Record<number, { rate: Pts; jitter: number; pulseMs: number }> = {
      0: { rate: [[0, 60], [d * 0.5, rng.range(130, 170)], [d, 90]], jitter: 0.2, pulseMs: 0.3 },
      2: { rate: [[0, 35], [d * 0.6, 70], [d, 50]], jitter: 0.3, pulseMs: 0.5 },
      3: { rate: [[0, 180], [d * 0.5, rng.range(290, 340)], [d, 220]], jitter: 0.08, pulseMs: 0.25 },
      4: { rate: [[0, 12], [d * 0.5, 30], [d, 18]], jitter: 0.45, pulseMs: 0.8 },
    };
    const p = presets[style];
    c = creakLayer(fs, rng, { dur: d, rate: p.rate, amp: [[0, 0], [d * 0.25, 1], [d * 0.7, 0.8], [d, 0]], jitter: p.jitter, modes: board, pulseMs: p.pulseMs, grit: 0.1 });
  }
  biquad(c, 'lp', 4500, 0.7, fs);
  return normalizePeak(c, 1);
}

export function metalGroan(fs: number, rng: Rng): Buf {
  const dur = rng.range(2.5, 3.5);
  const n = Math.round(dur * fs);
  // turbulent wind pressure on the sheet (continuous excitation)
  const force = pink(n, rng);
  biquad(force, 'lp', 160, 0.7, fs);
  hp1(force, 30, fs);
  const env = curve(n, fs, [[0, 0], [dur * 0.3, 1], [dur * 0.7, 0.8], [dur, 0]]);
  const gust = smoothRandom(n, fs, 1.5, rng);
  for (let i = 0; i < n; i++) force[i] *= env[i] * (0.6 + 0.4 * gust[i]);
  // "oil-canning": the sheet snaps through with a bong
  const popExc = buf(n);
  const pops: number[] = [];
  const np = rng.int(1, 2);
  for (let k = 0; k < np; k++) {
    const t = rng.range(0.4, dur - 0.6);
    pops.push(t);
    addPulse(popExc, t * fs, 3, rng.range(0.7, 1), fs);
  }
  // buckling: the whole modal set bends in pitch
  const base = rng.range(55, 70);
  const ratios = [1, 1.41, 1.93, 2.47, 3.1, 3.8, 4.7, 5.9, 7.4, 9.2];
  const t60s = [0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.3, 0.25];
  const amps = [0.5, 0.7, 1, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, 0.2];
  const wob = smoothRandom(n, fs, 1.2, rng);
  const mod = buf(n);
  for (let i = 0; i < n; i++) {
    let mm = 1 + 0.035 * wob[i];
    for (const tp of pops) {
      const dt = i / fs - tp;
      if (dt >= 0 && dt < 0.4) mm *= 1 - 0.08 * Math.exp(-dt / 0.08);
    }
    mod[i] = mm;
  }
  const bank = (exc: Buf): Buf => {
    const o = buf(n);
    for (let k = 0; k < ratios.length; k++) {
      const f = base * ratios[k] * (1 + 0.03 * rng.bi());
      const r = Math.exp(-6.9078 / (t60s[k] * fs));
      let y1 = 0, y2 = 0, c1 = 0, g = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 31) === 0) {
          const w = (TAU * f * mod[i]) / fs;
          c1 = 2 * r * Math.cos(w);
          g = amps[k] * Math.sin(w);
        }
        const y = g * exc[i] + c1 * y1 - r * r * y2;
        y2 = y1;
        y1 = y;
        o[i] += y;
      }
    }
    return normalizePeak(o, 1);
  };
  const out = bank(force);
  mixInto(out, bank(popExc), 0.8);
  normalizePeak(out, 1);
  // nails creaking in their holes
  const cd = dur * 0.8;
  const nc = creakLayer(fs, rng, {
    dur: cd, rate: [[0, 15], [cd * 0.5, 40], [cd, 20]], amp: [[0, 0], [cd * 0.3, 1], [cd * 0.45, 0.1], [cd * 0.7, 0.9], [cd, 0]],
    jitter: 0.4, modes: modes(rng.range(350, 450), [1, 1.6, 2.5, 3.7], 0.05, [1, 0.7, 0.5, 0.3], rng, 0.05), pulseMs: 0.5,
  });
  addAt(out, nc, dur * 0.1 * fs, 0.3);
  biquad(out, 'lp', 2500, 0.7, fs);
  hp1(out, 30, fs);
  return trimTail(withReverb(out, fs, 0.2, { rt60: 0.9, damp: 2000, pre: 0.01 }), fs, 2e-4, 30);
}

export function shutterBang(fs: number, rng: Rng): Buf {
  const dry = buf(1.4 * fs);
  let tb = 0.02;
  if (rng.chance(0.6)) {
    const d = rng.range(0.2, 0.4);
    addAt(dry, creakLayer(fs, rng, { dur: d, rate: [[0, 300], [d, rng.range(420, 480)]], amp: [[0, 0], [d * 0.3, 1], [d, 0.3]], jitter: 0.05, modes: modes(rng.range(1200, 1500), [1, 1.6, 2.4], 0.04, [1, 0.6, 0.4], rng, 0.05), pulseMs: 0.2 }), 0, 0.25);
    tb = d + rng.range(0.03, 0.1);
  }
  const sm = modes(rng.range(85, 110), [1, 1.65, 2.5, 3.6, 5.2, 7.5, 10.8], [0.18, 0.15, 0.12, 0.1, 0.08, 0.06, 0.04], [0.8, 0.9, 0.8, 0.6, 0.45, 0.3, 0.2], rng, 0.05);
  addAt(dry, hit(fs, rng, { contactMs: 1.5, modes: sm, click: 0.35, clickMs: 1, thud: 0.6, thudHz: 220, thudMs: 30 }), tb * fs, 1);
  const nr = rng.int(2, 3);
  for (let k = 0; k < nr; k++) addAt(dry, tick(fs, rng, 1800, 2900, 0.01, 0.025, 2), (tb + rng.range(0.004, 0.02)) * fs, rng.range(0.15, 0.3));
  const t2 = tb + rng.range(0.09, 0.16);
  addAt(dry, hit(fs, rng, { contactMs: 1.8, modes: sm, click: 0.2, thud: 0.4, thudHz: 220, thudMs: 25 }), t2 * fs, 0.35);
  if (rng.chance(0.5)) addAt(dry, hit(fs, rng, { contactMs: 2, modes: sm }), (t2 + rng.range(0.06, 0.1)) * fs, 0.12);
  biquad(dry, 'lp', 3200, 0.7, fs);
  return trimTail(withReverb(dry, fs, 0.25, { rt60: 1, damp: 2500, pre: 0.01 }), fs, 2e-4, 30);
}

export function footstepsDistantWood(fs: number, rng: Rng, v: number): Buf {
  const steps = 3 + (v % 2);
  const spacing = rng.range(0.62, 0.78);
  const dry = buf((steps * spacing + 1) * fs);
  const joist = modes(rng.range(48, 60), [1, 1.55, 2.3, 3.4, 5, 7.6], [0.18, 0.15, 0.12, 0.09, 0.07, 0.05], [1, 0.9, 0.7, 0.5, 0.35, 0.2], rng, 0.05);
  const board = modes(rng.range(280, 450), [1, 1.5, 2.2, 3], 0.05, [1, 0.7, 0.5, 0.3], rng, 0.05);
  const creakAt = rng.int(0, steps - 1);
  let t = 0.02;
  for (let k = 0; k < steps; k++) {
    const a = rng.range(0.8, 1) * (k === steps - 1 ? 0.8 : 1);
    addAt(dry, hit(fs, rng, { contactMs: rng.range(4, 6), modes: joist, click: 0.08, clickMs: 2, thud: 0.8, thudHz: 160, thudMs: 50 }), t * fs, a);
    addAt(dry, hit(fs, rng, { contactMs: 5, modes: joist, thud: 0.4, thudHz: 180, thudMs: 30 }), (t + rng.range(0.07, 0.1)) * fs, a * 0.35);
    if (k === creakAt || rng.chance(0.25)) {
      const d = rng.range(0.25, 0.4);
      addAt(dry, creakLayer(fs, rng, { dur: d, rate: [[0, 40], [d * 0.5, rng.range(70, 90)], [d, 50]], amp: [[0, 0], [d * 0.3, 1], [d, 0]], jitter: 0.3, modes: board, pulseMs: 0.5 }), (t + 0.04) * fs, 0.35);
    }
    t += spacing * rng.range(0.95, 1.05);
  }
  muffle(dry, fs, rng.range(700, 850));
  hp1(dry, 35, fs);
  return trimTail(withReverb(dry, fs, 0.3, { rt60: 0.7, damp: 900, pre: 0.01 }), fs, 2e-4, 30);
}

export function whisperWind(fs: number, rng: Rng, v: number): Buf {
  const style = v % 3;
  const breath = (dur: number, inhale: boolean): Buf => {
    const n = Math.round(dur * fs);
    const f1 = curve(n, fs, inhale ? [[0, 500], [dur, 380]] : [[0, 380], [dur * 0.4, rng.range(600, 700)], [dur, 620]]);
    const f2 = curve(n, fs, inhale ? [[0, 1400], [dur, 1200]] : [[0, 850], [dur * 0.4, rng.range(1050, 1200)], [dur, 1150]]);
    const b = formantNoise(fs, rng, n, [[f1, 6, 1], [f2, 8, 0.6], [2500, 6, 0.25]], 0.12, 3500);
    normalizePeak(b, 1);
    const pts: Pts = inhale
      ? [[0, 0], [dur * 0.7, 1], [dur * 0.85, 0.9], [dur, 0]]
      : [[0, 0], [rng.range(0.6, 0.9), 1], [Math.max(1, dur - 1.2), 0.8], [dur, 0]];
    const e = curve(n, fs, pts);
    const wob = smoothRandom(n, fs, 3, rng);
    for (let i = 0; i < n; i++) b[i] *= e[i] * (0.85 + 0.15 * wob[i]);
    // the gap's own faint whistle
    const w = white(n, rng);
    const fw = smoothRandom(n, fs, 0.8, rng);
    const fc0 = rng.range(900, 1400);
    for (let i = 0; i < n; i++) fw[i] = fc0 * (1 + 0.03 * fw[i]);
    svf(w, fw, 40, fs, BP);
    for (let i = 0; i < n; i++) w[i] *= e[i] * e[i];
    normalizePeak(w, 1);
    mixInto(b, w, 0.12);
    return b;
  };
  let out: Buf;
  if (style === 0) out = breath(rng.range(2.4, 3.4), false);
  else if (style === 1) out = breath(rng.range(1.6, 2.2), true);
  else {
    const a = breath(rng.range(1.1, 1.4), true);
    const b = breath(rng.range(1.6, 2), false);
    out = buf(a.length + b.length + 0.3 * fs);
    addAt(out, a, 0, 0.8);
    addAt(out, b, a.length + rng.range(0.05, 0.2) * fs, 1);
  }
  lp1(out, 7000, fs);
  return out;
}

// ------------------------------------------------------------------------------- body

export function heartbeat(fs: number, rng: Rng): Buf {
  const out = buf(0.75 * fs);
  const beat = (t: number, fa: number, fb: number, t60: number, a: number) => {
    const n = Math.round(t60 * 1.3 * fs);
    const b = buf(n);
    let ph = 0;
    const k = -6.9078 / (t60 * fs);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const f = fb + (fa - fb) * Math.exp(-u * 6);
      ph += (TAU * f) / fs;
      b[i] = Math.sin(ph) * Math.exp(k * i) * Math.min(1, i / (0.004 * fs));
    }
    normalizePeak(b, 1);
    addAt(out, b, t * fs, a);
    thumpInto(out, fs, rng, t, 120, 35, a * 0.4);
  };
  beat(0.01, rng.range(68, 76), rng.range(44, 50), rng.range(0.12, 0.15), 1);
  beat(0.01 + rng.range(0.28, 0.33), rng.range(82, 90), rng.range(56, 62), rng.range(0.08, 0.1), rng.range(0.6, 0.75));
  biquad(out, 'lp', 200, 0.7, fs);
  hp1(out, 20, fs);
  return out;
}

export function breathTired(fs: number, rng: Rng): Buf {
  const di = rng.range(0.35, 0.45);
  const gap = rng.range(0.03, 0.08);
  const de = rng.range(0.5, 0.65);
  const out = buf((di + gap + de + 0.1) * fs);
  const s = rng.range(0.92, 1.08);
  const ni = Math.round(di * fs);
  const inh = formantNoise(fs, rng, ni, [[520 * s, 3, 1], [1600 * s, 4, 0.6], [2700 * s, 4, 0.35]], 0.25, 3000);
  hp1(inh, 300, fs);
  normalizePeak(inh, 1);
  const ei = envelope(ni, fs, [[0, 0], [di * 0.4, 1], [di, 0]]);
  for (let i = 0; i < ni; i++) inh[i] *= Math.pow(ei[i], 1.5);
  addAt(out, inh, 0.01 * fs, 0.55);
  const ne = Math.round(de * fs);
  const exh = formantNoise(fs, rng, ne, [[700 * s, 3.5, 1], [1250 * s, 3.5, 0.7], [2500 * s, 4, 0.3]], 0.1, 3000);
  normalizePeak(exh, 1);
  // a trace of voicing gives the "hah" its human quality
  const f = curve(ne, fs, [[0, rng.range(125, 140)], [de, rng.range(105, 115)]]);
  const v = harmonicOsc(fs, f, [1, 0.6, 0.4, 0.25, 0.15, 0.1]);
  band(v, 100, 1500, fs);
  normalizePeak(v, 1);
  mixInto(exh, v, 0.06);
  const ee = envelope(ne, fs, [[0, 0], [0.06, 1], [de * 0.4, 0.8], [de, 0]]);
  mulInto(exh, ee);
  addAt(out, exh, (0.01 + di + gap) * fs, 1);
  lp1(out, 8000, fs);
  return out;
}

export function breathCalm(fs: number, rng: Rng): Buf {
  const di = rng.range(1, 1.3);
  const pause = rng.range(0.1, 0.2);
  const de = rng.range(1.3, 1.6);
  const out = buf((di + pause + de + 0.2) * fs);
  const ni = Math.round(di * fs);
  const inh = formantNoise(fs, rng, ni, [[1800, 1.2, 1], [3200, 2, 0.5]], 0, 3000);
  normalizePeak(inh, 1);
  mulInto(inh, curve(ni, fs, [[0, 0], [di * 0.45, 1], [di, 0]]));
  addAt(out, inh, 0.02 * fs, 0.45);
  const ne = Math.round(de * fs);
  const exh = formantNoise(fs, rng, ne, [[900, 1, 1], [2200, 1.5, 0.45]], 0, 3000);
  normalizePeak(exh, 1);
  mulInto(exh, curve(ne, fs, [[0, 0], [de * 0.25, 1], [de, 0]]));
  addAt(out, exh, (0.02 + di + pause) * fs, 0.6);
  lp1(out, 6000, fs);
  return out;
}

