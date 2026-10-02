/**
 * Seamless loops. Three techniques keep them seamless:
 *  - noise beds are rendered longer than the loop and the tail is equal-power crossfaded
 *    into the head (loopify);
 *  - discrete events (drops, bubbles, ticks, engine firings) are written with wrap-around;
 *  - tonal / periodic parts use an integer number of cycles, and their filters are run
 *    "circularly" (twice over the buffer) so the steady state is exactly periodic.
 */
import {
  type Buf, Rng, TAU, addAt, addBurst, addPulse, band, biquad, brown, bubble, buf, circular, clamp, crackle,
  hit, hp1, loopify, lp1, mapCtl, modal, modes, mulInto, mixInto, normalizePeak, normalizeRms, pink,
  poissonTimes, pool, scatter, smoothRandom, svf, tick, white, BP, LP,
} from '../dsp';

const u01 = (x: number): number => clamp((x + 1) * 0.5, 0, 1);

// ------------------------------------------------------------------------------- wind

export function windLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(1.5 * fs);
  const n = L + X;
  const gc = smoothRandom(n, fs, 0.35, rng);
  const fast = smoothRandom(n, fs, 3, rng);
  const g = buf(n);
  for (let i = 0; i < n; i++) {
    const u = u01(gc[i]);
    g[i] = 0.22 + 0.78 * u * u;
  }

  const body = pink(n, rng);
  const fc = buf(n);
  for (let i = 0; i < n; i++) fc[i] = 170 + 520 * g[i] * (1 + 0.15 * fast[i]);
  svf(body, fc, 0.6, fs, BP);
  for (let i = 0; i < n; i++) body[i] *= g[i] * Math.sqrt(g[i]) * (0.85 + 0.15 * fast[i]);
  normalizeRms(body, 1);

  const rum = brown(n, rng);
  biquad(rum, 'lp', 90, 0.7, fs);
  hp1(rum, 22, fs);
  for (let i = 0; i < n; i++) rum[i] *= 0.4 + 0.6 * g[i];
  normalizeRms(rum, 1);

  const wh = white(n, rng);
  const fw = buf(n);
  const f1 = rng.range(430, 540);
  for (let i = 0; i < n; i++) fw[i] = f1 + 420 * g[i] + 30 * fast[i];
  svf(wh, fw, 22, fs, BP);
  for (let i = 0; i < n; i++) wh[i] *= g[i] * g[i] * Math.sqrt(g[i]);
  normalizeRms(wh, 1);

  const fol = white(n, rng);
  band(fol, 1800, 7500, fs);
  const flut = smoothRandom(n, fs, 14, rng);
  for (let i = 0; i < n; i++) fol[i] *= g[i] * g[i] * (0.55 + 0.45 * flut[i]);
  normalizeRms(fol, 1);

  const out = buf(n);
  mixInto(out, body, 1);
  mixInto(out, rum, 0.55);
  mixInto(out, wh, 0.1);
  mixInto(out, fol, 0.3);
  return loopify(out, X);
}

export function windInteriorLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(1.5 * fs);
  const n = L + X;
  const gc = smoothRandom(n, fs, 0.25, rng);
  const fast = smoothRandom(n, fs, 2.5, rng);
  const g = buf(n);
  for (let i = 0; i < n; i++) {
    const u = u01(gc[i]);
    g[i] = 0.15 + 0.85 * u * u;
  }

  const rum = brown(n, rng);
  biquad(rum, 'lp', 220, 0.7, fs);
  hp1(rum, 25, fs);
  for (let i = 0; i < n; i++) rum[i] *= 0.35 + 0.65 * g[i];
  normalizeRms(rum, 1);

  const buff = brown(n, rng);
  biquad(buff, 'lp', 60, 0.7, fs);
  hp1(buff, 18, fs);
  for (let i = 0; i < n; i++) buff[i] *= g[i] * g[i] * (0.6 + 0.4 * fast[i]);
  normalizeRms(buff, 1);

  const f1 = rng.range(700, 1200);
  const whistle = (ratio: number, q: number, pw: number): Buf => {
    const w = white(n, rng);
    const fc = buf(n);
    for (let i = 0; i < n; i++) fc[i] = f1 * ratio * (1 + 0.04 * g[i] + 0.01 * fast[i]);
    svf(w, fc, q, fs, BP);
    svf(w, fc, q, fs, BP);
    for (let i = 0; i < n; i++) {
      const g3 = g[i] * g[i] * g[i];
      w[i] *= pw > 3 ? g3 * Math.sqrt(g[i]) : g3;
    }
    return normalizeRms(w, 1);
  };
  const w1 = whistle(1, 30, 3);
  const w2 = whistle(1.87, 40, 3.5);

  const hiss = white(n, rng);
  band(hiss, 2000, 5000, fs);
  for (let i = 0; i < n; i++) hiss[i] *= g[i] * g[i];
  normalizeRms(hiss, 1);

  const out = buf(n);
  mixInto(out, rum, 1);
  mixInto(out, buff, 0.5);
  mixInto(out, w1, 0.22);
  mixInto(out, w2, 0.08);
  mixInto(out, hiss, 0.06);
  return loopify(out, X);
}

