import { TexBuilder, hex, mix3 } from '../TexBuilder';
import { clamp, smoothstep, lerp, fract, worleyResult, mulberry } from './util';
import { stamp, crackNetwork, idRand } from '../patterns';

/** Forest floor: dark humus, beech leaf litter, spruce needles, twigs and small stones (4 m tile). */
export function forestFloor(b: TexBuilder): void {
  const nz = b.noise;
  const rnd = mulberry(77);
  b.normalStrength = 2.2;
  b.cavity = 0.7;
  b.cavityRadius = 0.006;
  // soil base
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 16, 5) * 0.5 + 0.5;
    const big = nz.fbm(u, v, 3, 4) * 0.5 + 0.5;
    const c = mix3(hex('#2e241a'), hex('#4a3a2a'), f).map((x) => x * (0.8 + big * 0.3));
    b.setColor(i, c[0], c[1], c[2]);
    b.h[i] = f * 0.15;
    b.rough[i] = 0.9;
  });
  const leafCols = [hex('#6b4423'), hex('#7d5028'), hex('#5a3a1e'), hex('#8a5a2c'), hex('#4a3420'), hex('#6e5a3a'), hex('#3d2e1f')];
  // needles
  for (let k = 0; k < 9000; k++) {
    const cu = rnd(), cv = rnd(), ang = rnd() * Math.PI;
    const len = 0.0045 + rnd() * 0.003;
    const col = mix3(hex('#5b3d22'), hex('#7a5530'), rnd()).map((x) => x * (0.6 + rnd() * 0.5));
    const hgt = 0.2 + rnd() * 0.1;
    stamp(b, cu, cv, len, 0.00045, ang, (lx, ly, i) => {
      const d = lx * lx + ly * ly;
      if (d > 1) return;
      const t = 1 - d;
      if (b.h[i] < hgt + t * 0.02) {
        b.h[i] = hgt + t * 0.02;
        b.setColor(i, col[0], col[1], col[2]);
        b.rough[i] = 0.75;
      }
    });
  }
  // beech leaves (oval with tip, central vein)
  for (let k = 0; k < 1300; k++) {
    const cu = rnd(), cv = rnd(), ang = rnd() * Math.PI * 2;
    const len = 0.009 + rnd() * 0.006;
    const wid = len * (0.5 + rnd() * 0.15);
    const col = leafCols[Math.floor(rnd() * leafCols.length)].map((x) => x * (0.75 + rnd() * 0.4));
    const base = 0.3 + rnd() * 0.25;
    const curl = rnd() * 0.08;
    const rot = rnd() > 0.85; // partially decayed
    stamp(b, cu, cv, len, wid, ang, (lx, ly, i) => {
      // leaf outline: pointed at +x
      const shape = (lx * lx) + Math.pow(ly / (1 - Math.max(0, lx) * 0.55), 2);
      if (shape > 1) return;
      const edge = 1 - shape;
      const vein = 1 - smoothstep(0.0, 0.08, Math.abs(ly));
      const side = Math.abs(fract((lx + Math.abs(ly) * 0.8) * 4) - 0.5) < 0.06 ? 1 : 0;
      const hh = base + edge * 0.04 + curl * Math.abs(ly) * 0.5 + vein * 0.01;
      if (b.h[i] > hh) return;
      if (rot && nz.value(lx * 20 + cu * 999, ly * 20, 4096, 4096) > 0.6) return;
      b.h[i] = hh;
      const cc = col.map((x) => x * (1 - vein * 0.25 - side * 0.12) * (0.85 + edge * 0.2));
      b.setColor(i, cc[0], cc[1], cc[2]);
      b.rough[i] = 0.62 + rnd() * 0.0;
    });
  }
  // twigs
  for (let k = 0; k < 90; k++) {
    const cu = rnd(), cv = rnd(), ang = rnd() * Math.PI;
    const len = 0.02 + rnd() * 0.05, w = 0.0012 + rnd() * 0.0012;
    const col = mix3(hex('#3a2e24'), hex('#5c4b3b'), rnd());
    stamp(b, cu, cv, len, w, ang, (lx, ly, i) => {
      const d = lx * lx + ly * ly * 0 + ly * ly;
      if (Math.abs(lx) > 1 || Math.abs(ly) > 1) return;
      void d;
      const hh = 0.62 + (1 - ly * ly) * 0.08;
      if (b.h[i] > hh) return;
      b.h[i] = hh;
      const cc = col.map((x) => x * (0.7 + (1 - ly * ly) * 0.4));
      b.setColor(i, cc[0], cc[1], cc[2]);
      b.rough[i] = 0.85;
    });
  }
  // small stones
  for (let k = 0; k < 140; k++) {
    const cu = rnd(), cv = rnd();
    const r = 0.002 + rnd() * 0.004;
    const col = mix3(hex('#615d55'), hex('#8a857a'), rnd());
    stamp(b, cu, cv, r, r * (0.7 + rnd() * 0.3), rnd() * 3, (lx, ly, i) => {
      const d = lx * lx + ly * ly;
      if (d > 1) return;
      const hh = 0.35 + Math.sqrt(1 - d) * 0.25;
      if (b.h[i] > hh) return;
      b.h[i] = hh;
      b.setColor(i, col[0], col[1], col[2]);
      b.rough[i] = 0.7;
    });
  }
  // moss patches + general darkening
  b.each((u, v, i) => {
    const moss = smoothstep(0.55, 0.75, nz.fbm(u + 3, v + 3, 6, 5) * 0.5 + 0.5);
    if (moss > 0) {
      const m = nz.fbm(u, v, 120, 3) * 0.5 + 0.5;
      b.mixColor(i, hex('#2f3a1a').map((x) => x * (0.7 + m * 0.6)), moss * 0.85);
      b.h[i] = Math.max(b.h[i], 0.4 + m * 0.1) * moss + b.h[i] * (1 - moss);
      b.rough[i] = lerp(b.rough[i], 0.95, moss);
    }
    const damp = smoothstep(0.0, 0.8, nz.fbm(u + 9, v + 1, 4, 4));
    b.mulColor(i, 1 - damp * 0.25);
  });
}

