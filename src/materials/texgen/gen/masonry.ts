import { TexBuilder, hex, mix3 } from '../TexBuilder';
import { clamp, smoothstep, lerp, worleyResult } from '../noise';
import { brickAt, brickInfo, crackNetwork, idRand, waterStain } from '../patterns';

const BRICK_PALETTE = [hex('#8a4a36'), hex('#9a5640'), hex('#7a3e2e'), hex('#a0624a'), hex('#6e3a2c'), hex('#8e5a44'), hex('#b07258')];

/** Old hand-made red brick in running bond with lime mortar (2.08 m tile). */
export function brick(b: TexBuilder): void {
  const nz = b.noise;
  const bi = brickInfo();
  const W = worleyResult();
  const mortarCol = hex('#8f8676');
  b.normalStrength = 2.2;
  b.cavity = 0.7;
  b.each((u, v, i) => {
    brickAt(u, v, 8, 28, 0.16, bi);
    const r1 = idRand(bi.id, 1), r2 = idRand(bi.id, 2), r3 = idRand(bi.id, 3);
    let base = BRICK_PALETTE[Math.floor(r1 * BRICK_PALETTE.length)];
    if (r2 > 0.92) base = mix3(base, hex('#3a2620'), 0.6); // over-fired dark brick
    const tone = 0.85 + r3 * 0.3;
    // brick face variation
    const f = nz.fbm(u, v, 24, 4) * 0.5 + 0.5;
    const pits = nz.worley(u, v, 110, W).f1;
    const pitMask = smoothstep(0.2, 0.6, nz.fbm(u + 1.3, v + 2.9, 6, 3) * 0.5 + 0.5);
    const pit = (1 - smoothstep(0.0, 0.16, pits)) * pitMask * (r3 > 0.4 ? 1 : 0.3);
    // edge chipping: erode brick near edges where noise is high
    const chipN = nz.fbm(u + 3.1, v + 1.7, 40, 3) * 0.5 + 0.5;
    const chip = smoothstep(0.62, 0.8, chipN) * (1 - smoothstep(0.05, 0.25, bi.edge));
    const mortar = clamp(bi.mortar + chip * 0.8);
    // heights
    const bevel = smoothstep(0.0, 0.12, bi.edge);
    const brickH = 0.75 + bevel * 0.25 - pit * 0.08 + f * 0.05 + (r2 - 0.5) * 0.06;
    const mortarH = 0.25 + nz.fbm(u, v, 64, 3) * 0.06;
    b.h[i] = lerp(brickH, mortarH, mortar);
    // colours
    const bc = [base[0] * tone * (0.9 + f * 0.2), base[1] * tone * (0.9 + f * 0.2), base[2] * tone * (0.9 + f * 0.2)];
    const mc = mortarCol.map((c) => c * (0.8 + nz.fbm(u, v, 48, 3) * 0.2));
    b.setColor(i, lerp(bc[0], mc[0], mortar), lerp(bc[1], mc[1], mortar), lerp(bc[2], mc[2], mortar));
    // soot / grime
    const grime = smoothstep(-0.2, 0.6, nz.fbm(u + 7, v + 3, 3, 5));
    b.mulColor(i, 1 - grime * 0.35);
    // efflorescence (white salt bloom)
    const eff = smoothstep(0.35, 0.7, nz.fbm(u + 11, v + 5, 4, 5)) * (0.4 + 0.6 * mortar);
    b.mixColor(i, hex('#cfc8bb'), eff * 0.45);
    b.rough[i] = lerp(0.82 + f * 0.1, 0.95, mortar);
    b.ao[i] = 1 - mortar * 0.25;
  });
}

