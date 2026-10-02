import * as THREE from 'three/webgpu';
import { MeshBuilder } from '../architecture/MeshBuilder';
import { RNG } from '../../core/Random';

/**
 * Procedural tree models. Each model is authored at the origin (trunk base at y=0) and
 * produces geometry per "slot":
 *   bark   – trunk and woody branches (tubes)
 *   cardA  – primary foliage/twig cards
 *   cardB  – secondary cards (dead twigs, marcescent leaves)
 *   board  – far billboard (crossed quads with a painted silhouette)
 * The aux attribute carries per-vertex bend weight for wind.
 */
export type Slot = 'bark' | 'cardA' | 'cardB' | 'board';
export interface TreeLOD { geoms: Partial<Record<Slot, THREE.BufferGeometry>> }
export interface TreeModel { species: Species; height: number; radius: number; crown: number; lods: TreeLOD[] }
export type Species = 'spruce' | 'beech' | 'birch' | 'snag' | 'sapling' | 'oak';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Slightly curved, drooping card from `o` along `dir` (unit), `side` (unit, across). */
function card(mb: MeshBuilder, mat: Slot, o: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, len: number, wid: number, droop: number, segs = 3, auxBase = 0.2, uv0 = 0, uv1 = 1): void {
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  if (up.y < 0) up.negate();
  const rows: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = o.clone().addScaledVector(dir, len * t);
    p.y -= droop * len * t * t;
    rows.push(p);
  }
  for (let i = 0; i < segs; i++) {
    const a = rows[i], b = rows[i + 1];
    const t0 = i / segs, t1 = (i + 1) / segs;
    const w0 = wid * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t0 * 0.9 + 0.1))), w1 = wid * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t1 * 0.9 + 0.1)));
    const nrm = up.clone().multiplyScalar(0.7).add(dir.clone().multiplyScalar(0.3)).normalize();
    mb.aux = auxBase + (1 - auxBase) * t0;
    const p0 = a.clone().addScaledVector(side, -w0 / 2), p1 = a.clone().addScaledVector(side, w0 / 2);
    mb.aux = auxBase + (1 - auxBase) * t1;
    const p2 = b.clone().addScaledVector(side, w1 / 2), p3 = b.clone().addScaledVector(side, -w1 / 2);
    // aux: written at vertex creation, so build two triangles via quad with per-corner aux by splitting
    const u0 = uv0 + (uv1 - uv0) * t0, u1 = uv0 + (uv1 - uv0) * t1;
    mb.aux = auxBase + (1 - auxBase) * (t0 + t1) / 2;
    mb.quad(mat, [p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z], [p3.x, p3.y, p3.z], [nrm.x, nrm.y, nrm.z], [[u0, 0], [u0, 1], [u1, 1], [u1, 0]]);
  }
  mb.aux = 0;
}

/** Crossed vertical quads for far LOD. */
function billboard(mb: MeshBuilder, h: number, w: number, n = 3, yOff = 0): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const nrm = [-Math.sin(a), 0.4, Math.cos(a)];
    mb.aux = 0.3;
    mb.quad('board', [-dx, yOff, -dz], [dx, yOff, dz], [dx, yOff + h, dz], [-dx, yOff + h, -dz], nrm, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  mb.aux = 0;
}

function trunkPath(rng: RNG, h: number, segs: number, lean: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const la = rng.float() * Math.PI * 2;
  let x = 0, z = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    x += Math.cos(la) * lean * h / segs + (rng.float() - 0.5) * 0.04 * h / segs;
    z += Math.sin(la) * lean * h / segs + (rng.float() - 0.5) * 0.04 * h / segs;
    pts.push(V(i === 0 ? 0 : x, t * h, i === 0 ? 0 : z));
  }
  return pts;
}

function finish(mb: MeshBuilder): TreeLOD {
  const geoms: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  for (const [k, g] of mb.geometries()) geoms[k as Slot] = g;
  return { geoms };
}