/** Overgrown dead meadow grass (matted autumn grass over soil), 4 m tile. */
export function meadow(b: TexBuilder): void {
  const nz = b.noise;
  const rnd = mulberry(101);
  b.normalStrength = 2.0;
  b.cavity = 0.65;
  b.cavityRadius = 0.005;
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 20, 4) * 0.5 + 0.5;
    const c = mix3(hex('#2b2418'), hex('#3d3322'), f);
    b.setColor(i, c[0], c[1], c[2]);
    b.h[i] = f * 0.1;
    b.rough[i] = 0.95;
  });
  const greens = [hex('#4a5228'), hex('#5c5a2e'), hex('#6b6436'), hex('#7a6c42'), hex('#3b4422'), hex('#8a7a4e'), hex('#55502c')];
  for (let k = 0; k < 26000; k++) {
    const cu = rnd(), cv = rnd();
    // matted: dominant direction varies smoothly
    const flow = nz.fbm(cu, cv, 3, 3) * Math.PI * 1.5 + 0.5;
    const ang = flow + (rnd() - 0.5) * 0.9;
    const len = 0.006 + rnd() * 0.012;
    const w = 0.0005 + rnd() * 0.0004;
    const dry = smoothstep(-0.2, 0.5, nz.fbm(cu + 4, cv + 2, 4, 3));
    const col = mix3(greens[Math.floor(rnd() * greens.length)], hex('#8a7a55'), dry * 0.6).map((x) => x * (0.65 + rnd() * 0.5));
    const hgt = 0.15 + rnd() * 0.5;
    stamp(b, cu, cv, len, w, ang, (lx, ly, i) => {
      if (Math.abs(ly) > 1 - Math.max(0, lx) * 0.8 || Math.abs(lx) > 1) return;
      const t = (lx + 1) * 0.5;
      const hh = hgt + t * 0.12;
      if (b.h[i] > hh) return;
      b.h[i] = hh;
      const cc = col.map((x) => x * (0.75 + t * 0.35));
      b.setColor(i, cc[0], cc[1], cc[2]);
      b.rough[i] = 0.8;
    });
  }
}

/** Wet mud with ruts, puddle basins (height alpha drives puddles in shader), 4 m tile. */
export function mud(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 1.8;
  b.cavity = 0.5;
  b.each((u, v, i) => {
    const big = nz.fbm(u, v, 3, 5) * 0.5 + 0.5;
    const mid = nz.fbm(u, v, 12, 4) * 0.5 + 0.5;
    const fine = nz.fbm(u, v, 80, 3) * 0.5 + 0.5;
    const peb = 1 - smoothstep(0.0, 0.12, nz.worley(u, v, 60, W).f1);
    const pebMask = smoothstep(0.55, 0.7, idRand(W.id, 3));
    const h = big * 0.5 + mid * 0.3 + fine * 0.1 + peb * pebMask * 0.15;
    const wet = 1 - smoothstep(0.25, 0.45, h);
    let c = mix3(hex('#3b2f22'), hex('#56462f'), mid).map((x) => x * (0.8 + fine * 0.3));
    c = c.map((x) => x * (1 - wet * 0.35));
    c = mix3(c, hex('#6b665c'), peb * pebMask * 0.8);
    // footprints / tyre tread hint: subtle
    b.h[i] = h;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.85, 0.25, wet) - peb * pebMask * 0.1;
  });
}