// ------------------------------------------------------------------------------- rain

export function rainLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(8 * fs);
  const X = Math.round(1 * fs);
  const n = L + X;
  const bed = pink(n, rng);
  band(bed, 400, 9000, fs);
  const sl = smoothRandom(n, fs, 0.5, rng);
  for (let i = 0; i < n; i++) bed[i] *= 0.9 + 0.1 * sl[i];
  normalizeRms(bed, 1);
  const out = loopify(bed, X);
  scaleTo(out, 0.36);

  const dur = L / fs;
  const fine = pool(48, () => crackle(fs, rng, 0.1, 0.5, 2500, 12000));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(1400 * dur), grains: fine, amp: 0.55, ampPow: 3, wrap: true });
  const leaf = pool(32, () => tick(fs, rng, 700, 3200, 0.004, 0.015, 2));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(95 * dur), grains: leaf, amp: 0.8, ampPow: 2, wrap: true });
  const plink = pool(16, () => bubble(fs, rng.logRange(1200, 4000), { rise: rng.range(0.1, 0.3) }));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(5 * dur), grains: plink, amp: 0.3, ampPow: 1.5, wrap: true });
  const fat = pool(8, () => tick(fs, rng, 400, 1200, 0.01, 0.03, 2));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(2 * dur), grains: fat, amp: 0.7, ampPow: 1.2, wrap: true });
  return out;
}

export function rainRoofLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(1 * fs);
  const n = L + X;
  const dur = L / fs;
  const rum = pink(n, rng);
  band(rum, 60, 500, fs);
  const sl = smoothRandom(n, fs, 0.4, rng);
  for (let i = 0; i < n; i++) rum[i] *= 0.88 + 0.12 * sl[i];
  normalizeRms(rum, 1);
  const out = loopify(rum, X);
  scaleTo(out, 0.7);

  // drumming on the tiles, heard through the ceiling
  const drum = buf(L);
  const tiles = pool(40, () => tick(fs, rng, 500, 2600, 0.006, 0.02, 2));
  scatter(drum, fs, rng, { t0: 0, t1: dur, count: Math.round(700 * dur), grains: tiles, amp: 0.7, ampPow: 2.5, wrap: true });
  circular(drum, (d) => {
    biquad(d, 'lp', 2200, 0.7, fs);
    lp1(d, 3000, fs);
  });
  normalizeRms(drum, 0.55);
  mixInto(out, drum, 1);

  // gutter: bubbly trickle with a slowly varying flow
  const flow = smoothRandom(L, fs, 0.8, rng, true);
  const bub = pool(40, () => bubble(fs, rng.logRange(350, 1600), { rise: rng.range(0.1, 0.35) }));
  const times = poissonTimes(dur, (t) => 30 * (0.35 + 0.65 * u01(flow[Math.min(L - 1, Math.round(t * fs))])), 30, rng);
  for (const t of times) addAt(out, rng.pick(bub), t * fs, rng.range(0.05, 0.22), true);

  // steady drip from a gutter seam onto the window sill
  const plonk = (): Buf => {
    const p = hit(fs, rng, { contactMs: 0.2, modes: modes(rng.range(1100, 1400), [1, 1.7, 2.6], 0.05, [1, 0.5, 0.3], rng, 0.05) });
    addAt(p, bubble(fs, rng.range(800, 1200), { rise: 0.3 }), 0, 0.6);
    return normalizePeak(p, 1);
  };
  let t = rng.range(0, 0.4);
  while (t < dur - 0.6) {
    addAt(out, plonk(), t * fs, rng.range(0.18, 0.3), true);
    t += rng.range(0.55, 0.9);
  }
  return out;
}

