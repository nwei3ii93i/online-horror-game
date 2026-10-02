import { TexBuilder, hex, mix3 } from '../TexBuilder';
import { clamp, smoothstep, lerp, fract, worleyResult } from '../noise';
import { idRand, crackNetwork } from '../patterns';

/**
 * Shared wood surface: returns grain intensity for a board in local coordinates.
 * `a` runs along the board (fibre direction), `c` across it. Units: metres.
 */
function grain(b: TexBuilder, a: number, c: number, seed: number, u: number, v: number, alongU: boolean): { g: number; knot: number } {
  const nz = b.noise;
  // ring pattern of flat-sawn board: distance to a wobbling centre line
  const wob = nz.fbm2(alongU ? u : v, alongU ? v : u, 2, 3, 3, 0.5) * 0.04 + Math.sin(a * 3.1 + seed * 10) * 0.012;
  const ringPos = (c + wob) * (38 + seed * 20) + seed * 31;
  const ring = fract(ringPos);
  const late = Math.pow(smoothstep(0.55, 1.0, ring), 2.5);
  const fibres = nz.fbm2(alongU ? u : v, alongU ? v : u, 3, 220, 3, 0.55) * 0.5 + 0.5;
  // knots: elliptical concentric rings
  let knot = 0;
  const kc = idRand(Math.floor(seed * 1000), 9);
  if (kc > 0.55) {
    const ka = fract(kc * 7.3) * 1.6 + 0.2;
    const kcc = 0.02 + fract(kc * 3.7) * 0.06;
    const dx = (a - ka) / 0.05, dy = (c - kcc) / 0.018;
    const d = Math.sqrt(dx * dx + dy * dy);
    knot = Math.exp(-d * d * 0.8);
    const kr = fract(d * 1.6);
    knot = Math.max(knot, (1 - smoothstep(0.0, 3.5, d)) * Math.pow(kr, 3) * 0.6);
  }
  return { g: clamp(late * 0.7 + fibres * 0.3), knot };
}

/** Pine floorboards (Dielen) 2 m tile, boards along u. Worn varnish, dirt in gaps, nails. */
export function floorBoards(b: TexBuilder, light = '#8a6a4a', dark = '#4e3826', boards = 12): void {
  const nz = b.noise;
  const cl = hex(light), cd = hex(dark);
  b.normalStrength = 1.6;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const row = Math.floor(v * boards);
    const lv = v * boards - row;
    // staggered butt joints: each row has its own offset and plank length
    const len = 0.5 + idRand(row, 2) * 0.5; // fraction of tile
    const off = idRand(row, 3);
    const pu = (u + off) / len;
    const seg = Math.floor(pu);
    const lu = pu - seg;
    const id = row * 31 + (((seg % 64) + 64) % 64);
    const seed = idRand(id, 4);
    const gapV = 1 - smoothstep(0.0, 0.05, Math.min(lv, 1 - lv));
    const gapU = 1 - smoothstep(0.0, 0.006 / len, Math.min(lu, 1 - lu));
    const gap = Math.max(gapV, gapU);
    const { g, knot } = grain(b, lu * len * 2, lv / boards * 2, seed, u, v, true);
    const tone = 0.8 + idRand(id, 5) * 0.35;
    let c = mix3(cl, cd, g * 0.65 + knot * 0.5).map((x) => x * tone);
    // wear: lighter, matte patches; dirt: dark grime
    const wear = smoothstep(0.1, 0.7, nz.fbm(u, v, 3, 4) * 0.5 + 0.5);
    const dirt = smoothstep(0.0, 0.9, nz.fbm(u + 4, v + 2, 4, 5));
    c = mix3(c, hex('#9a8a72'), wear * 0.18);
    c = mix3(c, hex('#2c241a'), dirt * 0.35);
    // nails: two per board end and at joists every ~0.6 m (tile 2 m → 3.33 joists)
    const joist = fract(u * 3 + 0.17);
    const nailD = Math.min(Math.hypot((joist - 0.5) * 0.6 / 0.006, (lv - 0.25) * 0.166 / 0.006), Math.hypot((joist - 0.5) * 0.6 / 0.006, (lv - 0.75) * 0.166 / 0.006));
    const nail = 1 - smoothstep(0.6, 1.1, nailD);
    c = mix3(c, hex('#1d1a17'), nail * 0.9);
    const scratches = smoothstep(0.92, 1.0, nz.fbm2(u, v, 40, 3, 2, 0.5) * 0.5 + 0.5) * 0.4;
    c = mix3(c, hex('#a8957a'), scratches * 0.5);
    c = mix3(c, hex('#140f0a'), gap * 0.92);
    b.h[i] = 0.75 - g * 0.03 - gap * 0.6 - nail * 0.05 + (idRand(id, 6) - 0.5) * 0.04 - scratches * 0.02;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.55 + wear * 0.3 + dirt * 0.1 + g * 0.05, 0.95, gap);
    b.metal[i] = nail * 0.5;
  });
}

