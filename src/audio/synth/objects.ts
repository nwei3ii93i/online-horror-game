/**
 * Doors, furniture and handled objects. Impacts are modal (contact pulse → modes), hinges
 * and runners are stick–slip friction through hinge + panel resonances, small metal parts
 * are short inharmonic clicks.
 */
import {
  type Buf, type Mode, Rng, addAt, addPulse, biquad, buf, crackle, curve, hit, modal, modes,
  normalizePeak, pool, poissonTimes, scatter, scuffInto, smoothRandom, svf, tick, white, BP, band, mulInto,
  envelope, withReverb, trimTail,
} from '../dsp';
import { bell, creakLayer, doorModes, metalClickInto, muffle, strike, swishInto, thumpInto } from './kit';

// ------------------------------------------------------------------------------- doors

export function doorOpenCreak(fs: number, rng: Rng, v: number): Buf {
  const style = v % 3;
  const dur = style === 2 ? rng.range(2.2, 2.8) : rng.range(1.5, 2.2);
  const out = buf((dur + 0.35) * fs);
  metalClickInto(out, fs, rng, 0.01, 0.45, 1500, 2100, 0.03);
  metalClickInto(out, fs, rng, 0.05 + rng.range(0, 0.03), 0.25, 1700, 2400, 0.02);
  const t0 = 0.12 + rng.range(0, 0.1);
  const cd = dur - t0 - 0.05;
  const hinge = modes(rng.range(1000, 1350), [1, 1.62, 2.38, 3.3, 4.6], [0.06, 0.05, 0.04, 0.03, 0.02], [1, 0.8, 0.6, 0.4, 0.25], rng, 0.05);
  const body = doorModes(rng, rng.range(88, 112), 0.85);
  const m = [...hinge, ...body];
  let c: Buf;
  if (style === 0) {
    c = creakLayer(fs, rng, {
      dur: cd,
      rate: [[0, 35], [cd * 0.2, 70], [cd * 0.42, rng.range(160, 260)], [cd * 0.58, rng.range(300, 450)], [cd * 0.8, rng.range(120, 200)], [cd, 60]],
      amp: [[0, 0], [cd * 0.12, 0.8], [cd * 0.5, 1], [cd * 0.85, 0.7], [cd, 0]],
      jitter: 0.12, modes: m, grit: 0.08, pulseMs: 0.25,
    });
  } else if (style === 1) {
    c = creakLayer(fs, rng, {
      dur: cd,
      rate: [[0, 280], [cd * 0.3, rng.range(480, 560)], [cd * 0.45, 380], [cd * 0.6, 300], [cd * 0.85, rng.range(540, 650)], [cd, 450]],
      amp: [[0, 0], [cd * 0.1, 1], [cd * 0.4, 0.7], [cd * 0.55, 0.15], [cd * 0.7, 0.9], [cd * 0.9, 0.6], [cd, 0]],
      jitter: 0.04, modes: m, grit: 0.05, pulseMs: 0.2, wobble: 0.04,
    });
  } else {
    c = creakLayer(fs, rng, {
      dur: cd,
      rate: [[0, 18], [cd * 0.3, 45], [cd * 0.6, rng.range(70, 95)], [cd, 30]],
      amp: [[0, 0], [cd * 0.2, 1], [cd * 0.75, 0.85], [cd, 0]],
      jitter: 0.3, modes: m, grit: 0.1, pulseMs: 0.45,
    });
  }
  addAt(out, c, t0 * fs, 1);
  // air moved by the swinging door
  const wn = Math.round(cd * fs);
  const w = white(wn, rng);
  band(w, 50, 380, fs);
  mulInto(w, curve(wn, fs, [[0, 0], [cd * 0.5, 1], [cd, 0]]));
  normalizePeak(w, 1);
  addAt(out, w, t0 * fs, 0.1);
  return out;
}