export function rainWindowLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(8 * fs);
  const X = Math.round(1 * fs);
  const n = L + X;
  const dur = L / fs;
  const bed = pink(n, rng);
  band(bed, 150, 1500, fs);
  normalizeRms(bed, 1);
  const out = loopify(bed, X);
  scaleTo(out, 0.55);

  const glass = pool(36, () => tick(fs, rng, 1800, 6000, 0.003, 0.009, 2));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(110 * dur), grains: glass, amp: 0.6, ampPow: 2.2, wrap: true });
  const big = pool(10, () => tick(fs, rng, 1200, 3500, 0.008, 0.02, 2));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(6 * dur), grains: big, amp: 0.9, ampPow: 1.3, wrap: true });

  const tr = white(L, rng);
  const tc = smoothRandom(L, fs, 0.7, rng, true);
  circular(tr, (d) => band(d, 2500, 8000, fs));
  for (let i = 0; i < L; i++) {
    const u = u01(tc[i]);
    tr[i] *= u * u;
  }
  normalizeRms(tr, 0.04);
  mixInto(out, tr, 1);
  return out;
}

// ------------------------------------------------------------------------------- nature

export function forestNightLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(2 * fs);
  const n = L + X;
  const air = brown(n, rng);
  biquad(air, 'lp', 220, 0.7, fs);
  hp1(air, 20, fs);
  const sa = smoothRandom(n, fs, 0.12, rng);
  for (let i = 0; i < n; i++) air[i] *= 0.75 + 0.25 * sa[i];
  normalizeRms(air, 1);

  const breath = smoothRandom(n, fs, 0.15, rng);
  const canopy = pink(n, rng);
  const fc = buf(n);
  const fcc = smoothRandom(n, fs, 0.1, rng);
  for (let i = 0; i < n; i++) fc[i] = 300 + 500 * u01(fcc[i]);
  svf(canopy, fc, 0.8, fs, BP);
  for (let i = 0; i < n; i++) {
    const u = u01(breath[i]);
    canopy[i] *= 0.15 + 0.85 * u * u;
  }
  normalizeRms(canopy, 1);

  const leaves = white(n, rng);
  band(leaves, 2500, 8000, fs);
  for (let i = 0; i < n; i++) {
    const u = u01(breath[i]);
    leaves[i] *= u * u * u;
  }
  normalizeRms(leaves, 1);

  const bed = buf(n);
  mixInto(bed, air, 1);
  mixInto(bed, canopy, 0.45);
  mixInto(bed, leaves, 0.16);
  const out = loopify(bed, X);
  const p = rmsOf(out);
  const ticks = pool(12, () => tick(fs, rng, 900, 3000, 0.004, 0.012, 2));
  scatter(out, fs, rng, { t0: 0, t1: L / fs, count: Math.round(L / fs), grains: ticks, amp: p * 0.9, ampPow: 1.5, wrap: true });
  return out;
}