// --------------------------------------------------------------------------- spruce
export function genSpruce(seed: number, height: number, dense = true): TreeModel {
  const lods: TreeLOD[] = [];
  const r0 = 0.012 * height + rngOf(seed).range(0.02, 0.08);
  const crownBase = height * (dense ? rngOf(seed + 1).range(0.35, 0.55) : 0.12);
  const crownR = height * (dense ? 0.11 : 0.16) + 0.6;
  for (let lod = 0; lod < 3; lod++) {
    const rng = new RNG(seed);
    const mb = new MeshBuilder();
    mb.emitAux = true;
    const tp = trunkPath(rng, height, lod === 0 ? 10 : 5, rng.range(0, 0.012));
    const radii = tp.map((p) => {
      const t = p.y / height;
      return Math.max(0.015, r0 * Math.pow(1 - t, 0.85)) + r0 * 0.55 * Math.exp(-p.y / 0.35);
    });
    if (lod < 2) mb.tube('bark', tp, radii, lod === 0 ? 10 : 6, tp.map((p) => (p.y / height) * 0.15));
    const trunkAt = (y: number) => {
      const t = Math.min(1, Math.max(0, y / height)) * (tp.length - 1);
      const i = Math.min(tp.length - 2, Math.floor(t));
      return tp[i].clone().lerp(tp[i + 1], t - i);
    };
    if (lod === 2) {
      // far: trunk stub + crossed silhouette boards
      mb.tube('bark', [tp[0], tp[tp.length - 1]], [radii[0], 0.02], 4);
      mb.withColor([1, 1, 1], () => {
        mb.pushTRS(0, crownBase * 0.85, 0, rng.float() * Math.PI);
        billboard(mb, height - crownBase * 0.85 + 0.3, crownR * 2.25, 3);
        mb.pop();
      });
      lods.push(finish(mb));
      continue;
    }
    let y = 1.6 + rng.float() * 0.6;
    let whorl = 0;
    while (y < height - 0.4) {
      const rel = (y - crownBase) / (height - crownBase);
      const alive = y >= crownBase;
      const step = alive ? 0.32 + rng.float() * 0.22 + (1 - rel) * 0.12 : 0.45 + rng.float() * 0.4;
      const nb = lod === 0 ? (alive ? 5 : 4) : (alive ? 3 : 2);
      const az0 = rng.float() * Math.PI * 2;
      const base = trunkAt(y);
      for (let k = 0; k < nb; k++) {
        if (!alive && rng.float() < (lod === 0 ? 0.45 : 0.65)) continue;
        const az = az0 + (k / nb) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const horiz = V(Math.cos(az), 0, Math.sin(az));
        if (alive) {
          const len = (crownR * Math.pow(Math.max(0, 1 - rel), 0.85) * rng.range(0.8, 1.15) + 0.35) * (lod === 1 ? 1.1 : 1);
          const pitch = -0.25 - rng.float() * 0.25 + rel * 0.35;
          const dir = horiz.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch)).normalize();
          const side = V(-horiz.z, 0, horiz.x);
          const tone = 0.85 + rng.float() * 0.3;
          mb.withColor([tone, tone, tone], () => {
            card(mb, 'cardA', base, dir, side, len, len * (lod === 0 ? 0.62 : 0.8), 0.18, lod === 0 ? 3 : 2, 0.15);
            if (lod === 0) {
              // second, tilted card for volume
              const side2 = side.clone().applyAxisAngle(dir, 1.05).normalize();
              card(mb, 'cardA', base.clone().add(V(0, 0.04, 0)), dir, side2, len * 0.92, len * 0.45, 0.22, 3, 0.15);
            }
          });
          if (lod === 0 && len > 1.1) {
            const end = base.clone().addScaledVector(dir, len * 0.75);
            end.y -= 0.18 * len * 0.4;
            mb.aux = 0.3; mb.rod('bark', base, end, 0.025, 0.008, 3, 'none'); mb.aux = 0;
          }
        } else {
          // dead lower branches: grey twig sprays, short stubs
          const len = rng.range(0.35, 1.4) * (1 - (y / crownBase) * 0.4);
          const pitch = rng.range(-0.15, 0.25);
          const dir = horiz.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch)).normalize();
          const side = V(-horiz.z, 0, horiz.x).applyAxisAngle(dir, rng.range(-0.6, 0.6));
          mb.withColor([0.9, 0.9, 0.9], () => card(mb, 'cardB', base, dir, side, len, len * 0.55, 0.04, 2, 0.05));
          if (lod === 0) { mb.rod('bark', base, base.clone().addScaledVector(dir, len * 0.5), 0.02, 0.006, 3, 'none'); }
        }
      }
      y += step;
      whorl++;
    }
    // leader
    const top = trunkAt(height);
    mb.withColor([1, 1, 1], () => {
      for (let k = 0; k < 2; k++) {
        const side = V(Math.cos(k * Math.PI / 2), 0, Math.sin(k * Math.PI / 2));
        card(mb, 'cardA', top.clone().add(V(0, -0.9, 0)), V(0, 1, 0), side, 1.2, 0.5, 0, 2, 0.5);
      }
    });
    void whorl;
    lods.push(finish(mb));
  }
  return { species: 'spruce', height, radius: r0, crown: crownR, lods };
}

