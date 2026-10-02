/**
 * Footstep recipes. A step is a heel strike followed ~70–120 ms later by the ball/toe, each
 * built from a physically motivated impact (contact pulse → floor modes) plus the
 * surface-specific texture (grains for gravel/leaves/hay, bubbles for water, a resonant
 * suction sweep for mud, swishes for grass/fabric).
 */
import {
  type Buf, Rng, addAt, biquad, bubble, buf, crackle, curve, hit, lp1, modes, mulInto, normalizePeak,
  pool, scatter, scuffInto, smoothRandom, svf, tick, white, BP, envelope, addBurst, band,
} from '../dsp';
import { creakLayer, floorModes, gritInto, strike, swishInto, thumpInto } from './kit';

const HEEL = 0.004;
const toeAt = (rng: Rng, lo: number, hi: number): number => HEEL + rng.range(lo, hi);

// ------------------------------------------------------------------------------- wood

export function stepWood(fs: number, rng: Rng, creakAmt = 0, old = false): Buf {
  const dur = creakAmt > 0 ? 0.85 : 0.42;
  const out = buf(dur * fs);
  const floor = floorModes(rng, old ? rng.range(80, 104) : rng.range(95, 130));
  const toe = toeAt(rng, 0.07, 0.11);
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.9, 1.5), modes: floor, click: 0.3, clickMs: 0.7, clickHp: 2000, thud: 0.5, thudHz: 130, thudMs: 28 }), HEEL * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(1.6, 2.6), modes: floor, click: 0.18, clickMs: 1.1, clickHp: 2500, thud: 0.25, thudHz: 160, thudMs: 20 }), toe * fs, rng.range(0.38, 0.6));
  scuffInto(out, fs, rng, toe + 0.004, rng.range(0.03, 0.06), 900, 4000, rng.range(0.04, 0.08));
  if (old) {
    // loose board knocking against its neighbour / nail
    addAt(out, hit(fs, rng, { contactMs: 0.4, modes: modes(rng.range(420, 700), [1, 1.6, 2.4], 0.03, [1, 0.6, 0.4], rng, 0.05) }), (HEEL + rng.range(0.012, 0.03)) * fs, rng.range(0.1, 0.22));
  }
  if (creakAmt > 0) {
    const t0 = HEEL + rng.range(0.03, 0.12);
    const cd = rng.range(0.24, 0.5);
    const r0 = rng.range(45, 130);
    const r1 = r0 * rng.range(0.6, 1.7);
    const fb = rng.range(380, 750);
    const m = [
      ...modes(fb, [1, 1.52, 2.27, 3.08, 4.35], [0.05, 0.042, 0.035, 0.028, 0.02], [1, 0.7, 0.5, 0.35, 0.2], rng, 0.05),
      ...modes(rng.range(150, 220), [1, 1.6], 0.08, 0.55, rng, 0.05),
    ];
    const c = creakLayer(fs, rng, {
      dur: cd,
      rate: [[0, r0 * 0.7], [cd * 0.3, r0], [cd * 0.75, r1], [cd, r1 * 0.8]],
      amp: [[0, 0], [cd * 0.25, 1], [cd * 0.7, 0.8], [cd, 0]],
      jitter: rng.range(0.15, 0.35), modes: m, grit: 0.12,
    });
    addAt(out, c, t0 * fs, creakAmt);
  }
  return out;
}

// ------------------------------------------------------------------------------- hard floors

export function stepStone(fs: number, rng: Rng): Buf {
  const out = buf(0.34 * fs);
  const toe = toeAt(rng, 0.06, 0.1);
  const slab = [
    ...modes(rng.range(1700, 2300), [1, 1.47, 1.98, 2.63, 3.4], [0.025, 0.02, 0.016, 0.012, 0.01], [1, 0.7, 0.55, 0.4, 0.3], rng, 0.08),
    ...modes(rng.range(85, 110), [1, 2.1], 0.035, 0.6, rng, 0.05),
  ];
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.25, 0.45), modes: slab, click: 0.55, clickMs: 0.6, clickHp: 1500, thud: 0.5, thudHz: 120, thudMs: 18 }), HEEL * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.4, 0.7), modes: slab, click: 0.4, clickMs: 0.8, clickHp: 2000, thud: 0.25, thudHz: 140, thudMs: 15 }), toe * fs, rng.range(0.35, 0.55));
  gritInto(out, fs, rng, toe - 0.006, rng.range(0.04, 0.07), rng.int(25, 45), 2500, 8000, rng.range(0.1, 0.16));
  return out;
}

