import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RNG } from '../../core/Random';
import { Noise } from '../../materials/texgen/noise';
import { MeshBuilder } from '../architecture/MeshBuilder';
import type { TerrainData } from '../TerrainData';
import { BUILDINGS, CEMETERY, COURTYARD, WORLD_HALF, rectDist, Rect } from '../Layout';
import type { TextureStore } from '../../materials/TextureStore';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import type { Physics } from '../../physics/Physics';
import { foliageMaterial, barkMaterial } from './VegMaterials';
import { LAYER_VEGETATION } from '../../render/PostFX';
import { CARETAKER_GROUNDS_BLOCKERS } from '../buildings/Caretaker';
import type { VegTextureSet } from './VegTextures';

const CELL = 16;
const NC = (WORLD_HALF * 2) / CELL;

type Kind = 'fern' | 'grass' | 'bramble' | 'log' | 'rock' | 'stump' | 'branch';
interface Inst { kind: Kind; v: number; x: number; y: number; z: number; ry: number; s: number; tilt: THREE.Quaternion }
interface Cell { trees: Inst[]; colliders: RAPIER.Collider[] | null }
interface Variant { kind: Kind; meshes: THREE.InstancedMesh[]; attr: THREE.InstancedBufferAttribute; count: number; cap: number; range: number; size: number }

/** Arching fern frond cards around a centre. */
function genFern(seed: number): MeshBuilder {
  const mb = new MeshBuilder(); mb.emitAux = true;
  const rng = new RNG(seed);
  const n = rng.int(6, 10);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = rng.range(0.55, 1.05);
    const lift = rng.range(0.35, 0.7);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const segs = 4;
    const tone = rng.range(0.75, 1.1);
    mb.color = [tone, tone * rng.range(0.9, 1.05), tone];
    let prev: THREE.Vector3 | null = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const p = dir.clone().multiplyScalar(len * t).setY(lift * Math.sin(t * Math.PI * 0.85) * len);
      if (prev) {
        const w0 = 0.32 * Math.sin(Math.PI * Math.max(0.15, (t - 1 / segs))) * len, w1 = 0.32 * Math.sin(Math.PI * Math.max(0.15, t)) * len;
        mb.aux = t;
        const u0 = (s - 1) / segs, u1 = t;
        mb.quad('card', [prev.x - side.x * w0, prev.y, prev.z - side.z * w0], [prev.x + side.x * w0, prev.y, prev.z + side.z * w0],
          [p.x + side.x * w1, p.y, p.z + side.z * w1], [p.x - side.x * w1, p.y, p.z - side.z * w1], [0, 1, 0], [[0, u0], [1, u0], [1, u1], [0, u1]]);
      }
      prev = p;
    }
  }
  mb.color = [1, 1, 1];
  return mb;
}

/** Crossed upright cards (grass tufts, bramble mounds). */
function genTuft(seed: number, w: number, h: number, n: number): MeshBuilder {
  const mb = new MeshBuilder(); mb.emitAux = true;
  const rng = new RNG(seed);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + rng.range(-0.2, 0.2);
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const lean = rng.range(-0.1, 0.1);
    const tone = rng.range(0.8, 1.1);
    mb.color = [tone, tone, tone];
    mb.aux = 0;
    const b0 = [-dx, 0, -dz], b1 = [dx, 0, dz];
    mb.aux = 1;
    const t1 = [dx + lean, h, dz], t0 = [-dx + lean, h, -dz];
    mb.aux = 0.5;
    mb.quad('card', b0, b1, t1, t0, [-Math.sin(a) * 0.3, 0.9, Math.cos(a) * 0.3], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  mb.color = [1, 1, 1];
  return mb;
}

function genLog(seed: number): MeshBuilder {
  const mb = new MeshBuilder(); mb.emitAux = true;
  const rng = new RNG(seed);
  const len = rng.range(3, 7.5);
  const r = rng.range(0.14, 0.32);
  const pts: THREE.Vector3[] = [], radii: number[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(-len / 2 + len * t, r * 0.85 + Math.sin(t * 3 + seed) * 0.05, Math.sin(t * 2.3 + seed) * 0.12));
    radii.push(r * (1 - t * 0.35) * (i === 0 || i === n ? 0.92 : 1));
  }
  mb.tube('bark', pts, radii, 9, undefined, false);
  // end caps (sawn or broken)
  for (const [i, sgn] of [[0, -1], [n, 1]] as const) {
    mb.withColor([1, 1, 1], () => mb.cylinder('wood_end', pts[i].x, 0, pts[i].z, radii[i], radii[i], 0.01, 9, 'none'));
    void sgn;
  }
  // a couple of broken branch stubs
  for (let k = 0; k < 4; k++) {
    const t = rng.range(0.2, 0.9);
    const i = Math.floor(t * n);
    const a = rng.float() * Math.PI * 2;
    const b = pts[i].clone();
    mb.rod('bark', b, b.clone().add(new THREE.Vector3(rng.range(-0.2, 0.2), Math.sin(a) * 0.5 + 0.2, Math.cos(a) * 0.5)), radii[i] * 0.25, 0.01, 4, 'none');
  }
  return mb;
}