const rngOf = (s: number) => new RNG(s);

// --------------------------------------------------------------------------- deciduous
interface DecidOpts {
  species: 'beech' | 'birch' | 'oak' | 'sapling';
  height: number;
  clearBole: number;   // fraction of height without branches
  limbs: [number, number];
  spread: number;      // crown width factor
  droop: number;       // twig droop (birch)
  leafFrac: number;    // fraction of twig sprays carrying leaves
  r0: number;
}

function genDeciduous(seed: number, o: DecidOpts): TreeModel {
  const lods: TreeLOD[] = [];
  const H = o.height;
  for (let lod = 0; lod < 3; lod++) {
    const rng = new RNG(seed);
    const mb = new MeshBuilder();
    mb.emitAux = true;
    const sidesFor = (level: number) => (lod === 0 ? [10, 7, 5, 3][level] ?? 3 : [6, 4, 3, 3][level] ?? 3);
    const boleTop = H * o.clearBole;
    const tp = trunkPath(rng, boleTop, lod === 0 ? 6 : 3, rng.range(0, 0.03));
    const trunkR = tp.map((p) => o.r0 * (1 - 0.25 * p.y / boleTop) + o.r0 * 0.5 * Math.exp(-p.y / 0.3));
    if (lod === 2) {
      mb.tube('bark', tp, trunkR, 4);
      mb.pushTRS(0, boleTop * 0.7, 0, rng.float() * Math.PI);
      billboard(mb, H - boleTop * 0.7, H * o.spread * 0.9, 3);
      mb.pop();
      lods.push(finish(mb));
      continue;
    }
    mb.tube('bark', tp, trunkR, sidesFor(0), tp.map(() => 0));
    const sprays: { p: THREE.Vector3; d: THREE.Vector3; len: number }[] = [];
    const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, level: number, auxStart: number) => {
      const segs = level <= 1 ? (lod === 0 ? 6 : 4) : 3;
      const pts = [start.clone()];
      const radii = [r];
      const aux = [auxStart];
      let d = dir.clone();
      let p = start.clone();
      for (let i = 1; i <= segs; i++) {
        // phototropism (up), gravity droop for long thin branches, random wander
        const t = i / segs;
        d.add(V(rng.range(-0.25, 0.25), 0.12 - o.droop * t * (level + 1) * 0.2, rng.range(-0.25, 0.25))).normalize();
        p = p.clone().addScaledVector(d, len / segs);
        pts.push(p);
        radii.push(Math.max(0.006, r * (1 - t * 0.75)));
        aux.push(Math.min(1, auxStart + t * 0.3));
      }
      const maxLevel = lod === 0 ? 3 : 2;
      if (level < maxLevel) mb.tube('bark', pts, radii, sidesFor(level), aux);
      // children
      if (level < maxLevel) {
        const nChild = level === 0 ? rng.int(3, 5) : rng.int(2, 4);
        for (let c = 0; c < nChild; c++) {
          const at = rng.range(0.35, 0.95);
          const k = Math.min(pts.length - 1, Math.floor(at * (pts.length - 1)));
          const cp = pts[k];
          const cd = d.clone().add(V(rng.range(-1, 1), rng.range(-0.1, 0.6), rng.range(-1, 1)).multiplyScalar(0.9)).normalize();
          branch(cp, cd, len * rng.range(0.45, 0.7), radii[k] * 0.6, level + 1, aux[k]);
        }
        if (level === maxLevel - 1) sprays.push({ p: pts[pts.length - 1], d, len: len * 0.9 });
      } else {
        sprays.push({ p: start, d: dir, len: len * 1.3 });
      }
    };
    // major limbs from the top of the bole
    const top = tp[tp.length - 1];
    const nl = rng.int(o.limbs[0], o.limbs[1]);
    const az0 = rng.float() * Math.PI * 2;
    for (let i = 0; i < nl; i++) {
      const az = az0 + (i / nl) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const up = rng.range(0.55, 0.85);
      const dir = V(Math.cos(az) * (1 - up) * o.spread, up, Math.sin(az) * (1 - up) * o.spread).normalize();
      branch(top, dir, (H - boleTop) * rng.range(0.55, 0.75), trunkR[trunkR.length - 1] * 0.7, 0, 0.05);
    }
    // a few lower side branches (epicormic / lower crown)
    for (let i = 0; i < (o.species === 'sapling' ? 6 : 3); i++) {
      const y = boleTop * rng.range(0.55, 0.95);
      const az = rng.float() * Math.PI * 2;
      const base = V(top.x * y / boleTop, y, top.z * y / boleTop);
      branch(base, V(Math.cos(az), rng.range(0.1, 0.5), Math.sin(az)).normalize(), H * rng.range(0.12, 0.25), o.r0 * 0.18, 1, 0.1);
    }
    // twig sprays (cards)
    for (const s of sprays) {
      const nCards = lod === 0 ? 2 : 1;
      for (let c = 0; c < nCards; c++) {
        const leaves = rng.chance(o.leafFrac);
        const side = new THREE.Vector3().crossVectors(s.d, V(0, 1, 0)).normalize();
        if (side.lengthSq() < 0.01) side.set(1, 0, 0);
        side.applyAxisAngle(s.d, rng.range(-1.2, 1.2) + c * 1.4);
        const L = s.len * (lod === 0 ? 1 : 1.4) * rng.range(0.8, 1.2);
        const tone = rng.range(0.8, 1.1);
        mb.withColor([tone, tone, tone], () => card(mb, leaves ? 'cardB' : 'cardA', s.p, s.d, side, L, L * 0.9, o.droop * 0.6, 2, 0.4));
      }
    }
    lods.push(finish(mb));
  }
  return { species: o.species, height: H, radius: o.r0, crown: H * o.spread * 0.45, lods };
}