export function doorClose(fs: number, rng: Rng, v: number): Buf {
  const hard = v === 3;
  const out = buf(1.15 * fs);
  const ti = rng.range(0.13, 0.18);
  const wn = Math.round(ti * fs);
  const w = white(wn, rng);
  band(w, 50, 320, fs);
  mulInto(w, envelope(wn, fs, [[0, 0], [ti * 0.85, 1], [ti, 0.2]]));
  normalizePeak(w, 1);
  addAt(out, w, 0, 0.18);
  const dm = doorModes(rng);
  addAt(out, hit(fs, rng, { contactMs: hard ? rng.range(1, 1.4) : rng.range(1.8, 2.6), modes: dm, click: 0.3, clickMs: 1.2, thud: 0.7, thudHz: 180, thudMs: 50 }), ti * fs, 1);
  metalClickInto(out, fs, rng, ti + rng.range(0.004, 0.012), 0.35);
  metalClickInto(out, fs, rng, ti + rng.range(0.03, 0.06), 0.18, 2200, 3200, 0.015);
  const nr = rng.int(2, 3);
  for (let k = 0; k < nr; k++) {
    addAt(out, hit(fs, rng, { contactMs: 1, modes: dm.slice(2) }), (ti + rng.range(0.05, 0.16)) * fs, rng.range(0.08, 0.18));
  }
  return out;
}

export function doorLocked(fs: number, rng: Rng): Buf {
  const out = buf(1.5 * fs);
  metalClickInto(out, fs, rng, 0.02, 0.4, 1800, 2600, 0.03);
  scuffInto(out, fs, rng, 0.03, 0.08, 3000, 7000, 0.07);
  const dm = doorModes(rng, rng.range(80, 100), 0.6);
  const bolt = modes(rng.range(1700, 2100), [1, 1.55, 2.3, 3.2], [0.03, 0.025, 0.02, 0.015], [1, 0.7, 0.5, 0.3], rng, 0.05);
  const n = rng.int(2, 4);
  let t = 0.12;
  let a = 1;
  for (let k = 0; k < n; k++) {
    t += rng.range(0.09, 0.16);
    addAt(out, hit(fs, rng, { contactMs: 0.15, modes: bolt, click: 0.4, clickMs: 0.4, clickHp: 2500 }), t * fs, 0.65 * a);
    addAt(out, hit(fs, rng, { contactMs: rng.range(1.2, 1.7), modes: dm, click: 0.2, thud: 0.4, thudHz: 200, thudMs: 25 }), (t + 0.001) * fs, 0.9 * a);
    addAt(out, hit(fs, rng, { contactMs: 1.4, modes: dm.slice(1) }), (t + rng.range(0.018, 0.03)) * fs, 0.3 * a);
    a *= rng.range(0.75, 0.95);
  }
  metalClickInto(out, fs, rng, t + rng.range(0.1, 0.16), 0.3, 1800, 2600, 0.03);
  return out;
}

export function doorUnlock(fs: number, rng: Rng): Buf {
  const out = buf(1.3 * fs);
  // key insertion: thin scrape with pin clicks
  const ins = rng.range(0.16, 0.24);
  scuffInto(out, fs, rng, 0.02, ins, 3500, 9000, 0.12, 0.2);
  const pins = rng.int(4, 6);
  for (let k = 0; k < pins; k++) addAt(out, tick(fs, rng, 3500, 7000, 0.004, 0.01, 2), (0.03 + (ins * (k + rng.range(0.6, 1))) / pins) * fs, rng.range(0.15, 0.28));
  metalClickInto(out, fs, rng, 0.03 + ins, 0.3, 2400, 3200, 0.015);
  // turning: short friction squeak in the cylinder
  const ts = 0.03 + ins + rng.range(0.12, 0.22);
  const td = rng.range(0.15, 0.25);
  const sq = creakLayer(fs, rng, {
    dur: td, rate: [[0, rng.range(200, 260)], [td, rng.range(320, 400)]], amp: [[0, 0], [td * 0.3, 1], [td, 0.6]],
    jitter: 0.08, modes: modes(rng.range(1500, 1800), [1, 1.6, 2.4], 0.02, [1, 0.6, 0.4], rng, 0.05), pulseMs: 0.15,
  });
  addAt(out, sq, ts * fs, 0.22);
  // bolt retracts: clunk
  const tc = ts + td;
  const boltM = modes(rng.range(550, 700), [1, 1.8, 2.9, 4.3, 6.1, 8.2], [0.06, 0.05, 0.04, 0.03, 0.025, 0.02], [1, 0.8, 0.65, 0.5, 0.35, 0.25], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 0.3, modes: boltM, click: 0.4, clickMs: 0.6, clickHp: 2000 }), tc * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: 1.2, modes: doorModes(rng, rng.range(80, 100), 0.5), thud: 0.4, thudHz: 200, thudMs: 25 }), tc * fs, 0.6);
  addAt(out, tick(fs, rng, 2500, 4500, 0.006, 0.012, 2), (tc + rng.range(0.01, 0.02)) * fs, 0.2);
  return out;
}