/** Compacted gravel road surface with fines and embedded stones (3 m tile). */
export function gravel(b: TexBuilder): void {
  const nz = b.noise;
  const rnd = mulberry(55);
  b.normalStrength = 2.6;
  b.cavity = 0.75;
  b.cavityRadius = 0.004;
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 40, 4) * 0.5 + 0.5;
    const c = mix3(hex('#3d3831'), hex('#57514a'), f);
    b.setColor(i, c[0], c[1], c[2]);
    b.h[i] = f * 0.15;
    b.rough[i] = 0.92;
  });
  const cols = [hex('#77736a'), hex('#615d56'), hex('#857f74'), hex('#4f4b46'), hex('#8a8272'), hex('#6a6358')];
  for (let k = 0; k < 7000; k++) {
    const cu = rnd(), cv = rnd();
    const r = 0.0025 + Math.pow(rnd(), 2) * 0.008;
    const col = cols[Math.floor(rnd() * cols.length)].map((x) => x * (0.75 + rnd() * 0.35));
    const sh = 0.6 + rnd() * 0.4;
    const top = 0.25 + rnd() * 0.25;
    const sd = rnd() * 100;
    stamp(b, cu, cv, r, r * sh, rnd() * Math.PI, (lx, ly, i) => {
      const wob = nz.value(lx * 3 + sd, ly * 3 + sd, 4096, 4096) * 0.35;
      const d = lx * lx + ly * ly + wob;
      if (d > 1) return;
      const hh = top + Math.sqrt(1 - d) * r * 40;
      if (b.h[i] > hh) return;
      b.h[i] = hh;
      const cc = col.map((x) => x * (0.75 + Math.sqrt(1 - d) * 0.35));
      b.setColor(i, cc[0], cc[1], cc[2]);
      b.rough[i] = 0.75;
    });
  }
  b.each((u, v, i) => {
    const dirt = smoothstep(0.0, 0.9, nz.fbm(u + 2, v + 6, 3, 4));
    b.mixColor(i, hex('#3a3226'), dirt * 0.4);
  });
}

/** Old cracked asphalt with aggregate, patch repairs and moss in cracks (4 m tile). */
export function asphalt(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 1.6;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const agg = nz.worley(u, v, 260, W);
    const stone = smoothstep(0.35, 0.1, agg.f1) * (idRand(W.id, 2) > 0.5 ? 1 : 0);
    const f = nz.fbm(u, v, 30, 3) * 0.5 + 0.5;
    const cracks = crackNetwork(nz, u, v, 4, 0.05, 0.1);
    const big = nz.fbm(u, v, 2, 4) * 0.5 + 0.5;
    const patch = smoothstep(0.5, 0.52, nz.fbm(u + 3, v + 9, 2, 4) * 0.5 + 0.5);
    let c = mix3(hex('#2a2a29'), hex('#4a4845'), f * 0.6 + stone * 0.4).map((x) => x * (0.85 + big * 0.3));
    c = mix3(c, hex('#1d1d1c'), patch * 0.7);
    c = mix3(c, hex('#2e3518'), cracks * 0.8);
    b.h[i] = 0.6 + stone * 0.1 + f * 0.05 - cracks * 0.4 + patch * 0.04;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.88 - stone * 0.15 - patch * 0.1;
  });
}

/** Dense cushion moss (2 m tile). */
export function moss(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 2.5;
  b.cavity = 0.8;
  b.cavityRadius = 0.01;
  b.each((u, v, i) => {
    nz.worley(u, v, 40, W);
    const clump = 1 - smoothstep(0.0, 1.0, W.f1);
    const fine = nz.fbm(u, v, 160, 3) * 0.5 + 0.5;
    const tone = idRand(W.id, 3);
    let c = mix3(hex('#26321a'), hex('#4f5e26'), clump * 0.6 + fine * 0.4);
    c = mix3(c, hex('#6a6a30'), smoothstep(0.7, 0.9, tone) * 0.4);
    c = c.map((x) => x * (0.7 + fine * 0.5));
    b.h[i] = clump * 0.6 + fine * 0.3;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.95;
  });
}

/** Weathered granite with lichen (Bohemian massif), 3 m tile. */
export function rock(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 2.8;
  b.cavity = 0.7;
  b.cavityRadius = 0.02;
  b.each((u, v, i) => {
    const r = nz.ridged(u, v, 4, 6, 0.55);
    const f = nz.fbm(u, v, 10, 5) * 0.5 + 0.5;
    const crystals = nz.worley(u, v, 300, W);
    const feld = idRand(W.id, 1);
    let c = mix3(hex('#6e6a64'), hex('#8f8a82'), f);
    if (feld > 0.8) c = mix3(c, hex('#b8afa2'), 0.4);
    else if (feld < 0.15) c = mix3(c, hex('#2f2d2b'), 0.6);
    const lichen = smoothstep(0.6, 0.72, nz.fbm(u + 4, v + 1, 14, 4) * 0.5 + 0.5);
    const lichen2 = smoothstep(0.65, 0.75, nz.fbm(u + 9, v + 3, 22, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#a7a986'), lichen * 0.6);
    c = mix3(c, hex('#5b6a3a'), lichen2 * 0.5);
    const dark = smoothstep(0.0, 0.9, nz.fbm(u + 1, v + 7, 3, 4));
    c = c.map((x) => x * (1 - dark * 0.3));
    b.h[i] = r * 0.6 + f * 0.3 + lichen * 0.02;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.8 + f * 0.12 - (feld > 0.8 ? 0.15 : 0);
    void crystals;
  });
}

export { clamp, fract };