export function stepTile(fs: number, rng: Rng): Buf {
  const out = buf(0.34 * fs);
  const toe = toeAt(rng, 0.06, 0.1);
  const tile = [
    ...modes(rng.range(2300, 3000), [1, 1.38, 1.83, 2.4, 3.1], [0.05, 0.04, 0.032, 0.025, 0.018], [1, 0.75, 0.6, 0.45, 0.3], rng, 0.07),
    ...modes(rng.range(380, 520), [1, 1.9], 0.025, 0.6, rng, 0.05),
  ];
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.2, 0.35), modes: tile, click: 0.5, clickMs: 0.5, clickHp: 2500, thud: 0.4, thudHz: 140, thudMs: 15 }), HEEL * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.35, 0.6), modes: tile, click: 0.35, clickMs: 0.6, clickHp: 2500, thud: 0.2, thudHz: 160, thudMs: 12 }), toe * fs, rng.range(0.35, 0.55));
  gritInto(out, fs, rng, toe - 0.004, 0.04, rng.int(8, 16), 3000, 9000, 0.06);
  return out;
}

export function stepConcrete(fs: number, rng: Rng): Buf {
  const out = buf(0.36 * fs);
  const toe = toeAt(rng, 0.065, 0.1);
  const slab = [
    ...modes(rng.range(1100, 1500), [1, 1.6, 2.3, 3.1], [0.014, 0.012, 0.01, 0.008], [1, 0.7, 0.5, 0.35], rng, 0.08),
    ...modes(rng.range(80, 100), [1, 2.2], 0.03, 0.7, rng, 0.05),
  ];
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.35, 0.6), modes: slab, click: 0.45, clickMs: 0.8, clickHp: 1200, thud: 0.6, thudHz: 120, thudMs: 20 }), HEEL * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.5, 0.8), modes: slab, click: 0.3, clickMs: 1, clickHp: 1500, thud: 0.3, thudHz: 140, thudMs: 15 }), toe * fs, rng.range(0.35, 0.5));
  gritInto(out, fs, rng, HEEL + 0.002, 0.05, rng.int(20, 40), 2000, 7000, 0.12);
  gritInto(out, fs, rng, toe - 0.004, rng.range(0.05, 0.09), rng.int(40, 80), 2000, 7000, rng.range(0.14, 0.22));
  scuffInto(out, fs, rng, toe, rng.range(0.04, 0.08), 2000, 6500, 0.08);
  return out;
}

export function stepMetal(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  const toe = toeAt(rng, 0.07, 0.11);
  const plate = modes(rng.range(180, 320), [1, 1.58, 2.13, 2.71, 3.31, 4.12, 5.03, 6.2, 7.6, 9.3],
    [0.35, 0.3, 0.26, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06], [0.6, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.18], rng, 0.05);
  const boom = modes(rng.range(70, 110), [1, 1.5], 0.12, 0.9, rng, 0.05);
  const all = [...plate, ...boom];
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.6, 0.9), modes: all, click: 0.3, clickMs: 0.5, clickHp: 2500, thud: 0.35, thudHz: 140, thudMs: 20 }), HEEL * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(0.8, 1.2), modes: all, click: 0.2, thud: 0.15, thudHz: 160, thudMs: 15 }), toe * fs, rng.range(0.35, 0.5));
  const rattles = rng.int(1, 3);
  for (let k = 0; k < rattles; k++) {
    addAt(out, hit(fs, rng, { contactMs: 0.15, modes: plate.slice(3) }), (HEEL + rng.range(0.018, 0.06)) * fs, rng.range(0.08, 0.18));
  }
  biquad(out, 'lp', 9000, 0.7, fs);
  return out;
}

