import { TexBuilder, hex, mix3 } from '../TexBuilder';
import { smoothstep, lerp, fract, worleyResult, mulberry } from './util';
import { idRand, stamp } from '../patterns';

/**
 * Bark textures: u wraps around the trunk, v runs up the trunk.
 * Tile covers ~1 m circumference × 2 m height (mapping handled by the tree generator).
 */

/** Norway spruce: flaky reddish-grey scales. */
export function barkSpruce(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 3.2;
  b.cavity = 0.85;
  b.cavityRadius = 0.008;
  b.each((u, v, i) => {
    // elongated scales: squash v
    const wu = u + nz.fbm(u, v, 8, 3) * 0.01;
    nz.worley(wu, v * 0.45 + nz.fbm(u, v, 6, 2) * 0.01, 46, W, 1.0);
    const edge = smoothstep(0.0, 0.1, W.f2 - W.f1);
    const plate = Math.sqrt(Math.max(0, 1 - W.f1 * 1.2));
    const t = idRand(W.id, 2);
    let c = mix3(hex('#5a4234'), hex('#7a5e4c'), t).map((x) => x * (0.7 + plate * 0.4));
    c = mix3(c, hex('#3a2c22'), (1 - edge) * 0.6);
    c = c.map((x) => x * (0.85 + (nz.fbm(u, v, 3, 3) * 0.5 + 0.5) * 0.25));
    const lichen = smoothstep(0.62, 0.75, nz.fbm(u + 2, v + 2, 10, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#8c9076'), lichen * 0.5);
    const resin = smoothstep(0.86, 0.9, nz.fbm(u + 5, v + 8, 6, 3) * 0.5 + 0.5);
    c = mix3(c, hex('#c9b38a'), resin * 0.6);
    b.h[i] = edge * (0.5 + plate * 0.4 + t * 0.1);
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.88 - resin * 0.5;
  });
}

/** European beech: smooth grey with fine horizontal marks, lichen and green algae. */
export function barkBeech(b: TexBuilder): void {
  const nz = b.noise;
  b.normalStrength = 1.0;
  b.cavity = 0.4;
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 6, 5) * 0.5 + 0.5;
    const rings = smoothstep(0.85, 1.0, nz.fbm2(u, v, 3, 60, 3, 0.5) * 0.5 + 0.5);
    let c = mix3(hex('#77766f'), hex('#9a978e'), f);
    const algae = smoothstep(0.45, 0.75, nz.fbm(u + 3, v + 1, 4, 5) * 0.5 + 0.5);
    c = mix3(c, hex('#4d5a3a'), algae * 0.55);
    const lichen = smoothstep(0.66, 0.74, nz.fbm(u + 7, v + 3, 16, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#c2c4ae'), lichen * 0.55);
    c = c.map((x) => x * (1 - rings * 0.25));
    // occasional "eye" scars of shed branches
    const eye = nz.value(u * 6, v * 3, 6, 3, 9);
    const ex = fract(u * 6) - 0.5, ey = fract(v * 3) - 0.5;
    const eyeD = Math.hypot(ex * 1.0, ey * 2.2);
    const scar = eye > 0.78 ? (1 - smoothstep(0.15, 0.25, eyeD)) * smoothstep(0.08, 0.14, eyeD) : 0;
    c = mix3(c, hex('#3c3a35'), scar * 0.7);
    b.h[i] = 0.6 + f * 0.1 - rings * 0.05 + lichen * 0.03 - scar * 0.1;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.75 + algae * 0.15;
  });
}

/** Silver birch: chalky white with dark lenticels and black fissured base patches. */
export function barkBirch(b: TexBuilder): void {
  const nz = b.noise;
  const rnd = mulberry(5);
  b.normalStrength = 1.6;
  b.cavity = 0.5;
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 8, 4) * 0.5 + 0.5;
    let c = mix3(hex('#c9c6bc'), hex('#e2dfd6'), f);
    const dark = smoothstep(0.6, 0.66, nz.fbm(u + 3, v * 0.7, 6, 5) * 0.5 + 0.5);
    c = mix3(c, hex('#24211e'), dark * 0.9);
    const peel = smoothstep(0.6, 0.64, nz.fbm2(u + 9, v, 4, 18, 3, 0.5) * 0.5 + 0.5);
    c = mix3(c, hex('#b49a80'), peel * 0.5);
    b.h[i] = 0.6 - dark * 0.2 + f * 0.05 + peel * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.7 + dark * 0.2;
  });
  // horizontal lenticels
  for (let k = 0; k < 900; k++) {
    const cu = rnd(), cv = rnd();
    const len = 0.01 + rnd() * 0.04;
    stamp(b, cu, cv, len, 0.0018 + rnd() * 0.002, (rnd() - 0.5) * 0.15, (lx, ly, i) => {
      const d = lx * lx + ly * ly;
      if (d > 1) return;
      b.mixColor(i, hex('#2a2622'), (1 - d) * 0.9);
      b.h[i] -= (1 - d) * 0.08;
    });
  }
}

/** Oak: deep vertical furrows, dark grey-brown. */
export function barkOak(b: TexBuilder): void {
  const nz = b.noise;
  b.normalStrength = 3.4;
  b.cavity = 0.9;
  b.cavityRadius = 0.01;
  b.each((u, v, i) => {
    const wu = u + nz.fbm(u, v, 3, 3) * 0.04;
    const r = nz.ridged(wu, v * 0.25, 14, 4, 0.5);
    const blocks = smoothstep(0.75, 0.95, nz.fbm2(wu, v, 10, 4, 3, 0.5) * 0.5 + 0.5);
    const ridge = Math.pow(r, 1.5) * (1 - blocks * 0.5);
    const f = nz.fbm(u, v, 30, 3) * 0.5 + 0.5;
    let c = mix3(hex('#2c2620'), hex('#6a6158'), ridge * 0.8 + f * 0.2);
    const moss = smoothstep(0.55, 0.75, nz.fbm(u + 3, v + 3, 5, 4) * 0.5 + 0.5) * (1 - ridge);
    c = mix3(c, hex('#3c4a20'), moss * 0.7);
    b.h[i] = ridge * 0.8 + f * 0.1;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.9;
  });
}

/** Dead wood without bark: grey, cracked, insect galleries. */
export function deadwood(b: TexBuilder): void {
  const nz = b.noise;
  b.normalStrength = 2.2;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const fib = nz.fbm2(u, v, 40, 3, 4, 0.55) * 0.5 + 0.5;
    const crack = smoothstep(0.9, 1.0, nz.ridged(u, v * 0.2, 10, 3, 0.5));
    const gall = smoothstep(0.92, 1.0, nz.ridged(u + 3, v + 1, 8, 3, 0.5));
    let c = mix3(hex('#6d675d'), hex('#9a9486'), fib);
    c = mix3(c, hex('#2b2620'), crack * 0.9 + gall * 0.6);
    c = mix3(c, hex('#4a5530'), smoothstep(0.6, 0.8, nz.fbm(u + 5, v, 6, 4) * 0.5 + 0.5) * 0.5);
    b.h[i] = 0.6 + fib * 0.1 - crack * 0.4 - gall * 0.15;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.9;
  });
}

export { lerp };