/** Weathered lime plaster façade with water run-off, cracks and spalled patches showing brick (4 m tile). */
export function plasterExterior(b: TexBuilder, tint = '#b4aa94'): void {
  const nz = b.noise;
  const bi = brickInfo();
  const base = hex(tint);
  b.normalStrength = 1.6;
  b.cavity = 0.5;
  b.each((u, v, i) => {
    const large = nz.fbm(u, v, 3, 5) * 0.5 + 0.5;
    const fine = nz.fbm(u, v, 64, 4) * 0.5 + 0.5;
    const grain = nz.value(u * 512, v * 512, 512, 512) ;
    // spalling patches (plaster fallen off)
    const spallN = nz.fbm(u + 5.2, v + 1.3, 3, 5, 0.55);
    const spall = smoothstep(0.34, 0.37, spallN);
    const spallEdge = smoothstep(0.30, 0.34, spallN) - spall;
    // water streaks: vertical, anisotropic
    const streak = smoothstep(0.1, 0.7, nz.fbm2(u, v, 48, 3, 4, 0.6)) * smoothstep(-0.3, 0.5, nz.fbm(u, v + 0.5, 2, 3));
    const cracks = crackNetwork(nz, u, v, 5, 0.035, 0.05);
    // plaster surface
    let h = 0.8 + fine * 0.06 + grain * 0.02 - cracks * 0.12;
    let c = [base[0], base[1], base[2]];
    const tone = 0.82 + large * 0.3;
    c = c.map((x) => x * tone);
    // patchy repairs (slightly different plaster tone)
    const repair = smoothstep(0.42, 0.46, nz.fbm(u + 9.9, v + 4.4, 2, 4));
    c = mix3(c, hex('#a9a69e'), repair * 0.6);
    // dirt + streaks
    c = c.map((x) => x * (1 - streak * 0.35));
    c = mix3(c, hex('#4c4a3e'), smoothstep(0.2, 0.9, nz.fbm(u + 2, v + 8, 6, 5)) * 0.25);
    c = c.map((x) => x * (1 - cracks * 0.5));
    let rough = 0.88 + fine * 0.08;
    if (spall > 0) {
      brickAt(u * 2, v * 2, 8, 28, 0.18, bi);
      const r1 = idRand(bi.id, 1);
      const bc = BRICK_PALETTE[Math.floor(r1 * BRICK_PALETTE.length)].map((x) => x * 0.85);
      const mc = hex('#8a8272');
      const m = bi.mortar;
      const inner = [lerp(bc[0], mc[0], m), lerp(bc[1], mc[1], m), lerp(bc[2], mc[2], m)];
      // residual plaster crumbs on brick
      const crumbs = smoothstep(0.55, 0.75, nz.fbm(u * 3, v * 3, 30, 3) * 0.5 + 0.5);
      const inside = mix3(inner, hex('#9c958a'), crumbs * 0.6);
      c = mix3(c, inside, spall);
      h = lerp(h, 0.35 + (1 - m) * 0.15, spall);
      rough = lerp(rough, 0.93, spall);
    }
    // ragged lighter plaster edge around spall
    c = mix3(c, hex('#d0c8b6'), spallEdge * 0.5);
    h += spallEdge * 0.03;
    b.h[i] = h;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = rough;
  });
}

/** Interior painted plaster (dirty white) with water stains, hairline cracks and mould. */
export function plasterInterior(b: TexBuilder, tint = '#c9c3b4'): void {
  const nz = b.noise;
  const base = hex(tint);
  b.normalStrength = 0.9;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    const large = nz.fbm(u, v, 2, 5) * 0.5 + 0.5;
    const fine = nz.fbm(u, v, 80, 3) * 0.5 + 0.5;
    const cracks = crackNetwork(nz, u, v, 4, 0.025, 0.06);
    const [stain, ring] = waterStain(nz, u, v, 2, 0.22);
    let c = base.map((x) => x * (0.86 + large * 0.18));
    // yellowing nicotine/age
    c = mix3(c, hex('#b5a98a'), smoothstep(-0.4, 0.6, nz.fbm(u + 3, v + 1, 2, 4)) * 0.35);
    c = mix3(c, hex('#8d7f62'), stain * 0.35);
    c = mix3(c, hex('#5e4f38'), ring * 0.5);
    // mould speckles in damp areas
    const mould = smoothstep(0.55, 0.8, nz.fbm(u * 1.0 + 7, v + 2, 24, 4) * 0.5 + 0.5) * smoothstep(0.1, 0.4, stain + nz.fbm(u, v, 3, 3) * 0.5);
    c = mix3(c, hex('#2e3326'), mould * 0.6);
    c = c.map((x) => x * (1 - cracks * 0.45));
    // flaking paint
    const flake = smoothstep(0.5, 0.53, nz.fbm(u + 1.7, v + 9.1, 6, 5));
    c = mix3(c, hex('#a09884'), flake * 0.7);
    b.h[i] = 0.8 + fine * 0.04 - cracks * 0.1 - flake * 0.05 + ring * 0.01;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.85 + fine * 0.1 - stain * 0.05;
  });
}

