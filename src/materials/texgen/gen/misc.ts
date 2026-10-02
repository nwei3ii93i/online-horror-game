import { TexBuilder, hex, mix3 } from '../TexBuilder';
import { clamp, smoothstep, lerp, fract, worleyResult, mulberry } from './util';
import { crackNetwork, idRand, waterStain, stamp } from '../patterns';

/** Rusted steel: bare metal islands in layered rust with pitting. Alpha = metalness. 1 m tile. */
export function rustMetal(b: TexBuilder): void {
  const nz = b.noise;
  const W = worleyResult();
  b.alphaMode = 'metal';
  b.normalStrength = 1.8;
  b.cavity = 0.6;
  b.each((u, v, i) => {
    const r = nz.fbm(u, v, 6, 6, 0.55) * 0.5 + 0.5;
    const rust = smoothstep(0.38, 0.5, r);
    const heavy = smoothstep(0.6, 0.75, r);
    const pit = 1 - smoothstep(0.0, 0.2, nz.worley(u, v, 120, W).f1);
    const f = nz.fbm(u, v, 60, 3) * 0.5 + 0.5;
    let c = mix3(hex('#5c5a57'), hex('#7b7873'), f);
    const rc = mix3(hex('#6b3a1c'), hex('#8e4f22'), f).map((x) => x * (0.8 + nz.fbm(u + 3, v, 20, 3) * 0.3));
    c = mix3(c, rc, rust);
    c = mix3(c, hex('#3a2416'), heavy * 0.6);
    c = c.map((x) => x * (1 - pit * heavy * 0.4));
    b.h[i] = 0.5 + rust * 0.15 + heavy * f * 0.15 - pit * heavy * 0.2;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.45 + f * 0.15, 0.92, rust);
    b.metal[i] = 1 - rust;
  });
}

/** Painted steel (radiators, machinery, gates) with chips revealing rust. Alpha = metalness. */
export function paintedMetal(b: TexBuilder, paint = '#4a5a48'): void {
  const nz = b.noise;
  const pc = hex(paint);
  b.alphaMode = 'metal';
  b.normalStrength = 1.2;
  b.cavity = 0.4;
  b.each((u, v, i) => {
    const chipN = nz.fbm(u, v, 14, 5) * 0.5 + 0.5;
    const chip = smoothstep(0.69, 0.72, chipN);
    const halo = smoothstep(0.64, 0.69, chipN) - chip;
    const f = nz.fbm(u, v, 40, 3) * 0.5 + 0.5;
    let c = pc.map((x) => x * (0.85 + f * 0.15));
    c = mix3(c, hex('#8a8474'), smoothstep(0.0, 1.0, nz.fbm(u + 2, v + 3, 3, 4)) * 0.3);
    const rustC = mix3(hex('#6e3b1c'), hex('#4a2a18'), f);
    c = mix3(c, mix3(c, rustC, 0.5), halo);
    c = mix3(c, rustC, chip);
    const [stain] = waterStain(nz, u, v, 3, 0.25);
    c = mix3(c, hex('#5b3c22'), stain * 0.3);
    b.h[i] = 0.7 - chip * 0.08 + halo * 0.02;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.5 + f * 0.2, 0.9, chip);
    b.metal[i] = 0;
  });
}

/** Galvanised corrugated sheet with rust run-off (2 m tile, corrugation along u). Alpha = metalness. */
export function corrugated(b: TexBuilder): void {
  const nz = b.noise;
  b.alphaMode = 'metal';
  b.normalStrength = 2.2;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    const wave = Math.sin(u * Math.PI * 2 * 26) * 0.5 + 0.5;
    const streak = smoothstep(0.2, 0.8, nz.fbm2(u, v, 60, 3, 4, 0.6) * 0.5 + 0.5);
    const rustBand = smoothstep(0.45, 0.65, nz.fbm(u, v, 3, 5) * 0.5 + 0.5);
    const f = nz.fbm(u, v, 50, 3) * 0.5 + 0.5;
    let c = mix3(hex('#7a7c7a'), hex('#9a9c98'), f);
    const rust = clamp(rustBand * 0.8 + streak * rustBand * 0.6);
    c = mix3(c, mix3(hex('#7a4020'), hex('#4f2c18'), f), rust);
    c = mix3(c, hex('#3d3a33'), smoothstep(0.0, 1.0, nz.fbm(u + 4, v, 2, 4)) * 0.3);
    b.h[i] = wave * 0.8 + rust * 0.03;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = lerp(0.4, 0.9, rust);
    b.metal[i] = 1 - rust;
  });
}