export function stepCarpet(fs: number, rng: Rng): Buf {
  const out = buf(0.36 * fs);
  const toe = toeAt(rng, 0.08, 0.12);
  thumpInto(out, fs, rng, HEEL, 220, 40, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(4, 6), modes: modes(rng.range(75, 95), [1, 1.8, 2.7], 0.05, [1, 0.6, 0.4], rng, 0.05) }), HEEL * fs, 0.5);
  swishInto(out, fs, rng, HEEL, rng.range(0.07, 0.1), 300, 1800, 0.22, 0.3, 0.3);
  thumpInto(out, fs, rng, toe, 260, 28, 0.45);
  swishInto(out, fs, rng, toe, rng.range(0.06, 0.09), 400, 2000, 0.16, 0.3, 0.3);
  biquad(out, 'lp', 2600, 0.7, fs);
  return out;
}

// ------------------------------------------------------------------------------- loose / natural ground

export function stepGravel(fs: number, rng: Rng): Buf {
  const out = buf(0.5 * fs);
  const pebbles = pool(36, () => tick(fs, rng, 1400, 6500, 0.003, 0.014, 2));
  const low = pool(12, () => tick(fs, rng, 450, 1500, 0.005, 0.02, 2));
  const toe = toeAt(rng, 0.09, 0.14);
  const sh = strike(4, 25);
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.15, count: rng.int(110, 170), grains: pebbles, amp: 0.5, ampPow: 2.2, shape: sh });
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.12, count: rng.int(15, 30), grains: low, amp: 0.5, ampPow: 2, shape: sh });
  scatter(out, fs, rng, { t0: toe, t1: toe + 0.13, count: rng.int(70, 120), grains: pebbles, amp: 0.38, ampPow: 2.2, shape: sh });
  const n = out.length;
  const e = envelope(n, fs, [[0, 0], [HEEL + 0.01, 1], [HEEL + 0.08, 0.35], [toe, 0.3], [toe + 0.01, 0.7], [toe + 0.12, 0.1], [0.5, 0]]);
  const bed = white(n, rng);
  band(bed, 700, 4500, fs);
  mulInto(bed, e);
  normalizePeak(bed, 1);
  addAt(out, bed, 0, 0.16);
  thumpInto(out, fs, rng, HEEL, 140, 40, 0.5);
  return out;
}

export function stepGrass(fs: number, rng: Rng): Buf {
  const out = buf(0.42 * fs);
  const toe = toeAt(rng, 0.08, 0.12);
  swishInto(out, fs, rng, HEEL, rng.range(0.16, 0.22), 1500, 7500, 0.6, 0.18, 0.45, 220);
  swishInto(out, fs, rng, toe, rng.range(0.12, 0.16), 1800, 7500, 0.4, 0.2, 0.45, 220);
  const blades = pool(16, () => crackle(fs, rng, 0.2, 0.7, 2000, 7000));
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.2, count: rng.int(25, 45), grains: blades, amp: 0.3, ampPow: 2, shape: strike(3, 15) });
  thumpInto(out, fs, rng, HEEL, 140, 35, 0.55);
  thumpInto(out, fs, rng, toe, 160, 25, 0.25);
  return out;
}