export function doorSlamDistant(fs: number, rng: Rng): Buf {
  const dry = buf(0.6 * fs);
  const dm = doorModes(rng, rng.range(55, 70), 1.2);
  addAt(dry, hit(fs, rng, { contactMs: rng.range(2, 3), modes: dm, click: 0.15, clickMs: 1.5, thud: 1, thudHz: 200, thudMs: 60 }), 0.005 * fs, 1);
  metalClickInto(dry, fs, rng, 0.015, 0.08);
  addAt(dry, hit(fs, rng, { contactMs: 1.5, modes: dm.slice(2) }), rng.range(0.06, 0.12) * fs, 0.12);
  muffle(dry, fs, rng.range(800, 1100));
  biquad(dry, 'hp', 35, 0.7, fs);
  const out = withReverb(dry, fs, rng.range(0.8, 1.1), { rt60: rng.range(1.5, 2.1), damp: 1200, pre: 0.025, tail: 2.2, size: 1.3 });
  return trimTail(out, fs, 2e-4, 40);
}

// ------------------------------------------------------------------------------- furniture

function drawerSlide(fs: number, rng: Rng, out: Buf, t0: number, sd: number, r0: number, r1: number, amp: number): void {
  const wood = modes(rng.range(280, 360), [1, 1.7, 2.6, 3.9, 5.8, 8.3], [0.03, 0.025, 0.02, 0.018, 0.015, 0.012], [1, 0.8, 0.65, 0.5, 0.35, 0.25], rng, 0.06);
  const c = creakLayer(fs, rng, {
    dur: sd, rate: [[0, r0], [sd * 0.4, r1], [sd, r0 * 0.8]], amp: [[0, 0], [0.04, 1], [sd * 0.6, 0.8], [sd, 0.25]],
    jitter: 0.5, modes: wood, grit: 0.3, gritHz: 1800, flutter: 0.5, pulseMs: 0.4,
  });
  addAt(out, c, t0 * fs, amp);
  swishInto(out, fs, rng, t0, sd, 400, 2500, amp * 0.3, 0.1, 0.5, 60);
}

function drawerContents(fs: number, rng: Rng, out: Buf, t0: number, t1: number, count: number, amp: number): void {
  for (let k = 0; k < count; k++) addAt(out, tick(fs, rng, 1500, 5000, 0.008, 0.03, 2), rng.range(t0, t1) * fs, amp * rng.range(0.3, 1));
}

export function drawerOpen(fs: number, rng: Rng): Buf {
  const out = buf(0.85 * fs);
  const sd = rng.range(0.32, 0.5);
  drawerSlide(fs, rng, out, 0.02, sd, rng.range(80, 120), rng.range(150, 220), 0.7);
  const box = modes(rng.range(170, 210), [1, 1.8, 3, 4.7, 7.1], [0.05, 0.04, 0.03, 0.025, 0.02], [1, 0.8, 0.6, 0.45, 0.3], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 1.8, modes: box, click: 0.2, thud: 0.3, thudHz: 200, thudMs: 20 }), (0.02 + sd) * fs, 0.8);
  drawerContents(fs, rng, out, 0.05, 0.03 + sd + 0.08, rng.int(3, 6), 0.22);
  return out;
}

export function drawerClose(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  const sd = rng.range(0.2, 0.32);
  drawerSlide(fs, rng, out, 0.01, sd, rng.range(120, 170), rng.range(200, 280), 0.6);
  const box = modes(rng.range(150, 190), [1, 1.8, 3, 4.7, 7.1], [0.06, 0.05, 0.035, 0.028, 0.02], [1, 0.8, 0.6, 0.45, 0.3], rng, 0.05);
  const tb = 0.01 + sd;
  addAt(out, hit(fs, rng, { contactMs: 1.5, modes: box, click: 0.3, thud: 0.6, thudHz: 180, thudMs: 30 }), tb * fs, 1);
  drawerContents(fs, rng, out, tb + 0.005, tb + 0.08, rng.int(2, 5), 0.25);
  return out;
}