/** Rough rubble-stone foundation masonry (Bruchsteinmauer), 3 m tile. */
export function stoneWall(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.normalStrength = 3.0;
  b.cavity = 0.8;
  b.cavityRadius = 0.02;
  const stones = [hex('#77736b'), hex('#6b675f'), hex('#837c70'), hex('#5f5d58'), hex('#8a8579'), hex('#6f6a5e')];
  b.each((u, v, i) => {
    // stretch cells horizontally for coursed rubble look
    const wu = u + nz.fbm(u, v, 6, 3) * 0.015;
    const wv = v + nz.fbm(u + 3, v, 6, 3) * 0.015;
    nz.worley(wu, wv * 1.0, 9, W, 0.85);
    const d = W.f2 - W.f1;
    const mortar = 1 - smoothstep(0.025, 0.07, d);
    const r = idRand(W.id, 3);
    const sc = stones[Math.floor(r * stones.length)];
    const sf = nz.fbm(u, v, 28, 5) * 0.5 + 0.5;
    const dome = smoothstep(0.0, 0.35, d) * (0.7 + 0.3 * (nz.fbm(u, v, 12, 3) * 0.5 + 0.5));
    let c = sc.map((x) => x * (0.75 + sf * 0.45));
    // lichen spots
    const lichen = smoothstep(0.6, 0.75, nz.fbm(u + 4, v + 4, 20, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#9c9a7a'), lichen * 0.5 * (1 - mortar));
    const mc = hex('#8a8374').map((x) => x * (0.8 + sf * 0.2));
    c = mix3(c, mc, mortar);
    // damp dark staining
    c = c.map((x) => x * (1 - smoothstep(0.0, 0.7, nz.fbm(u + 8, v, 3, 4)) * 0.3));
    b.h[i] = lerp(0.5 + dome * 0.45 + sf * 0.08, 0.15 + sf * 0.05, mortar);
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.78 + sf * 0.15, 0.95, mortar);
  });
}

/** Cast concrete with formwork board imprints, damp staining and pores (4 m tile). */
export function concrete(b: TexBuilder, tint = '#8a877f'): void {
  const nz = b.noise;
  const W = worleyResult();
  const base = hex(tint);
  b.normalStrength = 1.2;
  b.cavity = 0.4;
  b.each((u, v, i) => {
    const board = (v * 16) % 1;
    const boardLine = 1 - smoothstep(0.0, 0.025, Math.min(board, 1 - board));
    const boardTone = idRand(Math.floor(v * 16), 5) - 0.5;
    const grainB = nz.fbm2(u, v, 12, 160, 3, 0.5);
    const large = nz.fbm(u, v, 3, 5) * 0.5 + 0.5;
    const pores = 1 - smoothstep(0.0, 0.18, nz.worley(u, v, 140, W).f1);
    const damp = smoothstep(-0.2, 0.5, nz.fbm(u + 2, v + 6, 2, 5));
    let c = base.map((x) => x * (0.85 + large * 0.2 + boardTone * 0.05 + grainB * 0.03));
    c = c.map((x) => x * (1 - damp * 0.3));
    c = mix3(c, hex('#4d5040'), smoothstep(0.55, 0.8, nz.fbm(u + 9, v + 1, 10, 4) * 0.5 + 0.5) * 0.3 * damp);
    c = c.map((x) => x * (1 - pores * 0.35 - boardLine * 0.15));
    const cracks = crackNetwork(nz, u, v, 3, 0.02, 0.04);
    c = c.map((x) => x * (1 - cracks * 0.5));
    b.h[i] = 0.7 + grainB * 0.03 - pores * 0.1 - boardLine * 0.05 - cracks * 0.1 + large * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.9 - damp * 0.2;
  });
}

/** Hand-made clay plain tiles (Biberschwanz) with lichen and moss in the overlaps (2 m tile). */
export function roofTiles(b: TexBuilder): void {
  const nz = b.noise;
  const cols = 11, rows = 13;
  b.normalStrength = 3.2;
  b.cavity = 0.75;
  b.cavityRadius = 0.015;
  const pal = [hex('#7c3f2c'), hex('#8a4a33'), hex('#6d3a2b'), hex('#94573c'), hex('#5c3428'), hex('#7a4634')];
  b.each((u, v, i) => {
    const y = v * rows;
    const row = Math.floor(y);
    const x = u * cols + (row & 1) * 0.5;
    const col = Math.floor(x);
    const lx = x - col;
    const ly = y - row; // 0 at bottom edge of exposed tile, 1 at top (under next row)
    // segmental (rounded) bottom: the tile edge rises toward its sides
    const cx = (lx - 0.5) * 2;
    const roundOff = 0.18 * cx * cx; // tile bottom edge curve
    const gap = smoothstep(0.0, 0.035, Math.min(lx, 1 - lx));
    // If we are below the rounded edge we see the tile underneath (previous row, offset)
    let id: number, local: number;
    if (ly < roundOff) {
      const prow = row - 1;
      const px = u * cols + (prow & 1) * 0.5;
      id = Math.floor(px) + prow * 97;
      local = ly + 1 - roundOff; // deep under – shadowed area of lower tile
    } else {
      id = col + row * 97;
      local = (ly - roundOff) / (1 - roundOff);
    }
    const r1 = idRand(id, 1), r2 = idRand(id, 2);
    let c = pal[Math.floor(r1 * pal.length)].map((x) => x * (0.85 + r2 * 0.25));
    const f = nz.fbm(u, v, 30, 4) * 0.5 + 0.5;
    c = c.map((x) => x * (0.85 + f * 0.25));
    // thickness ramp: lower edge thick (high), rising under next row
    let h = 0.45 + (1 - local) * 0.5;
    if (ly < roundOff) h = 0.2 + (1 - local) * 0.2;
    h *= 0.6 + gap * 0.4;
    h += f * 0.04;
    // shadow just above the overlapping edge
    const occl = smoothstep(0.0, 0.18, local);
    const lichen = smoothstep(0.62, 0.78, nz.fbm(u + 3, v + 1, 26, 4) * 0.5 + 0.5);
    c = mix3(c, hex('#b8b48e'), lichen * 0.55);
    const moss = smoothstep(0.35, 0.65, nz.fbm(u + 7, v + 5, 7, 5) * 0.5 + 0.5) * (1 - smoothstep(0.0, 0.25, local)) ;
    c = mix3(c, hex('#3d4a23'), moss * 0.85);
    h += moss * 0.06;
    const dirt = smoothstep(0.0, 0.8, nz.fbm(u + 1, v + 9, 4, 5));
    c = c.map((x) => x * (1 - dirt * 0.3) * (0.55 + occl * 0.45) * (0.5 + 0.5 * gap));
    b.h[i] = h;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.8 + f * 0.12 + moss * 0.05;
    b.ao[i] = (0.6 + occl * 0.4) * (0.6 + gap * 0.4);
  });
}

/** Ceramic floor tiles – 1920s checkerboard (cream / oxblood), grimy grout, cracked tiles. */
export function floorTiles(b: TexBuilder, a = '#bfb39a', c2 = '#6b2f26', count = 10): void {
  const nz = b.noise;
  const ca = hex(a), cb = hex(c2);
  b.normalStrength = 1.4;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const x = u * count, y = v * count;
    const tx = Math.floor(x), ty = Math.floor(y);
    const lx = x - tx, ly = y - ty;
    const e = Math.min(lx, 1 - lx, ly, 1 - ly);
    const grout = 1 - smoothstep(0.012, 0.03, e);
    const id = tx + ty * 131;
    const r = idRand(id, 3);
    let c = ((tx + ty) & 1) ? cb : ca;
    c = c.map((k) => k * (0.88 + r * 0.16));
    const f = nz.fbm(u, v, 40, 3) * 0.5 + 0.5;
    c = c.map((k) => k * (0.92 + f * 0.1));
    // crack in some tiles
    let crack = 0;
    if (idRand(id, 7) > 0.8) {
      const ang = idRand(id, 8) * Math.PI;
      const d = Math.abs((lx - 0.5) * Math.sin(ang) - (ly - 0.5) * Math.cos(ang) + nz.fbm(u, v, 30, 3) * 0.05);
      crack = 1 - smoothstep(0.003, 0.012, d);
    }
    // chips at corners
    const chip = smoothstep(0.7, 0.85, nz.fbm(u + 3, v + 3, 60, 3) * 0.5 + 0.5) * (1 - smoothstep(0.02, 0.08, e));
    const groutC = hex('#4a443a');
    c = mix3(c, groutC, Math.max(grout, chip * 0.8));
    c = c.map((k) => k * (1 - crack * 0.6));
    const dirt = smoothstep(0.0, 0.9, nz.fbm(u + 5, v + 2, 3, 5));
    c = mix3(c, hex('#5c5242'), dirt * 0.35);
    b.h[i] = 0.8 - grout * 0.35 - crack * 0.1 - chip * 0.2 + f * 0.01;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.35 + dirt * 0.4 + f * 0.1, 0.95, Math.max(grout, chip));
  });
}