export function streamLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(1.5 * fs);
  const n = L + X;
  const dur = L / fs;
  const bed = pink(n, rng);
  band(bed, 300, 6000, fs);
  const sb = smoothRandom(n, fs, 0.3, rng);
  for (let i = 0; i < n; i++) bed[i] *= 0.8 + 0.2 * sb[i];
  normalizeRms(bed, 1);
  const out = loopify(bed, X);
  scaleTo(out, 0.12);

  const bub = pool(160, () => {
    const f0 = rng.logRange(280, 2600);
    return bubble(fs, f0, { rise: rng.range(0.05, 0.4), amp: Math.pow(600 / f0, 0.4), maxDur: 0.06 });
  });
  const ctl = smoothRandom(L, fs, 1.5, rng, true);
  const times = poissonTimes(dur, (t) => 170 * (0.3 + 0.7 * u01(ctl[Math.min(L - 1, Math.round(t * fs))])), 170, rng);
  for (const t of times) addAt(out, rng.pick(bub), t * fs, rng.range(0.05, 0.25), true);
  const gurg = pool(16, () => bubble(fs, rng.range(120, 320), { rise: rng.range(0.2, 0.5), maxDur: 0.12 }));
  const gt = poissonTimes(dur, () => 4, 4, rng);
  for (const t of gt) addAt(out, rng.pick(gurg), t * fs, rng.range(0.1, 0.3), true);
  return out;
}

export function tunnelAirLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(10 * fs);
  const X = Math.round(2 * fs);
  const n = L + X;
  const drone = brown(n, rng);
  biquad(drone, 'lp', 90, 0.7, fs);
  hp1(drone, 18, fs);
  const sd = smoothRandom(n, fs, 0.1, rng);
  for (let i = 0; i < n; i++) drone[i] *= 0.8 + 0.2 * sd[i];
  normalizeRms(drone, 1);

  const out = buf(n);
  mixInto(out, drone, 1);
  const f1 = rng.range(40, 50);
  const res = [[1, 0.5], [1.62, 0.3], [2.71, 0.15]] as const;
  for (const [r, a] of res) {
    const b = white(n, rng);
    svf(b, f1 * r, 14, fs, BP);
    svf(b, f1 * r, 10, fs, BP);
    const br = smoothRandom(n, fs, 0.12, rng);
    for (let i = 0; i < n; i++) b[i] *= 0.3 + 0.7 * u01(br[i]);
    normalizeRms(b, 1);
    mixInto(out, b, a);
  }
  const flow = pink(n, rng);
  const fc = smoothRandom(n, fs, 0.08, rng);
  mapCtl(fc, 250, 600);
  svf(flow, fc, 0.7, fs, BP);
  const sw = smoothRandom(n, fs, 0.08, rng);
  for (let i = 0; i < n; i++) {
    const u = u01(sw[i]);
    flow[i] *= 0.4 + 0.6 * u * u;
  }
  normalizeRms(flow, 1);
  mixInto(out, flow, 0.25);
  const hiss = white(n, rng);
  band(hiss, 1500, Math.min(4500, fs * 0.45), fs);
  normalizeRms(hiss, 1);
  mixInto(out, hiss, 0.04);
  return loopify(out, X);
}

// ------------------------------------------------------------------------------- machines

export function bulbBuzzLoop(fs: number, rng: Rng): Buf {
  const P = Math.round(fs / 50);
  const cycles = 200;
  const n = P * cycles;
  const hum = buf(n);
  const harm: ReadonlyArray<readonly [number, number]> = [[1, 0.25], [2, 1], [3, 0.25], [4, 0.4], [5, 0.12], [6, 0.18], [8, 0.08], [10, 0.05]];
  for (const [h, a] of harm) {
    const ph = rng.next() * TAU;
    const w = (TAU * h) / P;
    for (let i = 0; i < n; i++) hum[i] += a * Math.sin(w * i + ph);
  }
  normalizeRms(hum, 1);

  // filament / choke buzz: a sharp event every half cycle, intensity flickers
  const flick = smoothRandom(n, fs, 3, rng, true);
  const dips = smoothRandom(n, fs, 0.7, rng, true);
  const exc = buf(n);
  for (let k = 0; k < cycles * 2; k++) {
    const at = Math.round((k * P) / 2 + P * 0.18);
    const i = at % n;
    const a = (0.6 + 0.4 * u01(flick[i])) * (dips[i] < -0.6 ? 0.4 : 1) * (1 + 0.1 * rng.bi());
    exc[i] += a;
    exc[(i + 1) % n] -= a * 0.6;
  }
  circular(exc, (d) => {
    const r = modal(d, modes(rng.range(2200, 2600), [1, 1.55, 2.2, 2.9], [0.006, 0.005, 0.004, 0.003], [1, 0.7, 0.5, 0.3], rng, 0.05), fs);
    d.set(r);
    biquad(d, 'lp', 7000, 0.7, fs);
  });
  normalizeRms(exc, 1);
  const out = buf(n);
  mixInto(out, hum, 1);
  mixInto(out, exc, 0.35);
  return out;
}