export function stepLeaves(fs: number, rng: Rng): Buf {
  const out = buf(0.52 * fs);
  const toe = toeAt(rng, 0.09, 0.13);
  const cr = pool(30, () => crackle(fs, rng, 0.15, 1.2, 1200, 9000));
  const crisp = pool(12, () => {
    const g = buf(0.008 * fs);
    const k = rng.int(3, 6);
    for (let i = 0; i < k; i++) addBurst(g, rng.range(0, 0.005) * fs, rng.range(0.1, 0.4), rng.range(0.4, 1), rng, fs);
    band(g, 1500, 9000, fs);
    return normalizePeak(g, 1);
  });
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.24, count: rng.int(70, 120), grains: cr, amp: 0.5, ampPow: 2.5, shape: strike(3.5, 20) });
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.2, count: rng.int(10, 20), grains: crisp, amp: 0.6, ampPow: 1.6, shape: strike(3, 20) });
  scatter(out, fs, rng, { t0: toe, t1: toe + 0.18, count: rng.int(40, 80), grains: cr, amp: 0.38, ampPow: 2.5, shape: strike(3.5, 20) });
  swishInto(out, fs, rng, HEEL, rng.range(0.18, 0.24), 900, 5000, 0.22, 0.15, 0.4, 120);
  if (rng.chance(0.35)) {
    const ts = HEEL + rng.range(0.01, 0.08);
    addAt(out, tick(fs, rng, 1200, 2600, 0.01, 0.025, 2), ts * fs, rng.range(0.4, 0.7));
    addAt(out, crackle(fs, rng, 0.5, 1.5, 800, 8000), ts * fs, 0.4);
  }
  thumpInto(out, fs, rng, HEEL, 130, 35, 0.5);
  return out;
}

export function stepMud(fs: number, rng: Rng): Buf {
  const out = buf(0.62 * fs);
  thumpInto(out, fs, rng, HEEL, 180, 45, 0.9);
  scuffInto(out, fs, rng, HEEL, 0.02, 500, 2500, 0.3, 0.1);
  // squelch: viscous resonant sweep (the foot sinking / mud closing around it)
  const sweep = (t0: number, sd: number, f0: number, f1: number, f2: number, q: number, amp: number) => {
    const n = Math.round(sd * fs);
    const fc = curve(n, fs, [[0, f0], [sd * 0.6, f1], [sd, f2]]);
    const s = white(n, rng);
    svf(s, fc, q, fs, BP);
    const am = smoothRandom(n, fs, 70, rng);
    const e = envelope(n, fs, [[0, 0], [0.025, 1], [sd * 0.7, 0.6], [sd, 0]]);
    for (let i = 0; i < n; i++) s[i] *= e[i] * (0.55 + 0.45 * am[i]);
    normalizePeak(s, 1);
    addAt(out, s, t0 * fs, amp);
  };
  sweep(HEEL + 0.01, rng.range(0.16, 0.26), rng.range(220, 320), rng.range(600, 900), rng.range(900, 1300), rng.range(5, 9), 0.6);
  // suction release when the foot lifts
  const tr = rng.range(0.28, 0.42);
  sweep(tr - 0.04, rng.range(0.09, 0.14), rng.range(450, 650), rng.range(1000, 1500), rng.range(1300, 1800), 6, 0.35);
  addAt(out, bubble(fs, rng.range(180, 320), { rise: rng.range(0.5, 0.8), tau: rng.range(0.02, 0.035) }), tr * fs, 0.5);
  const nb = rng.int(3, 7);
  for (let k = 0; k < nb; k++) {
    addAt(out, bubble(fs, rng.logRange(350, 1400), { rise: rng.range(0.1, 0.4) }), rng.range(0.05, 0.45) * fs, rng.range(0.12, 0.3));
  }
  return out;
}

export function stepWater(fs: number, rng: Rng): Buf {
  const out = buf(0.62 * fs);
  const toe = toeAt(rng, 0.09, 0.13);
  const splash = (t: number, a: number, drops: number) => {
    const sl = buf(0.012 * fs);
    addBurst(sl, 0, rng.range(5, 9), 1, rng, fs);
    band(sl, 300, 4000, fs);
    normalizePeak(sl, 1);
    addAt(out, sl, t * fs, 0.7 * a);
    scuffInto(out, fs, rng, t + 0.003, rng.range(0.16, 0.24), 900, 9000, 0.4 * a, 0.05);
    for (let k = 0; k < drops; k++) {
      const dt = 0.01 + Math.min(0.35, -Math.log(1 - rng.next()) * 0.08);
      addAt(out, bubble(fs, rng.logRange(500, 3500), { rise: rng.range(0.15, 0.5) }), (t + dt) * fs, a * rng.range(0.12, 0.42));
    }
  };
  splash(HEEL, 1, rng.int(12, 24));
  splash(toe, 0.5, rng.int(5, 10));
  thumpInto(out, fs, rng, HEEL, 150, 35, 0.4);
  return out;
}