function genRock(seed: number): MeshBuilder {
  const mb = new MeshBuilder();
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position');
  const nz = new Noise(seed);
  const rng = new RNG(seed);
  const sx = rng.range(0.8, 1.6), sy = rng.range(0.45, 0.8), sz = rng.range(0.8, 1.4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = 1 + nz.perlin(x * 1.3 + 5, y * 1.3 + z * 0.7, 4096, 4096) * 0.28 + nz.perlin(x * 3.1, z * 3.1 + y, 4096, 4096) * 0.08;
    // flatten the bottom so rocks sit in the ground
    pos.setXYZ(i, x * d * sx, Math.max(y * d * sy, -0.2), z * d * sz);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) + pos.getZ(i) * 0.5; uv[i * 2 + 1] = pos.getY(i) + pos.getZ(i) * 0.3; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  mb.geometry('rock', g);
  return mb;
}

function genStump(seed: number): MeshBuilder {
  const mb = new MeshBuilder(); mb.emitAux = true;
  const rng = new RNG(seed);
  const r = rng.range(0.22, 0.4), h = rng.range(0.25, 0.6);
  mb.cylinder('bark', 0, -0.1, 0, r * 1.35, r, h + 0.1, 10, 'none');
  mb.cylinder('wood_end', 0, h, 0, r, r * 0.98, 0.01, 10, 'top');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
    mb.rod('bark', new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * (r + 0.5), -0.15, Math.sin(a) * (r + 0.5)), r * 0.35, 0.03, 5, 'none');
  }
  return mb;
}

function genBranch(seed: number): MeshBuilder {
  const mb = new MeshBuilder(); mb.emitAux = true;
  const rng = new RNG(seed);
  const len = rng.range(1, 2.6);
  const pts = [new THREE.Vector3(-len / 2, 0.04, 0), new THREE.Vector3(0, 0.06, rng.range(-0.15, 0.15)), new THREE.Vector3(len / 2, 0.03, rng.range(-0.2, 0.2))];
  mb.tube('bark', pts, [0.04, 0.03, 0.012], 5);
  for (let k = 0; k < 3; k++) {
    const b = pts[1].clone().lerp(pts[2], rng.float());
    mb.rod('bark', b, b.clone().add(new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(0, 0.2), rng.range(-0.5, 0.5))), 0.015, 0.004, 3, 'none');
  }
  return mb;
}

/**
 * Forest-floor dressing: bracken, grass tufts, brambles, fallen trunks, granite
 * boulders, stumps and dead branches. Small things are instanced within a short
 * radius; logs and rocks further out. Colliders for logs/rocks near the player.
 */
export class GroundCover {
  readonly group = new THREE.Group();
  private cells: Cell[] = [];
  private variants: Variant[] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private dummy = new THREE.Object3D();

  constructor(private terrain: TerrainData, textures: TextureStore, materials: MaterialLibrary, veg: VegTextureSet, private physics: Physics, private density = 1) {
    this.group.name = 'groundcover';
    this.buildVariants(textures, materials, veg);
    this.scatter();
  }

