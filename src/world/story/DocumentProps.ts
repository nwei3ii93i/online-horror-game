import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import { DOCUMENTS_BY_ID, StoryDocument } from './documents';
import { DOC_FONTS } from '../../ui/DocumentReader';
import { MANOR } from '../buildings/Manor';
import type { Physics } from '../../physics/Physics';
import { GROUP } from '../../physics/Physics';
import type { Interaction } from '../../gameplay/Interaction';
import { worldUniforms } from '../../render/WorldUniforms';
import { RNG } from '../../core/Random';

/** Where each manor document lies. 'flat' on a surface (y = surface height) or pinned to a wall. */
export interface DocPlacement { id: string; x: number; y: number; z: number; rot: number; wall?: [number, number] }

const { B0, G0, U0 } = MANOR;
export const MANOR_DOCS: DocPlacement[] = [
  { id: 'poster_missing_1987', x: -1.8, y: G0 + 1.55, z: -18.279, rot: 0, wall: [0, -1] },
  { id: 'friedrich_note_1989', x: 2.48, y: G0 + 1.212, z: -20.7, rot: 0.3 },
  { id: 'news_ooen_1987_11_17', x: -9.95, y: G0 + 0.552, z: -18.55, rot: -0.25 },
  { id: 'helga_to_gerti_1989', x: -7.25, y: G0 + 0.882, z: -25.65, rot: 0.18 },
  { id: 'gendarmerie_statement_1987', x: 5.35, y: G0 + 0.832, z: -16.3, rot: 0.1 },
  { id: 'bank_letter_1990', x: 5.95, y: G0 + 0.834, z: -16.36, rot: -0.3 },
  { id: 'helga_to_fritz_1990', x: -5.45, y: U0 + 0.702, z: -21.8, rot: 0.2 },
  { id: 'news_bote_1987_11_26', x: -9.0, y: U0 + 0.004, z: -17.65, rot: 0.6 },
  { id: 'marie_school_1987', x: 5.3, y: U0 + 0.832, z: -15.95, rot: 0.05 },
  { id: 'helga_note_1991', x: 5.95, y: U0 + 0.702, z: -20.8, rot: -0.2 },
  { id: 'oma_prayer_card_1988', x: -11.45, y: U0 + 0.622, z: -22.6, rot: 0.4 },
  { id: 'photo_back_1986', x: 8.7, y: U0 + 0.352, z: -16.2, rot: -0.5 },
  { id: 'log_1991', x: -5.0, y: B0 + 0.004, z: -24.3, rot: 1.1 },
  { id: 'receipt_schoolbooks_1989', x: 11.9, y: B0 + 0.652, z: -18.45, rot: 0.3 },
  { id: 'drawing_1995', x: -11.75, y: B0 + 0.622, z: -23.0, rot: 1.4 },
  { id: 'note_mama', x: -9.35, y: B0 + 0.172, z: -26.5, rot: -0.4 },
];

/** Physical size (metres) by kind. */
function paperSize(d: StoryDocument): [number, number] {
  switch (d.kind) {
    case 'official': return d.id.startsWith('poster') ? [0.297, 0.42] : [0.21, 0.297];
    case 'newspaper': return [0.22, 0.3];
    case 'receipt': return [0.09, 0.2];
    case 'photo_back': return [0.13, 0.09];
    case 'logbook': return [0.3, 0.21];
    case 'drawing': case 'calendar': return [0.21, 0.297];
    case 'note': return d.id.includes('prayer') ? [0.07, 0.11] : [0.148, 0.21];
    default: return [0.148, 0.21];
  }
}

const INK: Record<string, string> = {
  handwriting_neat: '#1d2850', handwriting_shaky: '#2a2a40', handwriting_child: '#3c3c48', typewriter: '#1b1916', print: '#14130f', stamp: '#5a1d18',
};