/** Glazed white wall tiles (15 cm), crazing, missing tiles exposing adhesive (1.5 m tile). */
export function wallTiles(b: TexBuilder, tint = '#d8d6cc'): void {
  const nz = b.noise;
  const base = hex(tint);
  const count = 10;
  b.normalStrength = 1.2;
  b.cavity = 0.5;
  b.each((u, v, i) => {
    const x = u * count, y = v * count;
    const tx = Math.floor(x), ty = Math.floor(y);
    const lx = x - tx, ly = y - ty;
    const e = Math.min(lx, 1 - lx, ly, 1 - ly);
    const grout = 1 - smoothstep(0.015, 0.035, e);
    const id = tx + ty * 77;
    const missing = idRand(id, 4) > 0.94;
    const r = idRand(id, 1);
    let c = base.map((k) => k * (0.92 + r * 0.08));
    const bevel = smoothstep(0.02, 0.09, e);
    const crazing = crackNetwork(nz, u, v, 18, 0.02, 0.02);
    const [stain] = waterStain(nz, u, v, 2, 0.2);
    c = mix3(c, hex('#a69a7c'), stain * 0.35);
    c = c.map((k) => k * (1 - crazing * 0.15));
    let h = 0.75 + bevel * 0.2;
    let rough = 0.12 + crazing * 0.2 + stain * 0.25;
    if (missing) {
      const adh = nz.fbm(u, v, 50, 3) * 0.5 + 0.5;
      c = hex('#7d776a').map((k) => k * (0.8 + adh * 0.3));
      h = 0.3 + adh * 0.1;
      rough = 0.95;
    }
    c = mix3(c, hex('#5a5448'), grout * 0.85);
    b.h[i] = lerp(h, 0.45, grout);
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(rough, 0.9, grout);
  });
}