export function wardrobeOpen(fs: number, rng: Rng): Buf {
  const cd = rng.range(0.8, 1.3);
  const out = buf((cd + 0.7) * fs);
  metalClickInto(out, fs, rng, 0.02, 0.35, 1400, 2000, 0.03);
  const panel = modes(rng.range(115, 145), [1, 1.6, 2.5, 3.6, 5.4, 7.9, 11.6], [0.2, 0.18, 0.15, 0.12, 0.09, 0.07, 0.05], [0.35, 0.75, 0.9, 0.8, 0.6, 0.4, 0.25], rng, 0.05);
  const hinge = modes(rng.range(900, 1100), [1, 1.6, 2.5], 0.04, [0.35, 0.25, 0.15], rng, 0.05);
  const c = creakLayer(fs, rng, {
    dur: cd, rate: [[0, 25], [cd * 0.4, rng.range(60, 80)], [cd, 40]], amp: [[0, 0], [cd * 0.2, 1], [cd * 0.8, 0.7], [cd, 0]],
    jitter: 0.25, modes: [...panel, ...hinge], grit: 0.06, pulseMs: 0.5,
  });
  addAt(out, c, 0.1 * fs, 0.9);
  const hanger = modes(rng.range(1800, 2400), [1, 1.73, 2.69, 3.8], [0.25, 0.2, 0.15, 0.1], [1, 0.6, 0.45, 0.3], rng, 0.08);
  const nh = rng.int(2, 5);
  for (let k = 0; k < nh; k++) {
    const t = rng.range(0.35, 0.3 + cd);
    addAt(out, hit(fs, rng, { contactMs: 0.08, modes: hanger }), t * fs, rng.range(0.1, 0.22));
    if (rng.chance(0.5)) addAt(out, hit(fs, rng, { contactMs: 0.08, modes: hanger }), (t + rng.range(0.03, 0.08)) * fs, rng.range(0.05, 0.12));
  }
  swishInto(out, fs, rng, 0.1, cd, 50, 280, 0.14, 0.5, 0.1, 5);
  return out;
}

export function latch(fs: number, rng: Rng): Buf {
  const out = buf(0.42 * fs);
  const lift = modes(rng.range(1600, 2000), [1, 1.6, 2.4, 3.3], [0.04, 0.03, 0.025, 0.02], [1, 0.7, 0.5, 0.3], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 0.15, modes: lift, click: 0.4, clickMs: 0.4, clickHp: 2500 }), 0.01 * fs, 0.5);
  const td = rng.range(0.07, 0.16);
  const drop = modes(rng.range(850, 1050), [1, 1.68, 2.6, 3.8, 5.3], [0.07, 0.06, 0.045, 0.035, 0.025], [1, 0.8, 0.6, 0.45, 0.3], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 0.25, modes: drop, click: 0.5, clickMs: 0.5, clickHp: 2000 }), td * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: 1, modes: modes(rng.range(110, 140), [1, 2.2, 3.9], 0.04, [1, 0.6, 0.4], rng, 0.05), thud: 0.3, thudHz: 220, thudMs: 15 }), td * fs, 0.4);
  return out;
}