/**
 * Herringbone lookup for 1×N blocks. Strands {H_k, V_k} form a staircase:
 * H = [k+mN, k+mN+N]×[k-mN, k-mN+1], V = [k+mN, k+mN+1]×[k-mN+1, k-mN+1+N].
 */
function herringbone(x: number, y: number, N: number): { id: number; la: number; lc: number; vertical: boolean } {
  const fy = Math.floor(y);
  const m = Math.floor((x - fy) / (2 * N));
  const xs = fy + 2 * m * N; // = k + mN for H candidate
  if (x - xs < N && x >= xs) {
    const k = fy + m * N;
    return { id: k * 7919 + m * 104729, la: (x - xs) / N, lc: y - fy, vertical: false };
  }
  const fx = Math.floor(x);
  const m2 = Math.ceil((fx - y + 1) / (2 * N) - 1e-9);
  const k2 = fx - m2 * N;
  const y0 = k2 - m2 * N + 1;
  return { id: k2 * 6151 + m2 * 15485863 + 1, la: (y - y0) / N, lc: x - fx, vertical: true };
}

/** Oak herringbone parquet (salon), worn and water-damaged in places. 1.28 m tile. */
export function parquet(b: TexBuilder): void {
  const nz = b.noise;
  b.normalStrength = 1.3;
  b.cavity = 0.55;
  const cl = hex('#8b6337'), cd = hex('#53381f');
  const N = 4, P = 16; // block ratio, tile period in block widths (multiple of 2N)
  b.each((u, v, i) => {
    const hb = herringbone(u * P, v * P, N);
    const e = Math.min(hb.la * N, (1 - hb.la) * N, hb.lc, 1 - hb.lc);
    const gap = 1 - smoothstep(0.0, 0.06, e);
    const seed = idRand(hb.id, 1);
    const { g, knot } = grain(b, hb.la * 0.32, hb.lc * 0.08, seed, u, v, !hb.vertical);
    const tone = 0.75 + idRand(hb.id, 2) * 0.4;
    let c = mix3(cl, cd, g * 0.6 + knot * 0.3).map((x) => x * tone);
    const water = smoothstep(0.2, 0.5, nz.fbm(u + 3, v + 7, 2, 5) * 0.5 + 0.5);
    c = mix3(c, hex('#3a2a1c'), water * 0.45);
    const dull = smoothstep(0.0, 1.0, nz.fbm(u, v, 3, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#1a130c'), gap * 0.9);
    const cup = water * (1 - Math.abs(hb.lc - 0.5) * 2) * 0.1;
    b.h[i] = 0.7 - gap * 0.5 + cup - g * 0.02;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.45 + dull * 0.3 + water * 0.2, 0.9, gap);
  });
}

/** Silver-grey weathered barn boards, vertical (along v), with battens and rusty nails (3 m tile). */
export function barnBoards(b: TexBuilder): void {
  const nz = b.noise;
  const boards = 12;
  b.normalStrength = 2.6;
  b.cavity = 0.75;
  b.each((u, v, i) => {
    const col = Math.floor(u * boards);
    const lu = u * boards - col;
    const seed = idRand(col, 3);
    const w = 0.85 + seed * 0.1; // board width share; rest is gap
    const gap = 1 - smoothstep(0.0, 0.02, Math.min(lu, w - lu) ) ;
    const inGap = lu > w ? 1 : gap;
    // deep weathered grain (eroded soft wood)
    const fib = nz.fbm2(v, u, 3, 160, 4, 0.6) * 0.5 + 0.5;
    const ringy = Math.pow(fract((lu * 0.25 + nz.fbm2(v, u, 2, 6, 2) * 0.03) * 30 + seed * 9), 3);
    const erosion = fib * 0.6 + ringy * 0.4;
    const tone = 0.8 + idRand(col, 4) * 0.3;
    let c = mix3(hex('#8d877c'), hex('#5a524a'), erosion * 0.7).map((x) => x * tone);
    // brown remains where less weathered (bottom / sheltered)
    c = mix3(c, hex('#6a4d34'), smoothstep(0.2, 0.7, nz.fbm(u + 2, v + 9, 3, 4) * 0.5 + 0.5) * 0.4);
    // dark rot / lichen
    c = mix3(c, hex('#2d2b22'), smoothstep(0.5, 0.85, nz.fbm(u + 6, v, 5, 5) * 0.5 + 0.5) * 0.5);
    c = mix3(c, hex('#a6a68a'), smoothstep(0.7, 0.85, nz.fbm(u + 1, v + 1, 30, 4) * 0.5 + 0.5) * 0.4);
    // nails at two horizontal rails, rust streak below
    let nail = 0, rust = 0;
    for (const rv of [0.18, 0.68]) {
      const dv = v - rv;
      for (const nu of [0.25, 0.65]) {
        const du = (lu - nu * w) / boards;
        const d = Math.hypot(du, dv) * 3; // metres
        nail = Math.max(nail, 1 - smoothstep(0.004, 0.007, d));
        if (dv < 0 && Math.abs(du) * 3 < 0.01) rust = Math.max(rust, (1 - smoothstep(0, 0.15, -dv * 3)) * (1 - Math.abs(du) * 3 / 0.01));
      }
    }
    c = mix3(c, hex('#5a3420'), rust * 0.5);
    c = mix3(c, hex('#2a1a12'), nail);
    c = mix3(c, hex('#0b0a09'), inGap * 0.95);
    b.h[i] = lerp(0.7 - erosion * 0.18 + nail * 0.05, 0.0, inGap);
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.85 + erosion * 0.1, 1, inGap);
    b.metal[i] = nail * 0.3;
  });
}

