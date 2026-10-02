/**
 * Text decals: inscriptions, plates, carvings, stencils and labels drawn into one canvas atlas
 * per site and rendered as a single transparent mesh (one draw call however many signs).
 */
import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import { RNG } from '../../core/Random';
import { worldUniforms } from '../../render/WorldUniforms';

type N3 = [number, number, number];
const PI = Math.PI;
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export type DrawFn = (g: CanvasRenderingContext2D, w: number, h: number) => void;
export interface DecalReq { pos: number[][]; nrm: number[]; pw: number; ph: number; draw: DrawFn; x: number; y: number }

export class TextDecals {
  private reqs: DecalReq[] = [];
  constructor(private name: string, private ppm: number, private exterior: boolean) {}

  /** Panel w×h (m) centred at c; text runs along `right`, upward along `up`, and faces right×up. */
  add(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, draw: DrawFn, ppm = this.ppm, lift = 0.003): void {
    const r = right.clone().normalize(), u = up.clone().normalize();
    const n = new THREE.Vector3().crossVectors(r, u).normalize();
    const o = c.clone().addScaledVector(n, lift);
    const P = (sx: number, sy: number) => o.clone().addScaledVector(r, (sx * w) / 2).addScaledVector(u, (sy * h) / 2).toArray();
    this.reqs.push({ pos: [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], nrm: n.toArray(), pw: Math.max(8, Math.ceil(w * ppm)), ph: Math.max(8, Math.ceil(h * ppm)), draw, x: 0, y: 0 });
  }

  /** Same, with centre / axes given in the local frame of matrix m (rotation + translation only). */
  addLocal(m: THREE.Matrix4, c: N3, right: N3, up: N3, w: number, h: number, draw: DrawFn, ppm = this.ppm, lift = 0.003): void {
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.add(V3(c[0], c[1], c[2]).applyMatrix4(m), V3(right[0], right[1], right[2]).applyQuaternion(q), V3(up[0], up[1], up[2]).applyQuaternion(q), w, h, draw, ppm, lift);
  }