export function gateIronCreak(fs: number, rng: Rng, v: number): Buf {
  const style = v % 3;
  const dur = rng.range(2.4, 3.4);
  const out = buf((dur + 0.9) * fs);
  const gate: Mode[] = [
    ...modes(rng.range(380, 460), [1, 1.71, 2.53, 3.48, 4.62, 5.96, 7.4], [0.5, 0.42, 0.35, 0.3, 0.24, 0.18, 0.14], [0.6, 0.8, 0.7, 0.6, 0.45, 0.35, 0.25], rng, 0.04),
    ...modes(rng.range(110, 140), [1, 2.756, 5.404], [0.6, 0.4, 0.3], [0.5, 0.4, 0.3], rng, 0.03),
  ];
  const hinge = modes(rng.range(1400, 1900), [1, 1.5, 2.2], 0.05, [0.8, 0.5, 0.3], rng, 0.05);
  const m = [...gate, ...hinge];
  let rate: ReadonlyArray<readonly [number, number]>;
  let jitter: number;
  if (style === 0) {
    rate = [[0, 12], [dur * 0.25, 40], [dur * 0.4, 25], [dur * 0.5, rng.range(280, 380)], [dur * 0.62, 30], [dur, 20]];
    jitter = 0.3;
  } else if (style === 1) {
    rate = [[0, 300], [dur * 0.3, rng.range(380, 440)], [dur * 0.7, 300], [dur, 240]];
    jitter = 0.05;
  } else {
    rate = [[0, 20], [dur * 0.4, 60], [dur * 0.5, rng.range(320, 380)], [dur, 250]];
    jitter = 0.12;
  }
  const c = creakLayer(fs, rng, {
    dur, rate, amp: [[0, 0], [dur * 0.15, 1], [dur * 0.6, 0.85], [dur * 0.9, 0.6], [dur, 0]],
    jitter, modes: m, grit: 0.12, pulseMs: 0.3,
  });
  addAt(out, c, 0.02 * fs, 1);
  if (rng.chance(0.6)) addAt(out, hit(fs, rng, { contactMs: 0.4, modes: gate, click: 0.3 }), (dur + 0.05) * fs, 0.6);
  return out;
}

// ------------------------------------------------------------------------------- impacts

export function metalClank(fs: number, rng: Rng, v: number): Buf {
  const style = v % 4;
  const out = buf(1.5 * fs);
  if (style === 0) {
    const m = modes(rng.range(320, 480), [1, 2.756, 5.404, 8.933, 13.34], [1.1, 0.8, 0.55, 0.35, 0.25], [1, 0.8, 0.6, 0.4, 0.25], rng, 0.02);
    addAt(out, hit(fs, rng, { contactMs: 0.25, modes: m, click: 0.4, clickMs: 0.4, clickHp: 2500 }), 0.005 * fs, 1);
  } else if (style === 1) {
    const m = [
      ...modes(rng.range(330, 420), [1, 1.43, 1.92, 2.41, 2.98, 3.55, 4.4, 5.6, 7.1], [0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.16, 0.12, 0.1], [0.8, 1, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, 0.2], rng, 0.04),
      ...modes(rng.range(150, 190), [1], 0.2, 0.7),
    ];
    addAt(out, hit(fs, rng, { contactMs: 0.4, modes: m, click: 0.3, thud: 0.3, thudHz: 200 }), 0.005 * fs, 1);
    addAt(out, hit(fs, rng, { contactMs: 0.5, modes: m }), rng.range(0.1, 0.16) * fs, 0.25);
  } else if (style === 2) {
    const m = modes(rng.range(85, 110), [1, 1.37, 1.81, 2.25, 2.9, 3.6, 4.5, 5.7, 7.3, 9.2, 12], [0.5, 0.45, 0.4, 0.35, 0.3, 0.26, 0.22, 0.18, 0.15, 0.13, 0.12], [0.7, 0.9, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25], rng, 0.05);
    addAt(out, hit(fs, rng, { contactMs: 0.8, modes: m, click: 0.25, thud: 0.4, thudHz: 150, thudMs: 30 }), 0.005 * fs, 1);
    for (let k = 0; k < 3; k++) addAt(out, hit(fs, rng, { contactMs: 0.2, modes: m.slice(5) }), rng.range(0.03, 0.2) * fs, rng.range(0.08, 0.18));
  } else {
    const m = modes(rng.range(900, 1300), [1, 2.76, 5.4, 8.9], [0.25, 0.18, 0.12, 0.08], [1, 0.7, 0.5, 0.3], rng, 0.03);
    const exc = buf(out.length);
    let t = 0.005, iv = rng.range(0.07, 0.11), a = 1;
    for (let k = 0; k < 3; k++) {
      addPulse(exc, t * fs, 0.12, a, fs);
      t += iv;
      iv *= rng.range(0.45, 0.6);
      a *= rng.range(0.35, 0.5);
    }
    addAt(out, normalizePeak(modal(exc, m, fs), 1), 0, 1);
    addAt(out, crackle(fs, rng, 0.2, 0.5, 1500, 9000), 0.005 * fs, 0.3);
  }
  return trimTail(out, fs, 3e-4);
}