export function generatorLoop(fs: number, rng: Rng): Buf {
  const fire = 15; // firing rate (Hz): ~1800 rpm four-stroke single cylinder
  const P = Math.round(fs / fire);
  const cycles = 90;
  const n = P * cycles;
  const exExh = buf(n);
  const exNoise = buf(n);
  const exMech = buf(n);
  const exValve = buf(n);
  const ampEnv = buf(n);
  for (let k = 0; k < cycles; k++) {
    let a = 1 + 0.14 * rng.bi();
    if (rng.chance(0.04)) a *= 0.35;
    const off = Math.round(rng.bi() * 0.012 * P);
    const t0 = (k * P + off + n) % n;
    addPulse(exExh, t0, 2.5, a, fs);
    addBurst(exNoise, t0, rng.range(10, 16), a, rng, fs);
    addBurst(exMech, (t0 + Math.round(P * 0.5)) % n, 2, 0.6 * (1 + 0.2 * rng.bi()), rng, fs);
    addBurst(exMech, t0, 1.5, 0.4, rng, fs);
    exValve[(t0 + Math.round(P * 0.3)) % n] += 0.4 * (1 + 0.2 * rng.bi());
    exValve[(t0 + Math.round(P * 0.56)) % n] += 0.35 * (1 + 0.2 * rng.bi());
    for (let j = 0; j < P; j++) ampEnv[(t0 + j) % n] = Math.max(ampEnv[(t0 + j) % n], a * (0.55 + 0.45 * Math.exp((-j / P) * 6)));
  }
  const muffler = modes(rng.range(60, 75), [1, 2.05, 3.3, 4.8], [0.09, 0.07, 0.05, 0.04], [1, 0.7, 0.45, 0.3], rng, 0.04);
  const exh = exExh.slice();
  circular(exh, (d) => d.set(modal(d, muffler, fs)));
  normalizeRms(exh, 1);
  const pop = exNoise.slice();
  circular(pop, (d) => {
    biquad(d, 'lp', 700, 0.7, fs);
    biquad(d, 'hp', 40, 0.7, fs);
  });
  normalizeRms(pop, 1);
  const rattle = exExh.slice();
  circular(rattle, (d) => d.set(modal(d, modes(rng.range(170, 200), [1, 2.3, 4.1, 7.2], 0.06, [1, 0.8, 0.6, 0.4], rng, 0.05), fs)));
  normalizeRms(rattle, 1);
  const mech = exMech.slice();
  circular(mech, (d) => band(d, 900, 3500, fs));
  normalizeRms(mech, 1);
  const valve = exValve.slice();
  circular(valve, (d) => d.set(modal(d, modes(rng.range(2400, 2800), [1, 1.5, 2.2], 0.012, [1, 0.6, 0.4], rng, 0.05), fs)));
  normalizeRms(valve, 1);
  // alternator hum: exactly 300 cycles of 50 Hz in 6 s
  const hum = buf(n);
  const c50 = Math.round(n / (fs / 50));
  for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.35]] as const) {
    const w = (TAU * c50 * h) / n;
    const ph = rng.next() * TAU;
    for (let i = 0; i < n; i++) hum[i] += a * Math.sin(w * i + ph);
  }
  normalizeRms(hum, 1);
  const nz = white(n, rng);
  circular(nz, (d) => band(d, 600, 4000, fs));
  mulInto(nz, ampEnv);
  normalizeRms(nz, 1);
  const out = buf(n);
  mixInto(out, exh, 1);
  mixInto(out, pop, 0.55);
  mixInto(out, rattle, 0.22);
  mixInto(out, mech, 0.28);
  mixInto(out, valve, 0.12);
  mixInto(out, hum, 0.12);
  mixInto(out, nz, 0.18);
  return out;
}

