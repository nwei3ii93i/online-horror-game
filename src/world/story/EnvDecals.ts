import * as THREE from 'three/webgpu';
import type { Anchor } from '../architecture/BuildingKit';
import { TextDecals, textBlock, erode, FONT_SANS, FONT_ROUND, type DrawFn } from './TextDecals';
import { ENV_TEXT } from './environment_text';
import { BARN_RACK } from '../buildings/Outbuildings';
import { RNG } from '../../core/Random';

/**
 * Painted, stencilled and taped texts at the anchors the outbuildings and tunnels leave for
 * them: the 1958 tunnel stencils, the workshop and pump-house signs, Josef's generator note,
 * the February 1993 calendar and the numbers on the fourteen diesel cans. One atlas mesh per
 * building and side (interior / exterior, so exterior text skips the lamp pool).
 */

const PI = Math.PI;
const FONT_STENCIL = '"Arial Black", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';
const FONT_PENCIL = '"Courier New", "Nimbus Mono PS", "DejaVu Sans Mono", monospace';

/** Anchor frame: `right` along the wall, `up` vertical, normal = rotation of +Z by ry. */
function frame(a: Anchor): { right: THREE.Vector3; up: THREE.Vector3; n: THREE.Vector3 } {
  return {
    right: new THREE.Vector3(Math.cos(a.ry), 0, -Math.sin(a.ry)),
    up: new THREE.Vector3(0, 1, 0),
    n: new THREE.Vector3(Math.sin(a.ry), 0, Math.cos(a.ry)),
  };
}

function arrowPath(g: CanvasRenderingContext2D, x: number, y: number, len: number, t: number, dir: 1 | -1): void {
  const head = t * 2.4, hl = t * 2.2;
  const tip = dir > 0 ? x + len : x, tail = dir > 0 ? x : x + len;
  const neck = tip - dir * hl;
  g.beginPath();
  g.moveTo(tail, y - t / 2);
  g.lineTo(neck, y - t / 2);
  g.lineTo(neck, y - head / 2);
  g.lineTo(tip, y);
  g.lineTo(neck, y + head / 2);
  g.lineTo(neck, y + t / 2);
  g.lineTo(tail, y + t / 2);
  g.closePath();
  g.fill();
}

/** Sprayed through a stencil: bridged letters, soft overspray, a few runs. */
function stencil(text: string, seed: number): DrawFn {
  let arrow: 0 | 1 | -1 = 0;
  let t = text;
  if (t.endsWith('→')) { arrow = 1; t = t.slice(0, -1).trim(); }
  if (t.startsWith('←')) { arrow = -1; t = t.slice(1).trim(); }
  return (g, w, h) => {
    const rng = new RNG(seed);
    let size = h * 0.7;
    const font = () => `900 ${size.toFixed(1)}px ${FONT_STENCIL}`;
    g.font = font();
    const aw = arrow ? size * 1.5 : 0, gap = arrow ? size * 0.35 : 0;
    const tw = g.measureText(t).width;
    const fit = Math.min(1, (w * 0.94 - aw - gap) / tw);
    size *= fit;
    g.font = font();
    const total = g.measureText(t).width + (arrow ? size * 1.5 + size * 0.35 : 0);
    let x = (w - total) / 2;
    const y = h / 2;
    const ink = 'rgba(20,19,18,0.9)';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = ink;
    g.shadowColor = 'rgba(20,19,18,0.6)';
    g.shadowBlur = size * 0.07;
    const bridges: number[] = [];
    const drawArrow = (dir: 1 | -1) => { arrowPath(g, x, y, size * 1.5, size * 0.26, dir); x += size * 1.5 + size * 0.35; };
    if (arrow < 0) drawArrow(-1);
    for (const ch of t) {
      const cw = g.measureText(ch).width;
      g.fillText(ch, x, y + rng.range(-0.01, 0.01) * size);
      if (!/[\sIL1T7J]/.test(ch)) bridges.push(x + cw / 2);
      x += cw;
    }
    if (arrow > 0) { x += size * 0.35; drawArrow(1); }
    g.shadowBlur = 0;
    // stencil bridges
    g.globalCompositeOperation = 'destination-out';
    const bw = Math.max(1.5, size * 0.07);
    for (const bx of bridges) g.fillRect(bx - bw / 2, y - size * 0.7, bw, size * 1.4);
    g.globalCompositeOperation = 'source-over';
    // overspray specks and runs
    for (let i = 0; i < Math.round(w * h * 0.002); i++) {
      g.fillStyle = `rgba(20,19,18,${(rng.float() * 0.3).toFixed(2)})`;
      const sx = rng.range(w * 0.04, w * 0.96), sy = y + rng.range(-0.75, 0.75) * size;
      g.fillRect(sx, sy, 1.2, 1.2);
    }
    g.strokeStyle = 'rgba(20,19,18,0.55)';
    for (let i = 0; i < 4; i++) {
      const rx = rng.range(w * 0.15, w * 0.85), ry0 = y + size * 0.3, len = rng.range(0.1, 0.5) * h * 0.5;
      g.lineWidth = rng.range(0.8, 1.8);
      g.beginPath(); g.moveTo(rx, ry0); g.lineTo(rx + rng.range(-0.5, 0.5), Math.min(h - 1, ry0 + len)); g.stroke();
    }
    erode(g, w, h, 0.55, seed);
  };
}