export function woodKnock(fs: number, rng: Rng): Buf {
  const out = buf(0.45 * fs);
  const dm = modes(rng.range(95, 125), [1, 1.72, 2.6, 3.9, 5.6, 7.9, 11.2], [0.12, 0.1, 0.085, 0.07, 0.055, 0.04, 0.03], [0.5, 0.8, 0.9, 0.8, 0.6, 0.4, 0.25], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: rng.range(1, 1.5), modes: dm, click: 0.25, clickMs: 0.6, clickHp: 1200, thud: 0.2, thudHz: 250, thudMs: 15 }), 0.005 * fs, 1);
  return out;
}

function bounceSeq(fs: number, rng: Rng, exc: Buf, t0: number, n: number, iv0: number, e: number, contact: [number, number]): number {
  let t = t0, iv = iv0, a = 1;
  for (let k = 0; k < n; k++) {
    addPulse(exc, t * fs, rng.range(contact[0], contact[1]), a * rng.range(0.85, 1.1), fs);
    t += iv;
    iv *= e * rng.range(0.9, 1.1);
    a *= Math.pow(e, 0.7) * rng.range(0.85, 1.05);
  }
  return t;
}

export function objectDropWood(fs: number, rng: Rng): Buf {
  const out = buf(1.1 * fs);
  const obj = modes(rng.range(450, 900), [1, 1.58, 2.31, 3.4, 4.7], [0.06, 0.05, 0.04, 0.03, 0.02], [1, 0.7, 0.55, 0.4, 0.25], rng, 0.06);
  const floor = modes(rng.range(90, 120), [1, 1.9, 2.8], [0.08, 0.06, 0.05], [0.7, 0.5, 0.35], rng, 0.05);
  const exc = buf(out.length);
  const tEnd = bounceSeq(fs, rng, exc, 0.01, rng.int(3, 5), rng.range(0.12, 0.2), rng.range(0.35, 0.55), [0.6, 1]);
  const nt = rng.int(3, 6);
  for (let k = 0; k < nt; k++) addPulse(exc, (tEnd + k * rng.range(0.01, 0.02)) * fs, 0.5, 0.15 * (1 - k / nt), fs);
  const ring = normalizePeak(modal(exc, [...obj, ...floor], fs), 1);
  addAt(out, ring, 0, 1);
  thumpInto(out, fs, rng, 0.01, 180, 25, 0.35);
  addAt(out, crackle(fs, rng, 0.3, 0.8, 1500, 6000), 0.01 * fs, 0.25);
  return out;
}

export function objectDropMetal(fs: number, rng: Rng): Buf {
  const out = buf(1.6 * fs);
  const obj = modes(rng.range(500, 900), [1, 1.49, 2.17, 2.93, 3.71, 4.84, 6.2], [0.6, 0.5, 0.42, 0.35, 0.28, 0.2, 0.15], [1, 0.8, 0.7, 0.6, 0.45, 0.35, 0.25], rng, 0.05);
  const obj2 = obj.map((m) => ({ ...m, a: m.a * rng.range(0.2, 1.2) }));
  const excA = buf(out.length);
  const excB = buf(out.length);
  let t = 0.01, a = 1;
  const nb = rng.int(3, 5);
  for (let k = 0; k < nb; k++) {
    addPulse(k % 2 ? excB : excA, t * fs, rng.range(0.15, 0.3), a, fs);
    t += rng.range(0.06, 0.18) * Math.pow(0.8, k);
    a *= rng.range(0.4, 0.7);
  }
  const roll = rng.range(0.2, 0.5);
  const times = poissonTimes(roll, (x) => 90 * (1 - x / roll), 90, rng);
  for (const x of times) addPulse(rng.chance(0.5) ? excA : excB, (t + x) * fs, 0.1, a * 0.35 * rng.next() * (1 - x / roll), fs);
  const ring = modal(excA, obj, fs);
  modal(excB, obj2, fs, ring);
  normalizePeak(ring, 1);
  addAt(out, ring, 0, 1);
  addAt(out, crackle(fs, rng, 0.2, 0.5, 2000, 9000), 0.01 * fs, 0.3);
  return trimTail(out, fs, 3e-4);
}

// ------------------------------------------------------------------------------- handling