export function genBeech(seed: number, height: number): TreeModel {
  const r = rngOf(seed);
  return genDeciduous(seed, { species: 'beech', height, clearBole: r.range(0.42, 0.55), limbs: [2, 4], spread: 0.55, droop: 0.05, leafFrac: 0.12, r0: 0.011 * height + 0.05 });
}

export function genBirch(seed: number, height: number): TreeModel {
  return genDeciduous(seed, { species: 'birch', height, clearBole: 0.38, limbs: [3, 5], spread: 0.4, droop: 0.35, leafFrac: 0.0, r0: 0.008 * height + 0.04 });
}

export function genOak(seed: number, height: number): TreeModel {
  return genDeciduous(seed, { species: 'oak', height, clearBole: 0.28, limbs: [4, 6], spread: 1.1, droop: 0.02, leafFrac: 0.15, r0: 0.03 * height + 0.15 });
}

export function genSapling(seed: number, height: number): TreeModel {
  // young beech keeping its dry brown leaves through winter (marcescence)
  return genDeciduous(seed, { species: 'sapling', height, clearBole: 0.2, limbs: [2, 3], spread: 0.7, droop: 0.05, leafFrac: 0.85, r0: 0.012 * height + 0.01 });
}

// --------------------------------------------------------------------------- snag
export function genSnag(seed: number, height: number): TreeModel {
  const lods: TreeLOD[] = [];
  for (let lod = 0; lod < 3; lod++) {
    const rng = new RNG(seed);
    const mb = new MeshBuilder();
    mb.emitAux = true;
    const r0 = 0.012 * height * 1.6 + 0.08;
    const tp = trunkPath(rng, height, lod === 0 ? 8 : 4, rng.range(0.005, 0.04));
    const radii = tp.map((p, i) => Math.max(0.03, r0 * (1 - p.y / height * 0.55)) * (i === tp.length - 1 ? 0.6 : 1) + r0 * 0.4 * Math.exp(-p.y / 0.3));
    mb.tube('bark', tp, radii, lod === 0 ? 9 : lod === 1 ? 6 : 4, undefined, true);
    if (lod < 2) {
      // jagged break at the top
      const top = tp[tp.length - 1];
      for (let k = 0; k < 4; k++) {
        const a = rng.float() * Math.PI * 2;
        mb.rod('bark', top.clone().add(V(Math.cos(a) * radii[radii.length - 1] * 0.5, -0.2, Math.sin(a) * radii[radii.length - 1] * 0.5)), top.clone().add(V(Math.cos(a) * 0.05, rng.range(0.2, 0.7), Math.sin(a) * 0.05)), radii[radii.length - 1] * 0.25, 0.005, 3, 'none');
      }
      // broken branch stubs
      const n = lod === 0 ? 14 : 6;
      for (let i = 0; i < n; i++) {
        const y = rng.range(2, height * 0.95);
        const t = (y / height) * (tp.length - 1);
        const ii = Math.min(tp.length - 2, Math.floor(t));
        const base = tp[ii].clone().lerp(tp[ii + 1], t - ii);
        const a = rng.float() * Math.PI * 2;
        const d = V(Math.cos(a), rng.range(-0.3, 0.2), Math.sin(a)).normalize();
        mb.rod('bark', base, base.clone().addScaledVector(d, rng.range(0.2, 1.4)), 0.035, 0.008, 4, 'none');
      }
    }
    lods.push(finish(mb));
  }
  return { species: 'snag', height, radius: 0.15, crown: 1, lods };
}