/** Woven upholstery / curtain fabric, faded and dusty. 0.5 m tile. */
export function fabric(b: TexBuilder, base = '#5a4a3a', pattern: 'plain' | 'check' | 'floral' = 'plain', accent = '#7a6040'): void {
  const nz = b.noise;
  const bc = hex(base), ac = hex(accent);
  b.normalStrength = 1.4;
  b.cavity = 0.4;
  const T = Math.min(220, Math.floor(b.n / 5)); // threads per tile (kept below Nyquist)
  b.each((u, v, i) => {
    const wu = Math.sin(u * T * Math.PI * 2), wv = Math.sin(v * T * Math.PI * 2);
    const weave = (Math.floor(u * T) + Math.floor(v * T)) & 1 ? wu : wv;
    let c = bc;
    if (pattern === 'check') {
      const cu = Math.floor(u * 8) & 1, cv = Math.floor(v * 8) & 1;
      const line = (fract(u * 8) < 0.12 ? 1 : 0) + (fract(v * 8) < 0.12 ? 1 : 0);
      c = mix3(bc, ac, (cu ^ cv) * 0.35 + line * 0.3);
    } else if (pattern === 'floral') {
      const gx = fract(u * 4) - 0.5, gy = fract(v * 4 + (Math.floor(u * 4) & 1) * 0.5) - 0.5;
      const a = Math.atan2(gy, gx), r = Math.hypot(gx, gy);
      const petal = r < 0.18 + 0.08 * Math.cos(a * 5) ? 1 : 0;
      const center = r < 0.06 ? 1 : 0;
      c = mix3(bc, ac, petal * 0.6);
      c = mix3(c, hex('#c8b890'), center * 0.5);
    }
    const f = nz.fbm(u, v, 6, 4) * 0.5 + 0.5;
    c = c.map((x) => x * (0.8 + f * 0.25 + weave * 0.025));
    // fading + dust
    c = mix3(c, hex('#a59a88'), smoothstep(0.3, 1.0, nz.fbm(u + 3, v, 2, 4) * 0.5 + 0.5) * 0.35);
    const [stain, ring] = waterStain(nz, u, v, 2, 0.3);
    c = mix3(c, hex('#4a3a28'), stain * 0.25 + ring * 0.25);
    b.h[i] = 0.5 + weave * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.95;
  });
}

/** Grime on glass: alpha = opacity of dirt layer; rgb = dirt colour. 1 m tile. */
export function glassDirt(b: TexBuilder): void {
  const nz = b.noise;
  b.alphaMode = 'opacity';
  b.opacity = new Float32Array(b.n * b.n);
  b.normalStrength = 0.3;
  b.cavity = 0;
  b.each((u, v, i) => {
    const film = smoothstep(-0.3, 0.8, nz.fbm(u, v, 3, 5)) * 0.35;
    const streaks = smoothstep(0.3, 0.9, nz.fbm2(u, v, 30, 2, 4, 0.6) * 0.5 + 0.5) * 0.35;
    const spots = smoothstep(0.7, 0.85, nz.fbm(u + 3, v + 1, 40, 3) * 0.5 + 0.5) * 0.5;
    const o = clamp(film + streaks * film * 2 + spots);
    b.opacity![i] = o;
    const c = mix3(hex('#6a6252'), hex('#8c8270'), nz.fbm(u, v, 10, 3) * 0.5 + 0.5);
    b.setColor(i, c[0], c[1], c[2]);
    b.h[i] = o * 0.2;
    b.rough[i] = 0.1 + o * 0.8;
  });
}

/** 1960s marbled linoleum, worn through at seams (2 m tile). */
export function linoleum(b: TexBuilder, base = '#6f7560', vein = '#4a4f3f'): void {
  const nz = b.noise;
  const bc = hex(base), vc = hex(vein);
  b.normalStrength = 0.8;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    const marble = Math.sin((u * 6 + nz.fbm(u, v, 4, 5) * 2.5) * Math.PI * 2) * 0.5 + 0.5;
    const speck = smoothstep(0.75, 0.85, nz.fbm(u, v, 120, 2) * 0.5 + 0.5);
    let c = mix3(bc, vc, Math.pow(marble, 3) * 0.7);
    c = mix3(c, hex('#c8c4b0'), speck * 0.3);
    const seam = 1 - smoothstep(0.0, 0.003, Math.min(fract(u * 2), 1 - fract(u * 2)));
    const wear = smoothstep(0.45, 0.7, nz.fbm(u, v, 3, 5) * 0.5 + 0.5);
    c = mix3(c, hex('#3a3428'), wear * 0.3);
    const curl = seam * 0.5;
    const [stain, ring] = waterStain(nz, u, v, 2, 0.3);
    c = mix3(c, hex('#4a3e2c'), stain * 0.25 + ring * 0.3);
    c = mix3(c, hex('#141210'), seam * 0.7);
    b.h[i] = 0.6 + curl * 0.2 - seam * 0.3;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.35 + wear * 0.45 + stain * 0.1;
  });
}