  private buildVariants(T: TextureStore, M: MaterialLibrary, V: VegTextureSet): void {
    const fernMat = foliageMaterial({ map: V.fern, treeHeight: 1, trunkSway: 0.05, flutter: 0.06, alphaTest: 0.4, tint: '#b8a898' });
    const grassMat = foliageMaterial({ map: V.grass, treeHeight: 1, trunkSway: 0.12, flutter: 0.05, alphaTest: 0.35 });
    const brambleMat = foliageMaterial({ map: V.bramble, treeHeight: 1, trunkSway: 0.04, flutter: 0.03, alphaTest: 0.4 });
    const logBark = barkMaterial(T, 'deadwood', 1, 2, 30, 0, 0.9);
    const spruceBark = barkMaterial(T, 'bark_spruce', 1, 2, 30, 0, 0.9);
    if (!M.has('wood_end')) M.define('wood_end', { tex: 'rough_timber', scale: 0.6, color: '#b09a80', exterior: true });
    const woodEnd = M.get('wood_end');
    const rockMat = M.get('rock');
    const add = (kind: Kind, mb: MeshBuilder, mats: Record<string, THREE.Material>, cap: number, range: number, shadow: boolean, size: number) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
      attr.setUsage(THREE.DynamicDrawUsage);
      const meshes: THREE.InstancedMesh[] = [];
      for (const [slot, g] of mb.geometries()) {
        const mat = mats[slot];
        if (!mat) continue;
        const m = new THREE.InstancedMesh(g, mat, cap);
        m.instanceMatrix = attr;
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = shadow;
        m.receiveShadow = true;
        m.name = `gc_${kind}_${slot}`;
        m.layers.set(LAYER_VEGETATION);
        this.group.add(m);
        meshes.push(m);
      }
      this.variants.push({ kind, meshes, attr, count: 0, cap, range, size });
    };
    const R = 1;
    for (let i = 0; i < 3; i++) add('fern', genFern(10 + i), { card: fernMat }, 3500 * R, 30, false, 1);
    for (let i = 0; i < 2; i++) add('grass', genTuft(20 + i, 0.9, 0.55, 3), { card: grassMat }, 6000 * R, 32, false, 1);
    add('bramble', genTuft(30, 1.6, 0.9, 4), { card: brambleMat }, 1500, 34, false, 1);
    for (let i = 0; i < 3; i++) add('log', genLog(40 + i), { bark: i === 1 ? spruceBark : logBark, wood_end: woodEnd }, 600, 90, true, 1);
    for (let i = 0; i < 3; i++) add('rock', genRock(50 + i), { rock: rockMat }, 700, 110, true, 1);
    add('stump', genStump(60), { bark: spruceBark, wood_end: woodEnd }, 600, 70, true, 1);
    for (let i = 0; i < 2; i++) add('branch', genBranch(70 + i), { bark: logBark }, 2500, 30, false, 1);
  }

  private variantIndex(kind: Kind, rng: RNG): number {
    const idx = this.variants.map((v, i) => [v, i] as const).filter(([v]) => v.kind === kind).map(([, i]) => i);
    return idx[Math.floor(rng.float() * idx.length)];
  }

  private scatter(): void {
    const noise = new Noise(9191);
    const P = 4096;
    const block: { r: Rect; m: number }[] = [...Object.values(BUILDINGS).map((r) => ({ r, m: 1.5 })), { r: COURTYARD, m: 0 }, { r: CEMETERY, m: 0.5 },
      ...CARETAKER_GROUNDS_BLOCKERS.map((r) => ({ r, m: 0.4 }))];
    const up = new THREE.Vector3(0, 1, 0);
    const n = { x: 0, y: 0, z: 0 };
    for (let cz = 0; cz < NC; cz++) for (let cx = 0; cx < NC; cx++) {
      const cell: Cell = { trees: [], colliders: null };
      const x0 = -WORLD_HALF + cx * CELL, z0 = -WORLD_HALF + cz * CELL;
      const rng = new RNG(cx * 92821 + cz * 68917 + 5);
      const tries = Math.round(70 * this.density);
      for (let k = 0; k < tries; k++) {
        const x = x0 + rng.float() * CELL, z = z0 + rng.float() * CELL;
        if (Math.abs(x) > WORLD_HALF - 3 || Math.abs(z) > WORLD_HALF - 3) continue;
        let blocked = false;
        for (const b of block) if (rectDist(b.r, x, z) < b.m) { blocked = true; break; }
        if (blocked) continue;
        const pd = this.terrain.pathDistAt(x, z);
        const open = this.terrain.openAt(x, z);
        const fernPatch = noise.perlin(x * 0.06 + 3, z * 0.06 + 1, P, P);
        const r = rng.float();
        let kind: Kind | null = null;
        if (pd < 1.6) { if (r < 0.04) kind = 'branch'; }
        else if (open > 0.55) {
          // meadows: dense dry grass, brambles at the edges
          kind = r < 0.75 ? 'grass' : r < 0.82 && open < 0.85 ? 'bramble' : r < 0.84 ? 'rock' : null;
        } else {
          if (fernPatch > 0.05 && r < 0.55) kind = 'fern';
          else if (r < 0.6) kind = 'grass';
          else if (r < 0.66) kind = 'branch';
          else if (r < 0.68) kind = 'bramble';
          else if (r < 0.695) kind = 'log';
          else if (r < 0.71) kind = 'rock';
          else if (r < 0.722) kind = 'stump';
        }
        if (!kind) continue;
        if (kind === 'grass' && open < 0.3 && rng.float() < 0.7) continue; // little grass under closed canopy
        const v = this.variantIndex(kind, rng);
        const y = this.terrain.heightAt(x, z);
        this.terrain.normalAt(x, z, n);
        const align = kind === 'log' || kind === 'branch' || kind === 'rock' ? 1 : 0.4;
        const tilt = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(n.x, n.y, n.z).lerp(up, 1 - align).normalize());
        const s = kind === 'rock' ? rng.range(0.4, 1.6) : kind === 'fern' ? rng.range(0.7, 1.3) : rng.range(0.8, 1.2);
        cell.trees.push({ kind, v, x, y: y - (kind === 'rock' ? 0.15 * s : kind === 'log' ? 0.12 : 0.02), z, ry: rng.float() * Math.PI * 2, s, tilt });
      }
      this.cells.push(cell);
    }
  }

  update(p: THREE.Vector3): void {
    if (p.distanceToSquared(this.lastPos) < 3 * 3) return;
    this.lastPos.copy(p);
    for (const v of this.variants) v.count = 0;
    const d = this.dummy;
    const yq = new THREE.Quaternion();
    const maxR = 110;
    const c0x = Math.max(0, Math.floor((p.x - maxR + WORLD_HALF) / CELL)), c1x = Math.min(NC - 1, Math.floor((p.x + maxR + WORLD_HALF) / CELL));
    const c0z = Math.max(0, Math.floor((p.z - maxR + WORLD_HALF) / CELL)), c1z = Math.min(NC - 1, Math.floor((p.z + maxR + WORLD_HALF) / CELL));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const cell = this.cells[cz * NC + cx];
      for (const t of cell.trees) {
        const V = this.variants[t.v];
        const dd = Math.hypot(t.x - p.x, t.z - p.z);
        if (dd > V.range || V.count >= V.cap) continue;
        d.position.set(t.x, t.y, t.z);
        yq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
        d.quaternion.copy(t.tilt).multiply(yq);
        d.scale.setScalar(t.s);
        d.updateMatrix();
        d.matrix.toArray(V.attr.array as Float32Array, V.count * 16);
        V.count++;
      }
    }
    for (const V of this.variants) {
      for (const m of V.meshes) { m.count = V.count; m.visible = V.count > 0; }
      V.attr.needsUpdate = true;
      V.attr.clearUpdateRanges();
      V.attr.addUpdateRange(0, V.count * 16);
    }
    this.updateColliders(p);
  }

  private updateColliders(p: THREE.Vector3): void {
    for (let cz = 0; cz < NC; cz++) for (let cx = 0; cx < NC; cx++) {
      const cell = this.cells[cz * NC + cx];
      if (!cell.trees.length) continue;
      const wx = -WORLD_HALF + (cx + 0.5) * CELL, wz = -WORLD_HALF + (cz + 0.5) * CELL;
      const dist = Math.hypot(wx - p.x, wz - p.z);
      if (dist < 40 && !cell.colliders) {
        cell.colliders = [];
        for (const t of cell.trees) {
          if (t.kind === 'rock' && t.s > 0.7) cell.colliders.push(this.physics.addBox({ cx: t.x, cy: t.y + 0.3 * t.s, cz: t.z, hx: 0.9 * t.s, hy: 0.45 * t.s, hz: 0.8 * t.s, ry: t.ry, surface: 'stone' }));
          else if (t.kind === 'log') cell.colliders.push(this.physics.addBox({ cx: t.x, cy: t.y + 0.22, cz: t.z, hx: 2.4 * t.s, hy: 0.22, hz: 0.25, ry: t.ry, surface: 'wood' }));
          else if (t.kind === 'stump') cell.colliders.push(this.physics.addCylinder(t.x, t.y + 0.3, t.z, 0.35 * t.s, 0.3, 'wood'));
        }
      } else if (dist > 60 && cell.colliders) {
        for (const c of cell.colliders) this.physics.removeCollider(c);
        cell.colliders = null;
      }
    }
  }

  prepareWarmup(on: boolean): void {
    for (const v of this.variants) for (const m of v.meshes) { m.count = on ? 1 : v.count; m.visible = on || v.count > 0; }
    if (!on) this.lastPos.set(1e9, 0, 0);
  }
}