/** Painted wood with flaking paint revealing grey wood (doors, window frames, shutters). 1 m tile. */
export function paintedWood(b: TexBuilder, paint = '#d8d2c2', boards = 1): void {
  const nz = b.noise;
  const pc = hex(paint);
  const W = worleyResult();
  b.normalStrength = 1.4;
  b.cavity = 0.5;
  b.each((u, v, i) => {
    const col = Math.floor(u * boards);
    const lu = u * boards - col;
    const { g } = grain(b, v, lu / boards, idRand(col, 2), u, v, false);
    let wood = mix3(hex('#7d746a'), hex('#4b4339'), g);
    // alligatored paint: worley edges
    nz.worley(u, v, 72, W, 0.9);
    const cellEdge = (1 - smoothstep(0.0, 0.05, W.f2 - W.f1)) * (0.35 + 0.65 * smoothstep(0.3, 0.8, nz.fbm(u + 7, v + 2, 4, 3) * 0.5 + 0.5));
    const flakeN = nz.fbm(u + 1, v + 4, 5, 5) * 0.5 + 0.5;
    const flaked = smoothstep(0.68, 0.71, flakeN + idRand(W.id, 3) * 0.1);
    const paintEdge = smoothstep(0.63, 0.68, flakeN + idRand(W.id, 3) * 0.1) - flaked;
    let c = pc.map((x) => x * (0.88 + nz.fbm(u, v, 8, 3) * 0.1));
    c = mix3(c, hex('#8f8672'), smoothstep(0.0, 1.0, nz.fbm(u + 3, v, 3, 4)) * 0.4); // grime
    c = c.map((x) => x * (1 - cellEdge * 0.12));
    c = mix3(c, wood, flaked);
    const boardGap = boards > 1 ? 1 - smoothstep(0.0, 0.015, Math.min(lu, 1 - lu)) : 0;
    c = c.map((x) => x * (1 - boardGap * 0.8));
    b.h[i] = 0.7 + (1 - flaked) * 0.08 + paintEdge * 0.04 - cellEdge * 0.015 * (1 - flaked) - g * 0.03 * flaked - boardGap * 0.4;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.55 + cellEdge * 0.2, 0.9, flaked);
  });
}