/** Corrugated cardboard, water-stained (1 m tile). */
export function cardboard(b: TexBuilder): void {
  const nz = b.noise;
  b.normalStrength = 0.8;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    const flute = Math.sin(u * 140 * Math.PI * 2) * 0.5 + 0.5;
    const f = nz.fbm(u, v, 20, 3) * 0.5 + 0.5;
    let c = mix3(hex('#8a6d48'), hex('#a5865a'), f);
    const [stain, ring] = waterStain(nz, u, v, 2, 0.15);
    c = mix3(c, hex('#5a4228'), stain * 0.4 + ring * 0.35);
    c = c.map((x) => x * (0.97 + flute * 0.03));
    b.h[i] = 0.5 + flute * 0.05 + stain * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.92;
  });
}

/** Old hay / straw (1 m tile). */
export function hay(b: TexBuilder): void {
  const nz = b.noise;
  const rnd = mulberry(9);
  b.normalStrength = 2.4;
  b.cavity = 0.8;
  b.cavityRadius = 0.006;
  b.each((u, v, i) => {
    const c = mix3(hex('#3e3420'), hex('#5a4a2a'), nz.fbm(u, v, 20, 3) * 0.5 + 0.5);
    b.setColor(i, c[0], c[1], c[2]);
    b.h[i] = 0;
    b.rough[i] = 0.95;
  });
  for (let k = 0; k < 9000; k++) {
    const cu = rnd(), cv = rnd(), ang = rnd() * Math.PI;
    const len = 0.03 + rnd() * 0.06;
    const col = mix3(hex('#8a7a52'), hex('#a8986a'), rnd()).map((x) => x * (0.55 + rnd() * 0.5));
    const hh = rnd();
    stamp(b, cu, cv, len, 0.0016 + rnd() * 0.001, ang, (lx, ly, i) => {
      if (Math.abs(ly) > 1 || Math.abs(lx) > 1) return;
      const hv = hh + (1 - ly * ly) * 0.05;
      if (b.h[i] > hv) return;
      b.h[i] = hv;
      const cc = col.map((x) => x * (0.75 + (1 - ly * ly) * 0.35));
      b.setColor(i, cc[0], cc[1], cc[2]);
      b.rough[i] = 0.75;
    });
  }
}

/**
 * Wallpapers. 2 m tile, roll width 0.53 m → seams every ~0.5 m (4 strips/tile).
 * variant 0: 1930s stripes, 1: 1950s floral lattice, 2: 1970s geometric.
 */
