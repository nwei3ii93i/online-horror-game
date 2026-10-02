import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import { ENV_TEXT } from './environment_text';
import { MANOR } from '../buildings/Manor';
import { MeshBuilder } from '../architecture/MeshBuilder';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import type { Physics } from '../../physics/Physics';
import { worldUniforms } from '../../render/WorldUniforms';
import { RNG } from '../../core/Random';

/**
 * Story details drawn into the world: the height marks on the kitchen door frame, the
 * tally on the sealed-room wall (1296 marks) and the mattress Josef carried down.
 */
function decal(canvas: HTMLCanvasElement, w: number, h: number): THREE.Mesh {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mat = new THREE.MeshStandardNodeMaterial();
  const A = texture(t, uv());
  mat.colorNode = A;
  mat.opacityNode = A.a;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.roughnessNode = float(0.85);
  (mat as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  return m;
}

function heightMarksCanvas(): HTMLCanvasElement {
  // 0.3 m wide × 1.8 m tall strip; 1 px = 2.5 mm
  const c = document.createElement('canvas');
  c.width = 128; c.height = 720;
  const g = c.getContext('2d')!;
  const rng = new RNG(1987);
  const pxPerCm = c.height / 180;
  for (const m of ENV_TEXT.heightMarks.marks) {
    const y = c.height - m.heightCm * pxPerCm;
    const pencil = m.pen === 'carpenter_pencil';
    g.strokeStyle = pencil ? 'rgba(55,55,52,0.85)' : 'rgba(30,45,120,0.8)';
    g.lineWidth = pencil ? 2.2 : 1.3;
    g.beginPath();
    // Josef ruled straight lines; the parents' are freehand and slightly slanted
    const x0 = 2, x1 = pencil ? 46 : 34 + rng.float() * 10;
    g.moveTo(x0, y + (pencil ? 0 : rng.range(-1, 1)));
    g.lineTo(x1, y + (pencil ? 0 : rng.range(-1.5, 1.5)));
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.font = pencil ? '600 13px "Courier New", monospace' : 'italic 13px "Segoe Script", "Bradley Hand", cursive';
    g.save();
    g.translate(x1 + 4, y + 4);
    if (!pencil) g.rotate(rng.range(-0.08, 0.04));
    g.fillText(m.label, 0, 0);
    g.restore();
  }
  return c;
}

function tallyCanvas(count: number): HTMLCanvasElement {
  // 2.4 m × 1.1 m, pencil and later something harder (scratched)
  const c = document.createElement('canvas');
  c.width = 1536; c.height = 704;
  const g = c.getContext('2d')!;
  const rng = new RNG(1296);
  const gw = 26, gh = 30, cols = Math.floor((c.width - 40) / gw);
  let n = 0;
  for (let row = 0; n < count; row++) {
    for (let col = 0; col < cols && n < count; col++) {
      const x = 20 + col * gw + rng.range(-2, 2), y = 20 + row * (gh + 6) + rng.range(-2, 2);
      const age = n / count;
      g.strokeStyle = age < 0.35 ? 'rgba(70,68,62,0.75)' : age < 0.7 ? 'rgba(52,50,46,0.85)' : 'rgba(225,220,205,0.6)';
      g.lineWidth = age < 0.7 ? 1.6 : 2.2;
      const k = Math.min(5, count - n);
      for (let i = 0; i < Math.min(4, k); i++) {
        g.beginPath(); g.moveTo(x + i * 4.5, y + rng.range(0, 2)); g.lineTo(x + i * 4.5 + rng.range(-1, 1), y + gh - rng.range(0, 3)); g.stroke();
      }
      if (k === 5) { g.beginPath(); g.moveTo(x - 3, y + gh - 4); g.lineTo(x + 18, y + 5); g.stroke(); }
      n += k;
    }
  }
  return c;
}

export function buildStoryDressing(materials: MaterialLibrary, physics: Physics | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = 'story-dressing';
  const { B0, G0 } = MANOR;

  // kitchen jamb, on the kitchen face of the corridor wall next to the door
  const hm = decal(heightMarksCanvas(), 0.3, 1.8);
  hm.position.set(6.3 + 0.003, G0 + 0.9, -22.45);
  hm.rotation.y = Math.PI / 2;
  group.add(hm);

  // sealed room: the tally above the mattress (26 Nov 1987 → 14 Jun 1991)
  const tally = decal(tallyCanvas(1296), 2.4, 1.1);
  tally.position.set(-9.8, B0 + 1.15, -28.45 + 0.003);
  group.add(tally);

  // mattress, blanket, pillow
  const mb = new MeshBuilder();
  materials.define('mattress', { tex: 'fabric_white', scale: 0.5, color: '#b8ae98', vertexColors: true });
  materials.define('blanket', { tex: 'fabric_check', scale: 0.5, color: '#8a8478', vertexColors: true });
  mb.pushTRS(-9.6, B0, -27.0, 0.06);
  mb.box('mattress', 0, 0.075, 0, 1.92, 0.15, 0.86);
  mb.box('blanket', 0.25, 0.165, 0.02, 1.3, 0.04, 0.9);
  mb.box('blanket', 0.25, 0.09, 0.45, 1.3, 0.16, 0.02);
  mb.pushTRS(-0.72, 0.19, 0, 0.1);
  mb.box('mattress', 0, 0, 0, 0.4, 0.09, 0.6);
  mb.pop();
  mb.pop();
  // bricks of the walled-up opening lie on the BOILER side: it was pushed out from within
  const rng = new RNG(1991);
  for (let i = 0; i < 34; i++) {
    const t = rng.float();
    const x = -7.0 + Math.pow(t, 1.6) * 1.9 + rng.range(-0.1, 0.1), z = -25.7 + rng.range(-0.8, 0.8) * (0.4 + t);
    const y = B0 + 0.035 + (i < 8 && t < 0.3 ? 0.07 * (i % 2) : 0);
    mb.pushTRS(x, y, z, rng.range(0, Math.PI), 1, 1, 1, rng.range(-0.12, 0.12), rng.range(-0.1, 0.1));
    mb.box(i % 5 === 0 ? 'stone_wall_int' : 'brick_int', 0, 0, 0, i % 7 === 0 ? 0.12 : 0.25, 0.065, 0.12);
    mb.pop();
  }
  group.add(mb.build(materials, { name: 'mattress' }));
  physics?.addBox({ cx: -9.6, cy: B0 + 0.08, cz: -27.0, hx: 0.96, hy: 0.08, hz: 0.43, ry: 0.06, surface: 'fabric' });
  return group;
}