export function paperRustle(fs: number, rng: Rng): Buf {
  const dur = rng.range(0.7, 1);
  const out = buf((dur + 0.05) * fs);
  const grains = pool(24, () => crackle(fs, rng, 0.08, 0.7, 900, 9000));
  const n = out.length;
  const dens = buf(n);
  const m = rng.int(10, 18);
  for (let c = 0; c < m; c++) {
    const center = rng.range(0.03, dur - 0.05);
    const spread = rng.range(0.005, 0.035);
    const a = rng.range(0.3, 1);
    scatter(out, fs, rng, { t0: center - spread, t1: center + spread, count: rng.int(6, 25), grains, amp: a, ampPow: 1.8, shape: bell });
    const ci = center * fs, w = spread * fs * 2.5;
    for (let i = Math.max(0, Math.floor(ci - w * 3)); i < Math.min(n, ci + w * 3); i++) dens[i] += a * Math.exp(-(((i - ci) / w) ** 2));
  }
  const sw = white(n, rng);
  band(sw, 1500, 6000, fs);
  mulInto(sw, dens);
  normalizePeak(sw, 1);
  addAt(out, sw, 0, 0.18);
  return out;
}

export function pageTurn(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  const grains = pool(12, () => crackle(fs, rng, 0.08, 0.5, 1200, 8000));
  scatter(out, fs, rng, { t0: 0.005, t1: 0.06, count: rng.int(8, 15), grains, amp: 0.4, ampPow: 1.6 });
  const sd = rng.range(0.28, 0.38);
  const n = Math.round(sd * fs);
  const s = white(n, rng);
  svf(s, curve(n, fs, [[0, 1500], [sd * 0.5, rng.range(3300, 4200)], [sd, 2400]]), 0.9, fs, BP);
  const fl = smoothRandom(n, fs, 40, rng);
  const e = curve(n, fs, [[0, 0], [sd * 0.35, 1], [sd, 0]]);
  for (let i = 0; i < n; i++) s[i] *= e[i] * (0.75 + 0.25 * fl[i]);
  normalizePeak(s, 1);
  addAt(out, s, 0.04 * fs, 0.55);
  const tf = 0.04 + sd - 0.02;
  thumpInto(out, fs, rng, tf, 450, 22, 0.32);
  scatter(out, fs, rng, { t0: tf, t1: tf + 0.03, count: rng.int(6, 12), grains, amp: 0.3, ampPow: 1.5 });
  return out;
}

export function keyPickup(fs: number, rng: Rng): Buf {
  const out = buf(0.7 * fs);
  const keys = [0, 1, 2].map(() => modes(rng.range(2200, 3800), [1, 1.68, 2.53, 3.4], [0.12, 0.1, 0.07, 0.05], [1, 0.6, 0.45, 0.3], rng, 0.05));
  keys.push(modes(rng.range(3000, 4500), [1, 2.1, 3.3], 0.2, [1, 0.5, 0.3], rng, 0.05));
  const excs = keys.map(() => buf(out.length));
  const place = (t0: number, t1: number, k: number, a: number) => {
    for (let i = 0; i < k; i++) addPulse(rng.pick(excs), rng.range(t0, t1) * fs, rng.range(0.05, 0.1), a * rng.range(0.4, 1), fs);
  };
  place(0.01, 0.09, rng.int(3, 5), 1);
  place(0.14, 0.3, rng.int(2, 4), 0.6);
  const ring = buf(out.length);
  keys.forEach((m, i) => modal(excs[i], m, fs, ring));
  normalizePeak(ring, 1);
  addAt(out, ring, 0, 0.85);
  scuffInto(out, fs, rng, 0, 0.06, 2500, 8000, 0.1);
  swishInto(out, fs, rng, 0, 0.12, 700, 3500, 0.08, 0.3, 0.3);
  return out;
}

export function itemPickup(fs: number, rng: Rng): Buf {
  const out = buf(0.4 * fs);
  swishInto(out, fs, rng, 0, rng.range(0.1, 0.16), 700, 3500, 0.45, 0.35, 0.4, 90);
  const m = modes(rng.range(300, 700), [1, 1.6, 2.4], [0.04, 0.03, 0.02], [1, 0.6, 0.4], rng, 0.08);
  addAt(out, hit(fs, rng, { contactMs: 1.2, modes: m, click: 0.2, thud: 0.3, thudHz: 250, thudMs: 15 }), rng.range(0.02, 0.06) * fs, 0.6);
  swishInto(out, fs, rng, 0.12, 0.1, 400, 2000, 0.2, 0.3, 0.3);
  return out;
}