export function clockTickLoop(fs: number, rng: Rng): Buf {
  const beats = 8;
  const n = Math.round(beats * fs);
  const out = buf(n);
  const fTick = rng.range(2900, 3300);
  const fCase = rng.range(380, 450);
  for (let k = 0; k < beats; k++) {
    const tock = k % 2 === 1;
    const t = k + (tock ? 0.012 : 0) + rng.range(-0.002, 0.002);
    const pitch = tock ? 0.93 : 1;
    const esc = modes(fTick * pitch, [1, 1.41, 1.93, 2.52], [0.02, 0.018, 0.014, 0.01], [1, 0.8, 0.6, 0.4], rng, 0.02);
    const box = modes(fCase * pitch, [1, 1.55, 2.3, 3.4], [0.07, 0.06, 0.05, 0.04], [1, 0.8, 0.6, 0.4], rng, 0.02);
    const a = (tock ? 0.85 : 1) * (1 + 0.05 * rng.bi());
    addAt(out, hit(fs, rng, { contactMs: 0.05, modes: esc, click: 0.4, clickMs: 0.2, clickHp: 3000 }), t * fs, 0.5 * a, true);
    addAt(out, hit(fs, rng, { contactMs: 0.15, modes: box }), t * fs, 0.6 * a, true);
    addAt(out, hit(fs, rng, { contactMs: 0.05, modes: esc }), (t + rng.range(0.01, 0.014)) * fs, 0.3 * a, true);
  }
  return out;
}

export function radioStaticLoop(fs: number, rng: Rng): Buf {
  const L = Math.round(8 * fs);
  const X = Math.round(1 * fs);
  const n = L + X;
  const dur = L / fs;
  const st = white(n, rng);
  band(st, 250, 4500, fs);
  biquad(st, 'peak', 1800, 0.8, fs, 3);
  const qsb = smoothRandom(n, fs, 0.4, rng);
  for (let i = 0; i < n; i++) st[i] *= 0.55 + 0.45 * u01(qsb[i]);
  normalizeRms(st, 1);
  const out = loopify(st, X);
  scaleTo(out, 0.5);

  // sferics: impulsive crackle, sometimes in bursts
  const cr = pool(24, () => crackle(fs, rng, 0.3, 3, 300, 4500));
  scatter(out, fs, rng, { t0: 0, t1: dur, count: Math.round(35 * dur), grains: cr, amp: 1.4, ampPow: 3, wrap: true });
  const bursts = rng.int(3, 5);
  for (let b = 0; b < bursts; b++) {
    const c = rng.range(0, dur);
    scatter(out, fs, rng, { t0: c, t1: c + rng.range(0.04, 0.1), count: rng.int(20, 40), grains: cr, amp: 1, ampPow: 2, wrap: true });
  }

  // ghostly heterodyne carrier: wavering faint whistle, integer cycles over the loop
  const carrier = (f0: number, dev: number, a: number): void => {
    const w1 = smoothRandom(L, fs, 0.6, rng, true);
    const fade = smoothRandom(L, fs, 0.3, rng, true);
    const f = buf(L);
    let tot = 0;
    for (let i = 0; i < L; i++) {
      f[i] = f0 + dev * w1[i];
      tot += f[i] / fs;
    }
    const k = Math.max(1, Math.round(tot)) / tot;
    let ph = rng.next() * TAU;
    const c = buf(L);
    for (let i = 0; i < L; i++) {
      ph += (TAU * f[i] * k) / fs;
      const u = u01(fade[i]);
      c[i] = Math.sin(ph) * u * u;
    }
    normalizeRms(c, a);
    mixInto(out, c, 1);
  };
  const base = rmsOf(out);
  carrier(rng.range(900, 1400), 18, base * 0.16);
  carrier(rng.range(1700, 2400), 30, base * 0.05);
  return out;
}

// ------------------------------------------------------------------------------- helpers

function rmsOf(a: Buf): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

function scaleTo(a: Buf, r: number): void {
  normalizeRms(a, r);
}