export function wallpaper(b: TexBuilder, variant: 0 | 1 | 2): void {
  const nz = b.noise;
  b.normalStrength = 0.9;
  b.cavity = 0.4;
  const palettes = [
    [hex('#8c9480'), hex('#a7ad98'), hex('#5f6a58')],
    [hex('#b9ab8c'), hex('#8a6f50'), hex('#6c7a5a')],
    [hex('#b4844a'), hex('#7a4a28'), hex('#d0b080')],
  ];
  const [p0, p1, p2] = palettes[variant];
  const strips = 4;
  b.each((u, v, i) => {
    const su = u * strips;
    const strip = Math.floor(su);
    const lu = su - strip;
    const seamD = Math.min(lu, 1 - lu);
    // pattern in metres
    const x = u * 2, y = v * 2;
    let c: number[];
    if (variant === 0) {
      const s = fract(x * 8);
      const band = s < 0.5 ? 1 : 0;
      const pin = Math.abs(s - 0.75) < 0.02 ? 1 : 0;
      c = mix3(p0, p1, band * 0.6);
      c = mix3(c, p2, pin * 0.8);
      // small motif in band
      const mx = fract(x * 8) - 0.25, my = fract(y * 6) - 0.5;
      if (band && Math.hypot(mx * 2, my) < 0.08) c = mix3(c, p2, 0.6);
    } else if (variant === 1) {
      const gx = fract(x * 5 + (Math.floor(y * 5) & 1) * 0.5) - 0.5, gy = fract(y * 5) - 0.5;
      const diamond = Math.abs(gx) + Math.abs(gy);
      const lattice = Math.abs(diamond - 0.48) < 0.025 ? 1 : 0;
      const a = Math.atan2(gy, gx), r = Math.hypot(gx, gy);
      const flower = r < 0.12 + 0.05 * Math.cos(a * 6) ? 1 : 0;
      const leaf = Math.abs(gy - gx * 0.6) < 0.03 && r < 0.3 && r > 0.12 ? 1 : 0;
      c = mix3(p0, p1, flower * 0.75);
      c = mix3(c, p2, leaf * 0.7 + lattice * 0.4);
    } else {
      const gx = fract(x * 3) - 0.5, gy = fract(y * 3) - 0.5;
      const r = Math.hypot(gx, gy * 1.3);
      const ringA = Math.abs(r - 0.32) < 0.06 ? 1 : 0;
      const ringB = Math.abs(r - 0.18) < 0.05 ? 1 : 0;
      const dot = r < 0.07 ? 1 : 0;
      c = mix3(p0, p1, ringA * 0.85);
      c = mix3(c, p2, ringB * 0.8 + dot * 0.9);
    }
    // ageing: fade towards paper colour, yellowing, sun-bleach variations per strip
    const fade = 0.25 + idRand(strip, 3) * 0.2 + (nz.fbm(u, v, 2, 4) * 0.5 + 0.5) * 0.25;
    c = mix3(c, hex('#c2b598'), fade);
    const [stain, ring] = waterStain(nz, u, v, 2, 0.34);
    c = mix3(c, hex('#8a6a40'), stain * 0.22);
    c = mix3(c, hex('#4e3a22'), ring * 0.3);
    // mould
    const mould = smoothstep(0.6, 0.82, nz.fbm(u + 5, v + 3, 18, 4) * 0.5 + 0.5) * smoothstep(0.2, 0.6, stain + 0.3);
    c = mix3(c, hex('#262a20'), mould * 0.7);
    // peeling: near seams paper lifted, some torn off showing plaster
    const peelN = nz.fbm(u + strip * 0.37, v, 4, 4) * 0.5 + 0.5;
    const torn = seamD < 0.08 + peelN * 0.25 && peelN > 0.62 ? 1 : 0;
    const lifted = smoothstep(0.08, 0.0, seamD) * smoothstep(0.45, 0.6, peelN);
    if (torn) c = mix3(hex('#a8a090'), hex('#8a8272'), nz.fbm(u, v, 40, 3) * 0.5 + 0.5);
    const seamLine = 1 - smoothstep(0.0, 0.004, seamD);
    c = c.map((x) => x * (1 - seamLine * 0.35));
    const f = nz.fbm(u, v, 90, 2) * 0.5 + 0.5;
    b.h[i] = 0.7 + f * 0.02 + lifted * 0.2 - torn * 0.15;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.85 - stain * 0.05;
  });
}

/** Oil-paint dado (Ölsockel) – glossy institutional green/brown with chips, 2 m tile. */
export function oilDado(b: TexBuilder, paint = '#4f5e4a'): void {
  const nz = b.noise;
  const pc = hex(paint);
  b.normalStrength = 0.8;
  b.cavity = 0.3;
  b.each((u, v, i) => {
    const f = nz.fbm(u, v, 30, 3) * 0.5 + 0.5;
    const brush = nz.fbm2(u, v, 80, 4, 2, 0.5) * 0.5 + 0.5;
    const chip = smoothstep(0.66, 0.7, nz.fbm(u + 3, v + 1, 10, 5) * 0.5 + 0.5);
    let c = pc.map((x) => x * (0.9 + f * 0.1 + brush * 0.05));
    c = mix3(c, hex('#b8b0a0'), chip);
    const scuff = smoothstep(0.7, 0.9, nz.fbm2(u, v, 6, 40, 3, 0.5) * 0.5 + 0.5);
    c = mix3(c, hex('#2a2a24'), scuff * 0.3);
    const cracks = crackNetwork(nz, u, v, 8, 0.02, 0.03);
    c = c.map((x) => x * (1 - cracks * 0.4));
    b.h[i] = 0.7 + brush * 0.02 - chip * 0.05 - cracks * 0.05;
    b.setColor(i, c[0], c[1], c[2]);
    b.rough[i] = 0.3 + f * 0.1 + chip * 0.5 + scuff * 0.3;
  });
}