/** Paper texture with the actual text on it (legible when held close). */
function paperTexture(d: StoryDocument, w: number, h: number, seed: number): THREE.CanvasTexture {
  const ppm = 1500; // pixels per metre
  const cw = Math.min(512, Math.round(w * ppm)), ch = Math.round(cw * (h / w));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d')!;
  const rng = new RNG(seed);
  const base = d.kind === 'newspaper' ? '#cdc5ae' : d.kind === 'photo_back' ? '#e4e0d6' : d.kind === 'logbook' ? '#d6cba9' : '#ddd3ba';
  g.fillStyle = base; g.fillRect(0, 0, cw, ch);
  // age: stains, darker edges
  for (let i = 0; i < 7; i++) {
    const x = rng.float() * cw, y = rng.float() * ch, r = (0.1 + rng.float() * 0.35) * cw;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(120, 90, 40, ${0.05 + rng.float() * 0.1})`); gr.addColorStop(1, 'rgba(120,90,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
  }
  const edge = g.createLinearGradient(0, 0, cw, 0);
  edge.addColorStop(0, 'rgba(80,60,30,0.18)'); edge.addColorStop(0.08, 'rgba(0,0,0,0)'); edge.addColorStop(0.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(80,60,30,0.18)');
  g.fillStyle = edge; g.fillRect(0, 0, cw, ch);
  if (d.kind === 'logbook') {
    g.strokeStyle = 'rgba(70,100,150,0.35)'; g.lineWidth = 1;
    for (let y = ch * 0.1; y < ch; y += cw * 0.045) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cw / 2 - 1, 0, 2, ch); // spine
  }
  const margin = cw * 0.09;
  let y = margin;
  const ink = INK[d.style] ?? '#222';
  if (d.id.startsWith('poster')) {
    g.fillStyle = '#111'; g.font = `bold ${cw * 0.15}px Georgia, serif`; g.textAlign = 'center';
    g.fillText('VERMISST', cw / 2, y + cw * 0.13); y += cw * 0.2;
    g.fillStyle = '#7d7a72'; g.fillRect(cw * 0.25, y, cw * 0.5, cw * 0.6);
    g.fillStyle = '#5b5850'; g.beginPath(); g.ellipse(cw / 2, y + cw * 0.24, cw * 0.11, cw * 0.14, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(cw * 0.33, y + cw * 0.4, cw * 0.34, cw * 0.2);
    y += cw * 0.68;
    g.textAlign = 'left';
  }
  if (d.kind === 'newspaper') {
    g.fillStyle = ink; g.font = `bold ${cw * 0.065}px Georgia, serif`;
    y = wrap(g, d.title.de, margin, y + cw * 0.06, cw - 2 * margin, cw * 0.075, 3);
    g.fillRect(margin, y, cw - 2 * margin, 1.5); y += cw * 0.04;
  }
  const size = d.style === 'print' || d.style === 'typewriter' ? cw * 0.034 : d.style === 'handwriting_child' ? cw * 0.05 : cw * 0.043;
  g.fillStyle = ink;
  g.font = `${size}px ${DOC_FONTS[d.style]}`;
  if (d.kind === 'drawing') {
    // crayon scribbles over the page
    const cols = ['#4a6a3a', '#7a4a2a', '#2a3a6a', '#6a6a6a'];
    for (let k = 0; k < 9; k++) {
      g.strokeStyle = cols[k % cols.length]; g.lineWidth = 2 + rng.float() * 3; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(rng.float() * cw, ch * (0.3 + rng.float() * 0.6));
      for (let s = 0; s < 6; s++) g.lineTo(rng.float() * cw, ch * (0.3 + rng.float() * 0.6));
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  wrap(g, d.de, margin, y + size, cw - 2 * margin, size * 1.35, 400, d.kind === 'newspaper' ? 2 : 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Word-wrap text into the canvas (optionally in columns); returns the next y. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lh: number, maxLines: number, cols = 1): number {
  const colW = (width - (cols - 1) * 10) / cols;
  const h = g.canvas.height;
  let col = 0, cx = x, cy = y, lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > colW && line) {
        g.fillText(line, cx, cy); cy += lh; lines++; line = w;
        if (cy > h - lh) { if (++col >= cols) return cy; cx = x + col * (colW + 10); cy = y; }
        if (lines >= maxLines) return cy;
      } else line = test;
    }
    g.fillText(line, cx, cy); cy += lh; lines++;
    if (cy > h - lh) { if (++col >= cols) return cy; cx = x + col * (colW + 10); cy = y; }
  }
  return cy;
}

/** Paper meshes for the documents + interaction triggers. */
export function placeDocuments(placements: DocPlacement[], physics: Physics, interaction: Interaction, onRead: (d: StoryDocument) => void): THREE.Group {
  const group = new THREE.Group();
  group.name = 'documents';
  placements.forEach((p, i) => {
    const d = DOCUMENTS_BY_ID[p.id];
    if (!d) return;
    const [w, h] = paperSize(d);
    const map = paperTexture(d, w, h, 4100 + i);
    const mat = new THREE.MeshStandardNodeMaterial();
    const A = texture(map, uv());
    mat.colorNode = A;
    mat.roughnessNode = float(0.88);
    (mat as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
    mat.side = THREE.DoubleSide;
    const geo = new THREE.PlaneGeometry(w, h, 4, 4);
    // slight curl so papers don't read as decals
    const pos = geo.getAttribute('position');
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.pow(Math.abs(pos.getX(k)) / (w / 2), 2) * 0.004);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    if (p.wall) {
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = Math.atan2(p.wall[0], p.wall[1]);
      m.rotation.z = p.rot;
    } else {
      m.position.set(p.x, p.y + 0.002, p.z);
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), p.rot);
    }
    group.add(m);
    const col = physics.addBox({ cx: p.x, cy: p.y + (p.wall ? 0 : 0.02), cz: p.z, hx: Math.max(w, h) / 2 + 0.03, hy: p.wall ? h / 2 : 0.04, hz: p.wall ? 0.03 : Math.max(w, h) / 2 + 0.03, surface: 'wood' }, GROUP.TRIGGER);
    interaction.register(col, {
      id: `doc:${d.id}`,
      range: 2.0,
      prompt: () => `Lesen: ${d.title.de}`,
      interact: () => onRead(d),
    });
  });
  return group;
}