/** Far-LOD silhouette textures (spruce cone / bare deciduous crown). */
export function drawSilhouettes(): { spruce: THREE.Texture; bare: THREE.Texture } {
  const mk = (draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    return t;
  };
  const rng = new RNG('sil');
  const spruce = mk((g, w, h) => {
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const y = h - t * h;
      const half = (1 - t) * w * 0.48 * (0.8 + rng.float() * 0.3);
      const sh = 0.55 + rng.float() * 0.5;
      g.fillStyle = `rgb(${30 * sh},${44 * sh},${30 * sh})`;
      g.beginPath();
      g.moveTo(w / 2, y - h * 0.05);
      g.lineTo(w / 2 - half, y + h * 0.03 + rng.float() * h * 0.02);
      g.lineTo(w / 2 + half, y + h * 0.03 + rng.float() * h * 0.02);
      g.closePath(); g.fill();
    }
  }, 256, 512);
  const bare = mk((g, w, h) => {
    g.lineCap = 'round';
    const grow = (x: number, y: number, a: number, len: number, wd: number, d: number) => {
      if (d > 7) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.strokeStyle = `rgba(${44 + d * 4},${40 + d * 4},${38 + d * 3},1)`;
      g.lineWidth = wd;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      const n = d < 2 ? 3 : 2;
      for (let k = 0; k < n; k++) grow(x2, y2, a + (rng.float() - 0.5) * 1.1, len * 0.72, Math.max(0.6, wd * 0.62), d + 1);
    };
    grow(w / 2, h, -Math.PI / 2, h * 0.28, 10, 0);
  }, 512, 512);
  return { spruce, bare };
}