export function flashlightClick(fs: number, rng: Rng): Buf {
  const out = buf(0.25 * fs);
  const f = rng.range(2600, 3200);
  const plastic = modes(f, [1, 1.45, 2.1, 2.9], [0.012, 0.01, 0.008, 0.006], [1, 0.8, 0.6, 0.4], rng, 0.04);
  const body = modes(rng.range(700, 900), [1, 1.6], 0.015, [1, 0.5], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 0.06, modes: [...plastic, ...body], click: 0.6, clickMs: 0.3, clickHp: 2000 }), 0.004 * fs, 1);
  const p2 = plastic.map((m) => ({ ...m, f: m.f * 1.1 }));
  addAt(out, hit(fs, rng, { contactMs: 0.06, modes: [...p2, ...body], click: 0.5, clickMs: 0.25, clickHp: 2500 }), rng.range(0.07, 0.11) * fs, 0.55);
  return out;
}

export function switchClick(fs: number, rng: Rng): Buf {
  const out = buf(0.3 * fs);
  addAt(out, tick(fs, rng, 2000, 4000, 0.004, 0.008, 1), 0.01 * fs, 0.15);
  const snap = modes(rng.range(1400, 1800), [1, 1.55, 2.2, 3.1], [0.03, 0.025, 0.02, 0.015], [1, 0.75, 0.55, 0.35], rng, 0.05);
  const box = modes(rng.range(320, 400), [1, 2.1], 0.025, [1, 0.5], rng, 0.05);
  addAt(out, hit(fs, rng, { contactMs: 0.08, modes: snap, click: 0.5, clickMs: 0.3, clickHp: 2000 }), rng.range(0.025, 0.04) * fs, 1);
  addAt(out, hit(fs, rng, { contactMs: 0.3, modes: box }), rng.range(0.025, 0.04) * fs, 0.4);
  return out;
}

export function chainRattle(fs: number, rng: Rng): Buf {
  const dur = rng.range(1.2, 1.6);
  const out = buf((dur + 0.3) * fs);
  const groups = [0, 1, 2].map(() => modes(rng.range(1800, 3200), [1, 1.52, 2.3], [0.06, 0.05, 0.04], [1, 0.6, 0.4], rng, 0.05));
  const excs = groups.map(() => buf(out.length));
  const swings = rng.int(2, 3);
  const pts: [number, number][] = [[0, 0]];
  for (let s = 0; s < swings; s++) {
    const c = ((s + 0.5) / swings) * dur;
    pts.push([c - 0.12, 0.2], [c, 1 - s * 0.2], [c + 0.15, 0.25]);
  }
  pts.push([dur, 0]);
  const motion = curve(out.length, fs, pts);
  const times = poissonTimes(dur, (t) => 140 * motion[Math.min(motion.length - 1, Math.round(t * fs))], 140, rng);
  for (const t of times) {
    const mv = motion[Math.min(motion.length - 1, Math.round(t * fs))];
    addPulse(rng.pick(excs), t * fs, rng.range(0.05, 0.12), Math.pow(rng.next(), 1.5) * mv, fs);
  }
  const ring = buf(out.length);
  groups.forEach((m, i) => modal(excs[i], m, fs, ring));
  normalizePeak(ring, 1);
  addAt(out, ring, 0, 0.9);
  addAt(out, hit(fs, rng, { contactMs: 0.4, modes: modes(rng.range(350, 500), [1, 1.6, 2.5, 3.6], 0.12, [1, 0.7, 0.5, 0.3], rng, 0.05), click: 0.3 }), 0.01 * fs, 0.6);
  const dn = out.length;
  const drag = white(dn, rng);
  band(drag, 2000, 6000, fs);
  for (let i = 0; i < dn; i++) drag[i] *= motion[i] * motion[i];
  normalizePeak(drag, 1);
  addAt(out, drag, 0, 0.08);
  return out;
}