/** Dark varnished furniture veneer (walnut/oak), dusty, scratched. 1 m tile, grain along u. */
export function furnitureWood(b: TexBuilder, light = '#6b4a2e', dark = '#2e1d12'): void {
  const nz = b.noise;
  const cl = hex(light), cd = hex(dark);
  b.normalStrength = 0.7;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    // quarter/flat sawn mix: gently warped parallel growth lines with occasional cathedrals
    const warp = nz.fbm2(u, v, 2, 3, 3, 0.5) * 0.035 + nz.fbm2(u, v, 1, 8, 2, 0.5) * 0.01;
    const ringPos = (v + warp) * 34;
    const ring = fract(ringPos);
    const late = Math.pow(smoothstep(0.5, 1.0, ring), 2) * (0.6 + 0.4 * (nz.fbm2(u, v, 3, 24, 2, 0.5) * 0.5 + 0.5));
    const pores = nz.fbm2(u, v, 8, 420, 2, 0.5) * 0.5 + 0.5;
    const flame = nz.fbm2(u, v, 6, 2, 3, 0.5) * 0.5 + 0.5;
    let c = mix3(cl, cd, late * 0.55 + pores * 0.2 + flame * 0.15);
    const dust = smoothstep(0.0, 1.0, nz.fbm(u + 3, v + 1, 3, 5) * 0.5 + 0.5);
    c = mix3(c, hex('#8a8170'), dust * 0.22);
    const scratch = smoothstep(0.965, 1.0, Math.abs(nz.fbm2(u + v * 0.3, v, 30, 2, 2, 0.5)) + 0.5);
    c = mix3(c, hex('#a08868'), scratch * 0.35);
    const cracks = crackNetwork(nz, u, v, 6, 0.01, 0.02);
    c = c.map((x) => x * (1 - cracks * 0.4));
    b.h[i] = 0.8 - pores * 0.03 - late * 0.01 - scratch * 0.04 - cracks * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.38 + dust * 0.42 + scratch * 0.2 + late * 0.05;
  });
}

/** Rough sawn timber (beams, rafters, crates), brownish-grey (1 m tile, grain along v). */
export function roughTimber(b: TexBuilder, tint = '#7a6650'): void {
  const nz = b.noise;
  const base = hex(tint);
  b.normalStrength = 2.0;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const fib = nz.fbm2(v, u, 3, 90, 4, 0.6) * 0.5 + 0.5;
    const saw = Math.sin((v + nz.fbm(u, v, 3, 2) * 0.02) * 260) * 0.5 + 0.5;
    const ring = Math.pow(fract((u + nz.fbm2(v, u, 2, 4, 2) * 0.05) * 9), 4);
    let c = base.map((x) => x * (0.7 + fib * 0.35 - ring * 0.15));
    c = mix3(c, hex('#3f3b33'), smoothstep(0.2, 0.9, nz.fbm(u + 5, v + 3, 3, 5) * 0.5 + 0.5) * 0.4);
    const cracks = crackNetwork(nz, u * 0.3, v, 3, 0.02, 0.01);
    c = c.map((x) => x * (1 - cracks * 0.6));
    b.h[i] = 0.7 + fib * 0.08 + saw * 0.02 - ring * 0.03 - cracks * 0.3;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.85 + fib * 0.1;
  });
}

/** Vertical tongue-and-groove wainscot / wall panelling, varnished (1 m tile). */
export function wainscot(b: TexBuilder): void {
  const nz = b.noise;
  const boards = 10;
  b.normalStrength = 1.5;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const col = Math.floor(u * boards);
    const lu = u * boards - col;
    const groove = 1 - smoothstep(0.0, 0.06, Math.min(lu, 1 - lu));
    const { g, knot } = grain(b, v, lu / boards, idRand(col, 5), u, v, false);
    let c = mix3(hex('#7b5634'), hex('#3e2715'), g * 0.5 + knot * 0.4).map((x) => x * (0.85 + idRand(col, 6) * 0.25));
    const dust = smoothstep(0, 1, nz.fbm(u, v, 3, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#857a68'), dust * 0.2);
    c = c.map((x) => x * (1 - groove * 0.6));
    b.h[i] = 0.8 - groove * 0.4 - g * 0.02;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.45 + dust * 0.35 + groove * 0.2;
  });
}