export function stepHay(fs: number, rng: Rng): Buf {
  const out = buf(0.56 * fs);
  const toe = toeAt(rng, 0.1, 0.14);
  const fine = pool(30, () => crackle(fs, rng, 0.08, 0.5, 2500, 11000));
  scatter(out, fs, rng, { t0: HEEL, t1: HEEL + 0.3, count: rng.int(250, 380), grains: fine, amp: 0.4, ampPow: 2.4, shape: strike(3, 12) });
  scatter(out, fs, rng, { t0: toe, t1: toe + 0.2, count: rng.int(120, 200), grains: fine, amp: 0.3, ampPow: 2.4, shape: strike(3, 12) });
  swishInto(out, fs, rng, HEEL, 0.28, 1800, 8000, 0.25, 0.15, 0.5, 200);
  thumpInto(out, fs, rng, HEEL, 110, 50, 0.45);
  return out;
}

export function glassCrunch(fs: number, rng: Rng): Buf {
  const out = buf(0.45 * fs);
  const shards = pool(24, () => tick(fs, rng, 2500, 11000, 0.008, 0.04, 3));
  const dust = pool(16, () => crackle(fs, rng, 0.1, 0.4, 3000, 12000));
  scatter(out, fs, rng, { t0: 0.004, t1: 0.22, count: rng.int(40, 90), grains: shards, amp: 0.6, ampPow: 2, shape: strike(3, 30) });
  scatter(out, fs, rng, { t0: 0.004, t1: 0.2, count: rng.int(60, 120), grains: dust, amp: 0.3, ampPow: 2, shape: strike(3, 30) });
  scuffInto(out, fs, rng, 0.01, 0.12, 2500, 9000, 0.12);
  thumpInto(out, fs, rng, 0.004, 140, 25, 0.3);
  return out;
}

// ------------------------------------------------------------------------------- landings

export function landSoft(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  thumpInto(out, fs, rng, 0.004, 120, 90, 1);
  const t2 = rng.range(0.02, 0.05);
  thumpInto(out, fs, rng, t2, 140, 70, 0.6);
  addAt(out, hit(fs, rng, { contactMs: rng.range(7, 10), modes: modes(rng.range(50, 60), [1, 1.7, 2.6], 0.1, [1, 0.6, 0.4], rng, 0.05) }), 0.004 * fs, 0.6);
  const cr = pool(16, () => crackle(fs, rng, 0.15, 1, 1200, 8000));
  scatter(out, fs, rng, { t0: 0.004, t1: 0.25, count: rng.int(40, 70), grains: cr, amp: 0.25, ampPow: 2.5, shape: strike(4, 20) });
  swishInto(out, fs, rng, 0, 0.14, 900, 4000, 0.16, 0.2, 0.3);
  return out;
}

export function landHard(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  const m = modes(rng.range(100, 125), [1, 1.9, 3, 4.7, 7.3, 11.4, 17.2], [0.12, 0.1, 0.08, 0.06, 0.045, 0.035, 0.025], [1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18], rng, 0.06);
  addAt(out, hit(fs, rng, { contactMs: rng.range(1.5, 2.5), modes: m, click: 0.4, clickMs: 1, thud: 0.8, thudHz: 150, thudMs: 40 }), 0.004 * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: rng.range(1.5, 2.5), modes: m, click: 0.3, clickMs: 1, thud: 0.6, thudHz: 150, thudMs: 35 }), (0.004 + rng.range(0.015, 0.035)) * fs, rng.range(0.6, 0.8));
  swishInto(out, fs, rng, 0, 0.12, 900, 4000, 0.15, 0.2, 0.3);
  lp1(out, 9000, fs);
  return out;
}