/** Hand-painted lettering straight onto the white board over the workshop gate. */
function workshopSign(seed: number): DrawFn {
  const [title, rule] = ENV_TEXT.signs.workshop.de.split(' — ');
  return (g, w, h) => {
    const rng = new RNG(seed);
    // grime running down from the top edge and the two iron pins
    for (let i = 0; i < 26; i++) {
      const x = rng.float() * w, len = rng.range(0.15, 0.9) * h;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(60,52,40,${rng.range(0.08, 0.22).toFixed(2)})`);
      gr.addColorStop(1, 'rgba(60,52,40,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, rng.range(2, 9), len);
    }
    for (const px of [0.0625, 0.9375]) {
      const gr = g.createLinearGradient(0, h * 0.5, 0, h);
      gr.addColorStop(0, 'rgba(110,52,22,0.5)'); gr.addColorStop(1, 'rgba(110,52,22,0)');
      g.fillStyle = gr; g.fillRect(px * w - 2, h * 0.5, 4, h * 0.5);
    }
    textBlock([{ t: title.toUpperCase(), s: 1.2 }, { t: rule, s: 0.95, color: 'rgba(150,24,16,0.95)' }], {
      font: FONT_SANS, weight: '700', mode: 'paint', color: 'rgba(24,22,20,0.92)', pad: 0.06, lead: 1.12, wear: 0.4, seed,
    })(g, w, h);
  };
}

/** Rectangular enamel plate (blue rim, chipped to the iron at the edges and screws). */
function enamelRect(lines: string[], seed: number): DrawFn {
  return (g, w, h) => {
    const rng = new RNG(seed);
    g.fillStyle = '#e7e3d8'; g.fillRect(0, 0, w, h);
    const rim = Math.max(2, h * 0.06);
    g.strokeStyle = '#1c2a58'; g.lineWidth = rim;
    g.strokeRect(rim * 1.3, rim * 1.3, w - rim * 2.6, h - rim * 2.6);
    textBlock(lines.map((t, i) => ({ t, s: i === 0 ? 1.25 : 0.72 })), { font: FONT_SANS, weight: '700', mode: 'paint', color: '#18234a', pad: 0.13, lead: 1.3 })(g, w, h);
    // screws with rust tears
    for (const [sx, sy] of [[0.05, 0.12], [0.95, 0.12], [0.05, 0.88], [0.95, 0.88]]) {
      const gr = g.createLinearGradient(0, sy * h, 0, sy * h + h * 0.4);
      gr.addColorStop(0, 'rgba(105,50,22,0.6)'); gr.addColorStop(1, 'rgba(105,50,22,0)');
      g.fillStyle = gr; g.fillRect(sx * w - 1.5, sy * h, 3, h * 0.4);
      g.fillStyle = '#3a3430'; g.beginPath(); g.arc(sx * w, sy * h, h * 0.025, 0, PI * 2); g.fill();
    }
    // chips (dark iron, rust halo), mostly along the edges
    for (let i = 0; i < 22; i++) {
      const edge = rng.chance(0.75);
      const x = edge && rng.chance(0.5) ? (rng.chance(0.5) ? rng.range(0, w * 0.05) : rng.range(w * 0.95, w)) : rng.float() * w;
      const y = edge && !(x < w * 0.05 || x > w * 0.95) ? (rng.chance(0.5) ? rng.range(0, h * 0.08) : rng.range(h * 0.92, h)) : rng.float() * h;
      const r = rng.range(0.004, 0.018) * w;
      g.fillStyle = 'rgba(120,62,30,0.55)'; g.beginPath(); g.ellipse(x, y, r * 1.6, r * 1.3, rng.float() * PI, 0, PI * 2); g.fill();
      g.fillStyle = '#2b2522'; g.beginPath(); g.ellipse(x, y, r, r * 0.75, rng.float() * PI, 0, PI * 2); g.fill();
    }
  };
}

/** Josef's note taped to the wall by the generator, and the copy in M.'s round letters. */
function generatorNote(seed: number): DrawFn {
  const [josef, copy] = ENV_TEXT.signs.generatorLabel;
  return (g, w, h) => {
    const rng = new RNG(seed);
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#ddd4bb'); gr.addColorStop(1, '#cfc3a2');
    g.fillStyle = gr; g.fillRect(w * 0.03, h * 0.08, w * 0.94, h * 0.88);
    // oily thumb prints
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(40,34,26,0.12)';
      g.beginPath(); g.ellipse(rng.range(0.1, 0.9) * w, rng.range(0.6, 0.9) * h, w * 0.04, h * 0.07, rng.float() * PI, 0, PI * 2); g.fill();
    }
    // two strips of yellowed tape
    for (const [tx, rot] of [[0.12, -0.35], [0.88, 0.35]]) {
      g.save(); g.translate(tx * w, h * 0.1); g.rotate(rot);
      g.fillStyle = 'rgba(214,196,140,0.65)'; g.fillRect(-w * 0.08, -h * 0.06, w * 0.16, h * 0.12);
      g.restore();
    }
    // Josef: carpenter's pencil, upright, careful, two lines
    const [a, b] = josef.de.split(' — 2 x');
    g.fillStyle = 'rgba(50,50,48,0.88)';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const fs = h * 0.15;
    g.font = `600 ${fs.toFixed(1)}px ${FONT_PENCIL}`;
    const fitTo = (s: string, max: number) => { const m = g.measureText(s).width; if (m > max) g.font = `600 ${(fs * max / m).toFixed(1)}px ${FONT_PENCIL}`; };
    fitTo(`${a} —`, w * 0.86);
    g.fillText(`${a} —`, w * 0.07, h * 0.36);
    g.fillText(`2 x${b}`, w * 0.07, h * 0.56);
    // the copy, big and round, underlined twice
    g.fillStyle = 'rgba(28,32,70,0.9)';
    g.font = `bold ${(h * 0.24).toFixed(1)}px ${FONT_ROUND}`;
    g.save(); g.translate(w * 0.2, h * 0.86); g.rotate(-0.05);
    g.fillText(copy.de, 0, 0);
    const cw = g.measureText(copy.de).width;
    g.strokeStyle = g.fillStyle; g.lineWidth = Math.max(1, h * 0.018);
    for (const dy of [h * 0.04, h * 0.075]) { g.beginPath(); g.moveTo(0, dy); g.lineTo(cw, dy + rng.range(-1, 1)); g.stroke(); }
    g.restore();
  };
}

/** Wall calendar of the co-op store, February 1993, with Josef's note on the 3rd. */
function calendar1993(seed: number): DrawFn {
  const cal = ENV_TEXT.calendar;
  const hang = cal.hanging.find((c) => c.year === 1993)!;
  const month = hang.openAt - 1;
  const [title] = hang.title.split(' · ');
  return (g, w, h) => {
    const rng = new RNG(seed);
    g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, w, h);
    // picture: winter field, spruce edge, a farmstead
    const ph = h * 0.42, px = w * 0.06, pw = w * 0.88, py = h * 0.05;
    const sky = g.createLinearGradient(0, py, 0, py + ph * 0.6);
    sky.addColorStop(0, '#9fb0c0'); sky.addColorStop(1, '#d9dcd8');
    g.fillStyle = sky; g.fillRect(px, py, pw, ph);
    g.fillStyle = '#eef0ee';
    g.beginPath(); g.moveTo(px, py + ph * 0.62);
    for (let i = 0; i <= 10; i++) g.lineTo(px + (pw * i) / 10, py + ph * (0.6 - 0.06 * Math.sin(i * 0.9 + 1)));
    g.lineTo(px + pw, py + ph); g.lineTo(px, py + ph); g.closePath(); g.fill();
    g.fillStyle = '#2f3d33';
    for (let i = 0; i < 26; i++) {
      const tx = px + rng.float() * pw * 0.55, th = ph * rng.range(0.12, 0.24), tb = py + ph * 0.6;
      g.beginPath(); g.moveTo(tx, tb - th); g.lineTo(tx - th * 0.22, tb); g.lineTo(tx + th * 0.22, tb); g.closePath(); g.fill();
    }
    g.fillStyle = '#8c8070'; g.fillRect(px + pw * 0.66, py + ph * 0.5, pw * 0.18, ph * 0.12);
    g.fillStyle = '#5a3a30';
    g.beginPath(); g.moveTo(px + pw * 0.64, py + ph * 0.51); g.lineTo(px + pw * 0.75, py + ph * 0.42); g.lineTo(px + pw * 0.86, py + ph * 0.51); g.closePath(); g.fill();
    // green band with the store's name
    g.fillStyle = '#245d36'; g.fillRect(0, py + ph + h * 0.01, w, h * 0.065);
    g.fillStyle = '#efd96a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${(h * 0.04).toFixed(1)}px ${FONT_SANS}`;
    g.fillText(title, w / 2, py + ph + h * 0.043);
    // month and grid
    const gy = py + ph + h * 0.1;
    g.fillStyle = '#202020';
    g.font = `bold ${(h * 0.045).toFixed(1)}px ${FONT_SANS}`;
    g.fillText(`${cal.months[month]} ${hang.year}`, w / 2, gy + h * 0.02);
    const first = (new Date(hang.year, month, 1).getDay() + 6) % 7;
    const days = new Date(hang.year, month + 1, 0).getDate();
    const cw = (w * 0.9) / 7, rh = h * 0.058, gx = w * 0.05, gy2 = gy + h * 0.065;
    g.font = `bold ${(h * 0.026).toFixed(1)}px ${FONT_SANS}`;
    cal.weekdays.forEach((d, i) => { g.fillStyle = i === 6 ? '#a32a22' : '#3a3a3a'; g.fillText(d, gx + cw * (i + 0.5), gy2); });
    g.font = `${(h * 0.03).toFixed(1)}px ${FONT_SANS}`;
    for (let d = 1; d <= days; d++) {
      const k = first + d - 1, col = k % 7, row = Math.floor(k / 7);
      const cx = gx + cw * (col + 0.5), cy = gy2 + rh * (row + 0.85);
      g.fillStyle = col === 6 ? '#a32a22' : '#202020';
      g.fillText(String(d), cx, cy);
      if (d === 3) {
        // "Diesel 60 l" in carpenter's pencil, the day ringed
        g.strokeStyle = 'rgba(55,55,52,0.85)'; g.lineWidth = Math.max(1, h * 0.004);
        g.beginPath(); g.ellipse(cx, cy, cw * 0.36, rh * 0.42, 0.1, 0, PI * 2); g.stroke();
        g.fillStyle = 'rgba(55,55,52,0.85)';
        g.font = `600 ${(h * 0.019).toFixed(1)}px ${FONT_PENCIL}`;
        g.fillText('Diesel 60 l', cx, cy + rh * 0.5);
        g.font = `${(h * 0.03).toFixed(1)}px ${FONT_SANS}`;
      }
    }
    // damp: brown tide marks from the bottom edge, curled foxing
    const damp = g.createLinearGradient(0, h, 0, h * 0.82);
    damp.addColorStop(0, 'rgba(120,96,60,0.35)'); damp.addColorStop(1, 'rgba(120,96,60,0)');
    g.fillStyle = damp; g.fillRect(0, h * 0.82, w, h * 0.18);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(130,100,60,${rng.range(0.05, 0.16).toFixed(2)})`;
      g.beginPath(); g.arc(rng.float() * w, rng.float() * h, rng.range(1, 4) * (w / 200), 0, PI * 2); g.fill();
    }
    // the nail hole at the top
    g.fillStyle = '#222'; g.beginPath(); g.arc(w / 2, h * 0.02, w * 0.012, 0, PI * 2); g.fill();
  };
}

/** A number painted on a jerrycan: Josef's paint for the old ones, round marker copies on the rest. */
function canNumber(label: string, old: boolean, seed: number): DrawFn {
  return (g, w, h) => {
    const rng = new RNG(seed);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save();
    g.translate(w / 2, h / 2); g.rotate(rng.range(-0.06, 0.06));
    if (old) {
      g.font = `bold ${(h * 0.78).toFixed(1)}px ${FONT_SANS}`;
      g.fillStyle = 'rgba(226,220,200,0.88)';
    } else {
      g.font = `bold ${(h * 0.72).toFixed(1)}px ${FONT_ROUND}`;
      g.fillStyle = 'rgba(238,232,214,0.92)';
    }
    g.fillText(label, 0, h * 0.04);
    g.restore();
    if (old) erode(g, w, h, 0.8, seed);
  };
}

/** Per building: the decal meshes for its anchors (interior and exterior atlases). */
export function buildEnvDecals(buildings: { id: string; anchors: Anchor[] }[]): { building: string; mesh: THREE.Mesh }[] {
  const out: { building: string; mesh: THREE.Mesh }[] = [];
  const stencils = ENV_TEXT.signs.tunnelStencils;
  for (const b of buildings) {
    const inner = new TextDecals(`${b.id}_text`, 900, false);
    const outer = new TextDecals(`${b.id}_text_ext`, 600, true);
    for (const a of b.anchors) {
      const { right, up, n } = frame(a);
      const at = (du = 0, dv = 0, dn = 0) => a.pos.clone().addScaledVector(right, du).addScaledVector(up, dv).addScaledVector(n, dn);
      switch (a.id) {
        case 'stencil_heizgang': inner.add(at(), right, up, 1.05, 0.2, stencil(stencils[0].de, 58), 500); break;
        case 'stencil_kohle': inner.add(at(), right, up, 0.62, 0.15, stencil(stencils[1].de, 59), 500); break;
        case 'stencil_pumpe': inner.add(at(), right, up, 0.62, 0.15, stencil(stencils[2].de, 60), 500); break;
        case 'workshop_sign': outer.add(at(), right, up, 1.56, 0.32, workshopSign(31), 420, 0.002); break;
        case 'pumphouse_sign': outer.add(at(), right, up, 0.52, 0.26, enamelRect(ENV_TEXT.signs.pumphouse.de.split(' · '), 1958), 1100, 0.001); break;
        // beside the cable conduit that runs down the wall at the anchor
        case 'generator_label': inner.add(at(0.24), right, up, 0.21, 0.12, generatorNote(1993), 2400, 0.002); break;
        case 'pumphouse_calendar': inner.add(at(), right, up, 0.3, 0.46, calendar1993(1993), 1700, 0.002); break;
        case 'barn_diesel_cans': {
          // anchor sits on the upper shelf at the rack centre; the cans stand on both shelves
          const F = a.pos.y - BARN_RACK.upper;
          const labels = ENV_TEXT.dieselCans.labels;
          const CAN_W = 0.35, CAN_D = 0.172, CAN_H = 0.455;
          const rows: [number, (i: number) => number][] = [
            [BARN_RACK.lower, (i) => (i % 3 - 1) * 0.04],
            [BARN_RACK.upper, (i) => (i % 2) * 0.05 - 0.02],
          ];
          rows.forEach(([shelf, yaw], r) => BARN_RACK.cans.forEach((x, i) => {
            const k = r * BARN_RACK.cans.length + i;
            const ry = yaw(i);
            const rr = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
            const nn = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
            const c = new THREE.Vector3(x, F + shelf + CAN_H * 0.6, BARN_RACK.z).addScaledVector(nn, CAN_D / 2 + 0.002);
            inner.add(c, rr, up, CAN_W * 0.42, CAN_H * 0.3, canNumber(labels[k], k < 4, 400 + k), 700, 0.002);
          }));
          break;
        }
      }
    }
    for (const m of [inner.build(), outer.build()]) if (m) out.push({ building: b.id, mesh: m });
  }
  return out;
}