  private pack(S: number, scale: number): number {
    const PAD = 3;
    const order = this.reqs.map((_, i) => i).sort((a, b) => this.reqs[b].ph - this.reqs[a].ph);
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const r = this.reqs[i];
      const pw = Math.ceil(r.pw * scale) + 2 * PAD, ph = Math.ceil(r.ph * scale) + 2 * PAD;
      if (pw > S) return Infinity;
      if (x + pw > S) { x = 0; y += rowH; rowH = 0; }
      r.x = x + PAD; r.y = y + PAD;
      x += pw; rowH = Math.max(rowH, ph);
    }
    return y + rowH;
  }

  build(): THREE.Mesh | null {
    if (!this.reqs.length || typeof document === 'undefined') return null;
    let S = 256, scale = 1, H = Infinity;
    for (;;) {
      H = this.pack(S, scale);
      if (H <= S) break;
      if (S < 2048) S *= 2; else scale *= 0.85;
      if (scale < 0.05) break;
    }
    let CH = 32;
    while (CH < H && CH < S) CH *= 2;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = CH;
    const g = canvas.getContext('2d');
    if (!g) return null;
    for (const r of this.reqs) {
      r.pw = Math.ceil(r.pw * scale); r.ph = Math.ceil(r.ph * scale);
      g.save();
      g.translate(r.x, r.y);
      g.beginPath(); g.rect(0, 0, r.pw, r.ph); g.clip();
      r.draw(g, r.pw, r.ph);
      g.restore();
    }
    const n = this.reqs.length;
    const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uvs = new Float32Array(n * 8);
    const idx: number[] = [];
    this.reqs.forEach((r, k) => {
      const u0 = r.x / S, u1 = (r.x + r.pw) / S, vTop = 1 - r.y / CH, vBot = 1 - (r.y + r.ph) / CH;
      const uv4 = [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]];
      for (let j = 0; j < 4; j++) {
        pos.set(r.pos[j], (k * 4 + j) * 3);
        nor.set(r.nrm, (k * 4 + j) * 3);
        uvs.set(uv4[j], (k * 4 + j) * 2);
      }
      const b = k * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = `${this.name}_inscriptions`;
    const A = texture(tex, uv());
    mat.colorNode = A;
    mat.opacityNode = A.a;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.roughnessNode = float(0.82);
    (mat as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
    if (this.exterior) mat.userData.exterior = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${this.name}:inscriptions`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    return mesh;
  }
}

export const FONT_ROMAN = 'Georgia, "Times New Roman", "Nimbus Roman", "DejaVu Serif", serif';
export const FONT_SANS = 'Arial, Helvetica, "DejaVu Sans", sans-serif';
export const FONT_PAINT = '"Segoe Script", "Bradley Hand", "Brush Script MT", "URW Chancery L", cursive';
export const FONT_ROUND = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive';

export interface TextStyle {
  font: string;
  mode: 'engrave' | 'gild' | 'paint';
  color?: string;
  weight?: string;
  lead?: number;
  pad?: number;
  /** Letter erosion 0..1 (weathering). */
  wear?: number;
  seed?: number;
}
export type Line = { t: string; s?: number; color?: string; crisp?: boolean };

export function paintText(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, st: TextStyle, color?: string): void {
  if (st.mode === 'engrave') {
    g.fillStyle = 'rgba(236,232,222,0.32)';
    g.fillText(t, x + size * 0.05, y + size * 0.06);
    g.fillStyle = color ?? st.color ?? 'rgba(26,25,23,0.84)';
    g.fillText(t, x, y);
  } else if (st.mode === 'gild') {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(t, x - size * 0.04, y - size * 0.04);
    const gr = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    gr.addColorStop(0, '#f2da92'); gr.addColorStop(0.5, '#bd913c'); gr.addColorStop(1, '#7c5c24');
    g.fillStyle = color ?? gr;
    g.fillText(t, x, y);
  } else {
    g.fillStyle = color ?? st.color ?? '#202020';
    g.fillText(t, x, y);
  }
}

/** Centred block of lines filling the panel (lines shrink to fit the width). */
export function textBlock(lines: Line[], st: TextStyle): DrawFn {
  return (g, w, h) => {
    const lead = st.lead ?? 1.32;
    const padX = w * (st.pad ?? 0.06), padY = h * (st.pad ?? 0.06);
    const total = lines.reduce((a, l) => a + (l.s ?? 1), 0) * lead;
    const unit = (h - 2 * padY) / Math.max(total, 1e-3);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let y = padY;
    const crispRows: [number, number][] = [];
    for (const l of lines) {
      const s = l.s ?? 1;
      let size = unit * s * 0.9;
      const font = (sz: number) => `${st.weight ? `${st.weight} ` : ''}${sz.toFixed(1)}px ${st.font}`;
      g.font = font(size);
      const mw = g.measureText(l.t).width;
      if (mw > w - 2 * padX) { size *= (w - 2 * padX) / mw; g.font = font(size); }
      const cy = y + (unit * s * lead) / 2;
      if (l.t) paintText(g, l.t, w / 2, cy, size, st, l.color);
      if (l.crisp) crispRows.push([y, y + unit * s * lead]);
      y += unit * s * lead;
    }
    if (st.wear && st.wear > 0) erode(g, w, h, st.wear, st.seed ?? 1, crispRows);
  };
}

/** Weathering: punch speckles out of the letters (except in crisp rows). */
export function erode(g: CanvasRenderingContext2D, w: number, h: number, wear: number, seed: number, keep: [number, number][] = []): void {
  const rng = new RNG(seed);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h * 0.004 * wear);
  for (let i = 0; i < n; i++) {
    const x = rng.float() * w, y = rng.float() * h;
    if (keep.some(([a, b]) => y > a && y < b)) continue;
    const r = (0.6 + rng.float() * 2.2) * Math.max(1, w / 300);
    g.globalAlpha = 0.4 + rng.float() * 0.6;
    g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
  }
  // a few long cracks / lichen gaps
  for (let i = 0; i < Math.round(3 * wear); i++) {
    g.globalAlpha = 0.7;
    g.lineWidth = 1 + rng.float() * 2;
    g.beginPath();
    let x = rng.float() * w, y = rng.float() * h;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rng.range(-w * 0.1, w * 0.1); y += rng.range(-h * 0.08, h * 0.08); g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
}

/** Lichen / dirt blotches on a stone face (drawn behind the letters). */
export function lichen(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const rng = new RNG(seed);
  const n = Math.round(4 + amount * 14);
  for (let i = 0; i < n; i++) {
    const x = rng.float() * w, y = rng.float() * h, r = (0.04 + rng.float() * 0.12) * Math.min(w, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rng.chance(0.6) ? '150,160,110' : '205,200,170';
    gr.addColorStop(0, `rgba(${c},${0.18 + rng.float() * 0.25})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

export function enamelPlate(lines: Line[], wear: number, seed: number): DrawFn {
  return (g, w, h) => {
    g.save();
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, PI * 2); g.clip();
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1d2440'; g.lineWidth = Math.max(2, w * 0.035);
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - w * 0.06, h / 2 - h * 0.08, 0, 0, PI * 2); g.stroke();
    textBlock(lines, { font: FONT_ROMAN, mode: 'paint', color: '#16161a', pad: 0.18, lead: 1.25 })(g, w, h);
    // chipped enamel showing rusty iron
    const rng = new RNG(seed);
    const n = Math.round(4 + wear * 26);
    for (let i = 0; i < n; i++) {
      const edge = rng.chance(0.7);
      const a = rng.float() * PI * 2;
      const x = edge ? w / 2 + Math.cos(a) * (w / 2 - 3) : rng.float() * w, y = edge ? h / 2 + Math.sin(a) * (h / 2 - 3) : rng.float() * h;
      g.fillStyle = rng.chance(0.5) ? '#4a2e1c' : '#2a2420';
      g.beginPath(); g.ellipse(x, y, rng.range(1, 6) * (w / 180), rng.range(1, 4) * (w / 180), rng.float() * PI, 0, PI * 2); g.fill();
    }
    g.restore();
  };
}

export function carving(text: string, fresh: boolean): DrawFn {
  return (g, w, h) => {
    if (fresh) {
      g.fillStyle = '#d9c9a2';
      g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0.2, 0, PI * 2); g.fill();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * 0.8;
    g.font = `700 ${size}px ${FONT_SANS}`;
    const mw = g.measureText(text).width;
    if (mw > w * 0.92) { size *= (w * 0.92) / mw; g.font = `700 ${size}px ${FONT_SANS}`; }
    g.fillStyle = fresh ? 'rgba(150,120,80,0.9)' : 'rgba(205,190,160,0.55)';
    g.fillText(text, w / 2 + 1, h / 2 + 1);
    g.fillStyle = fresh ? 'rgba(70,50,30,0.85)' : 'rgba(30,24,18,0.8)';
    g.fillText(text, w / 2, h / 2);
  };
}
