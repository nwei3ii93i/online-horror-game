import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RNG, hash2 } from '../../core/Random';
import { Noise } from '../../materials/texgen/noise';
import type { TerrainData } from '../TerrainData';
import { BUILDINGS, CEMETERY, GARDEN, COURTYARD, WORLD_HALF, POI, rectDist, grow, Rect } from '../Layout';
import { CEMETERY_SPRUCES } from '../buildings/Sacred';
import { CARETAKER_GROUNDS_BLOCKERS } from '../buildings/Caretaker';
import type { TextureStore } from '../../materials/TextureStore';
import type { Physics } from '../../physics/Physics';
import { GROUP } from '../../physics/Physics';
import { LAYER_VEGETATION } from '../../render/PostFX';
import { TreeModel, Slot, genSpruce, genBeech, genBirch, genSnag, genSapling, genOak, drawSilhouettes } from './TreeGen';
import { barkMaterial, foliageMaterial } from './VegMaterials';
import type { VegTextureSet } from './VegTextures';

const CELL = 32;
const NC = (WORLD_HALF * 2) / CELL;

interface TreeInst { model: number; x: number; y: number; z: number; ry: number; s: number }
interface Cell { cx: number; cz: number; trees: TreeInst[]; box: THREE.Box3; lod: number; colliders: RAPIER.Collider[] | null; /** Instance matrices, built on first use. */ mats?: Float32Array }
interface ModelSlot { mesh: THREE.InstancedMesh }
interface ModelLOD { slots: ModelSlot[]; attr: THREE.InstancedBufferAttribute; count: number }

/** Footprints that must stay free of trees (buildings + margins, yards). */
function blockers(): { r: Rect; m: number }[] {
  const out: { r: Rect; m: number }[] = [];
  for (const b of Object.values(BUILDINGS)) out.push({ r: b, m: 4 });
  out.push({ r: CEMETERY, m: 1.5 }, { r: COURTYARD, m: 3 }, { r: GARDEN, m: -2 });
  for (const r of CARETAKER_GROUNDS_BLOCKERS) out.push({ r, m: 1.5 }); // gate walls, woodshed
  const hs = POI.huntingStand;
  out.push({ r: { x0: hs.x - 2.5, z0: hs.z - 2.5, x1: hs.x + 2.5, z1: hs.z + 2.5 }, m: 1.5 });
  return out;
}

/**
 * The forest: ~15–20k deterministic tree instances in 32 m cells. Each frame the
 * visible cells are binned into three LODs (full geometry, simplified, crossed
 * billboards) and written into shared instanced meshes. Trunk colliders exist only
 * around the player.
 */
const SCALE_IDX = [0, 1, 2, 4, 5, 6, 8, 9, 10];

export class Forest {
  readonly group = new THREE.Group();
  readonly models: TreeModel[] = [];
  private cells: Cell[] = [];
  private lods: ModelLOD[][] = []; // [model][lod]
  /**
   * Beyond LOD 0 every tree of a species is drawn with one representative model scaled to its
   * height (in the night fog the variants can't be told apart there): about half the draws.
   */
  private rep: number[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastQuat = new THREE.Quaternion();
  private dummy = new THREE.Object3D();
  private wide = new THREE.PerspectiveCamera();
  totalTrees = 0;

  constructor(private terrain: TerrainData, private textures: TextureStore, private veg: VegTextureSet, private physics: Physics, density = 1) {
    this.group.name = 'forest';
    this.createModels();
    this.scatter(density);
    this.createMeshes();
  }

  private createModels(): void {
    const M = this.models;
    M.push(genSpruce(101, 21), genSpruce(102, 25), genSpruce(103, 28.5), genSpruce(104, 31)); // 0-3
    M.push(genBeech(201, 18), genBeech(202, 22.5), genBeech(203, 26));                         // 4-6
    M.push(genBirch(301, 14), genBirch(302, 18));                                                // 7-8
    M.push(genSnag(401, 9.5), genSnag(402, 15));                                                 // 9-10
    M.push(genSapling(501, 2.4), genSapling(502, 3.6), genSapling(503, 5.2));                  // 11-13
    M.push(genOak(601, 17));                                                                     // 14
    M.push(genSpruce(105, 9, false), genSpruce(106, 5.5, false));                               // 15-16 young open-grown spruces
  }

  private pickModel(rng: RNG, kind: 'spruce' | 'beech' | 'birch' | 'snag' | 'sapling' | 'youngSpruce'): number {
    switch (kind) {
      case 'spruce': return rng.int(0, 3);
      case 'beech': return rng.int(4, 6);
      case 'birch': return rng.int(7, 8);
      case 'snag': return rng.int(9, 10);
      case 'sapling': return rng.int(11, 13);
      case 'youngSpruce': return rng.int(15, 16);
    }
  }

  private scatter(density: number): void {
    const noise = new Noise(4242);
    const P = 4096;
    const block = blockers();
    for (let cz = 0; cz < NC; cz++) for (let cx = 0; cx < NC; cx++) {
      const cell: Cell = { cx, cz, trees: [], box: new THREE.Box3(), lod: -1, colliders: null };
      const x0 = -WORLD_HALF + cx * CELL, z0 = -WORLD_HALF + cz * CELL;
      const rng = new RNG(((cx * 7919) ^ (cz * 104729)) + 99);
      const spacing = 4.6 / Math.sqrt(Math.max(0.2, density));
      const n = Math.floor(CELL / spacing);
      let minY = Infinity, maxY = -Infinity;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = x0 + (i + rng.float()) * spacing, z = z0 + (j + rng.float()) * spacing;
        if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
        const open = this.terrain.openAt(x, z);
        const clear = this.terrain.pathClearAt(x, z);
        // forest density: thins near open land, gaps & clumps from noise
        const clump = noise.perlin(x * 0.025 + 3, z * 0.025 + 7, P, P);
        let dens = (1 - open) * (1 - clear) * (0.62 + clump * 0.45);
        // forest mantle (Waldmantel): a dense belt of young, low-branched trees where the stand meets
        // open land – otherwise the edge reads as rows of bare trunks under fogged-out crowns
        if (open > 0.05 && open < 0.7) dens += 0.3 * Math.max(0, 1 - Math.abs(open - 0.28) * 3);
        if (rng.float() > dens) continue;
        let blocked = false;
        for (const b of block) if (rectDist(b.r, x, z) < b.m) { blocked = true; break; }
        if (blocked) continue;
        if (this.terrain.slopeAt(x, z) > 1.1) continue;
        // species by stand type
        const beechStand = noise.perlin(x * 0.012 + 11, z * 0.012 + 5, P, P);
        const beetle = noise.perlin(x * 0.03 + 21, z * 0.03 + 9, P, P);
        let kind: 'spruce' | 'beech' | 'birch' | 'snag' | 'sapling' | 'youngSpruce';
        const r = rng.float();
        if (beetle > 0.42 && r < 0.6) kind = 'snag';
        else if (open > 0.07) kind = r < 0.2 ? 'birch' : r < 0.72 ? 'youngSpruce' : r < 0.88 ? 'sapling' : 'spruce';
        else if (beechStand > 0.15) kind = r < 0.7 ? 'beech' : r < 0.85 ? 'spruce' : r < 0.95 ? 'sapling' : 'birch';
        else kind = r < 0.78 ? 'spruce' : r < 0.86 ? 'beech' : r < 0.92 ? 'snag' : r < 0.97 ? 'sapling' : 'birch';
        const model = this.pickModel(rng, kind);
        const y = this.terrain.heightAt(x, z) - 0.05;
        const s = 0.85 + rng.float() * 0.3;
        cell.trees.push({ model, x, y, z, ry: rng.float() * Math.PI * 2, s });
        minY = Math.min(minY, y); maxY = Math.max(maxY, y + this.models[model].height * s);
      }
      if (cell.trees.length) cell.box.set(new THREE.Vector3(x0 - 6, minY - 1, z0 - 6), new THREE.Vector3(x0 + CELL + 6, maxY + 1, z0 + CELL + 6));
      this.cells.push(cell);
      this.totalTrees += cell.trees.length;
    }
    // hand-placed landmark trees
    // (the three spruces over the nameless cross outside the cemetery wall come from Sacred.ts)
    const special: [number, number, number][] = [[15.5, 6.5, 14], [-16, -48, 14], [57, -94, 14], [-8, 10, 4], [-14, -40, 12], [11, -58, 12], ...CEMETERY_SPRUCES];
    for (const [x, z, model] of special) {
      const cx = Math.floor((x + WORLD_HALF) / CELL), cz = Math.floor((z + WORLD_HALF) / CELL);
      const cell = this.cells[cz * NC + cx];
      const y = this.terrain.heightAt(x, z) - 0.05;
      cell.trees.push({ model, x, y, z, ry: hash2(x | 0, z | 0) * 6.28, s: 1 });
      const top = y + this.models[model].height;
      if (cell.box.isEmpty()) cell.box.set(new THREE.Vector3(x - 10, y - 1, z - 10), new THREE.Vector3(x + 10, top, z + 10));
      else cell.box.expandByPoint(new THREE.Vector3(x, top, z));
      this.totalTrees++;
    }
  }

  private createMeshes(): void {
    const T = this.textures, V = this.veg;
    const sil = drawSilhouettes();
    const mats = new Map<string, THREE.Material>();
    const mat = (key: string, make: () => THREE.Material) => { let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; };
    const materialFor = (model: TreeModel, slot: Slot): THREE.Material => {
      const H = model.height;
      const sp = model.species;
      if (slot === 'bark') {
        const tex = sp === 'spruce' ? 'bark_spruce' : sp === 'birch' ? 'bark_birch' : sp === 'oak' ? 'bark_oak' : sp === 'snag' ? 'deadwood' : 'bark_beech';
        const hk = H > 12 ? 'tall' : 'small';
        return mat(`bark:${tex}:${hk}`, () => barkMaterial(T, tex, 1.0, 2.0, hk === 'tall' ? 25 : 4, hk === 'tall' ? 0.35 : 0.15, sp === 'snag' ? 0.8 : 0.5));
      }
      if (slot === 'board') {
        return mat(`board:${sp === 'spruce' ? 'spruce' : 'bare'}`, () => foliageMaterial({ map: sp === 'spruce' ? sil.spruce : sil.bare, treeHeight: 25, trunkSway: 0.3, flutter: 0, alphaTest: 0.4, roughness: 0.9 }));
      }
      if (sp === 'spruce') {
        return slot === 'cardA'
          ? mat('spruce', () => foliageMaterial({ map: V.spruce, treeHeight: 25, trunkSway: 0.35, flutter: 0.05, tint: '#e8f0e0' }))
          : mat('spruceDead', () => foliageMaterial({ map: V.spruceDead, treeHeight: 25, trunkSway: 0.35, flutter: 0.02 }));
      }
      if (slot === 'cardA') return mat(`twigs:${H > 8 ? 'tall' : 'small'}`, () => foliageMaterial({ map: V.twigs, treeHeight: H > 8 ? 22 : 4, trunkSway: H > 8 ? 0.4 : 0.15, flutter: 0.09, alphaTest: 0.35 }));
      return mat(`leaves:${H > 8 ? 'tall' : 'small'}`, () => foliageMaterial({ map: V.beechLeaves, treeHeight: H > 8 ? 22 : 4, trunkSway: H > 8 ? 0.4 : 0.15, flutter: 0.12, alphaTest: 0.38 }));
    };

    const groups = new Map<string, number[]>();
    this.models.forEach((m, i) => {
      const key = `${m.species}:${m.species === 'spruce' && m.height < 12 ? 'young' : ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    });
    for (const ids of groups.values()) {
      const sorted = [...ids].sort((a, b) => this.models[a].height - this.models[b].height);
      const r = sorted[Math.floor(sorted.length / 2)];
      for (const i of ids) this.rep[i] = r;
    }
    const counts = this.models.map(() => 0);
    const repCounts = this.models.map(() => 0);
    for (const c of this.cells) for (const t of c.trees) { counts[t.model]++; repCounts[this.rep[t.model]]++; }
    this.models.forEach((model, mi) => {
      const lods: ModelLOD[] = [];
      model.lods.forEach((lod, li) => {
        const cap = Math.max(1, li === 0 ? counts[mi] : repCounts[mi]);
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        attr.setUsage(THREE.DynamicDrawUsage);
        const slots: ModelSlot[] = [];
        for (const [slot, geom] of Object.entries(lod.geoms) as [Slot, THREE.BufferGeometry][]) {
          if (!geom) continue;
          const mesh = new THREE.InstancedMesh(geom, materialFor(model, slot), cap);
          mesh.instanceMatrix = attr;
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = li === 0;
          mesh.receiveShadow = true;
          mesh.name = `tree_${mi}_${li}_${slot}`;
          mesh.layers.set(LAYER_VEGETATION);
          this.group.add(mesh);
          slots.push({ mesh });
        }
        lods.push({ slots, attr, count: 0 });
      });
      this.lods.push(lods);
    });
  }

  /** Rebin visible instances (cheap; only when the camera moved or turned noticeably). */
  update(camera: THREE.PerspectiveCamera, viewDistance: number, playerPos: THREE.Vector3): void {
    const moved = camera.position.distanceToSquared(this.lastPos) > 4 * 4;
    const turned = 1 - Math.abs(camera.quaternion.dot(this.lastQuat)) > 0.008; // ≈ 14°
    if (moved || turned) {
      this.lastPos.copy(camera.position);
      this.lastQuat.copy(camera.quaternion);
      this.rebuild(camera, viewDistance);
    }
    this.updateColliders(playerPos);
  }

  private rebuild(camera: THREE.PerspectiveCamera, viewDistance: number): void {
    camera.updateMatrixWorld();
    // widened frustum so small turns don't require a rebuild
    this.wide.copy(camera);
    this.wide.fov = Math.min(150, camera.fov + 50);
    this.wide.aspect = camera.aspect;
    this.wide.updateProjectionMatrix();
    this.m4.multiplyMatrices(this.wide.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    for (const lods of this.lods) for (const l of lods) l.count = 0;
    const cp = camera.position;
    const d = this.dummy;
    for (const c of this.cells) {
      if (!c.trees.length) continue;
      const cxw = -WORLD_HALF + (c.cx + 0.5) * CELL, czw = -WORLD_HALF + (c.cz + 0.5) * CELL;
      const dist = Math.max(0, Math.hypot(cxw - cp.x, czw - cp.z) - CELL * 0.7);
      if (dist > viewDistance) continue;
      // cells close by are always kept (they cast shadows into view)
      if (dist > 24 && !this.frustum.intersectsBox(c.box)) continue;
      // matrices are computed once per cell; a rebuild only copies them (turning the camera
      // triggers this, so it has to stay well under a millisecond)
      let mats = c.mats;
      if (!mats) {
        mats = c.mats = new Float32Array(c.trees.length * 16);
        c.trees.forEach((t, i) => {
          d.position.set(t.x, t.y, t.z);
          d.rotation.set(0, t.ry, 0);
          d.scale.setScalar(t.s);
          d.updateMatrix();
          d.matrix.toArray(mats!, i * 16);
        });
      }
      for (let i = 0; i < c.trees.length; i++) {
        const t = c.trees[i];
        const dx = t.x - cp.x, dz = t.z - cp.z, td2 = dx * dx + dz * dz;
        const lod = td2 < 32 * 32 ? 0 : td2 < 85 * 85 ? 1 : 2;
        const mi = lod === 0 ? t.model : this.rep[t.model];
        const L = this.lods[mi][lod];
        const dst = L.attr.array as Float32Array;
        const o = L.count * 16, src = i * 16;
        for (let k = 0; k < 16; k++) dst[o + k] = mats[src + k];
        if (mi !== t.model) {
          // the representative, scaled to this tree's height (basis columns only)
          const f = this.models[t.model].height / this.models[mi].height;
          for (const k of SCALE_IDX) dst[o + k] *= f;
        }
        L.count++;
      }
    }
    for (const lods of this.lods) for (const l of lods) {
      // an empty instanced mesh still costs a full render-object update per pass: hide it
      for (const s of l.slots) { s.mesh.count = l.count; s.mesh.visible = l.count > 0; }
      l.attr.needsUpdate = true;
      l.attr.clearUpdateRanges();
      l.attr.addUpdateRange(0, l.count * 16);
    }
  }

  private updateColliders(p: THREE.Vector3): void {
    const R = 48;
    for (const c of this.cells) {
      if (!c.trees.length) continue;
      const cxw = -WORLD_HALF + (c.cx + 0.5) * CELL, czw = -WORLD_HALF + (c.cz + 0.5) * CELL;
      const near = Math.hypot(cxw - p.x, czw - p.z) < R;
      if (near && !c.colliders) {
        c.colliders = c.trees.map((t) => {
          const m = this.models[t.model];
          const r = Math.max(0.08, m.radius * t.s * 0.9);
          return this.physics.addCylinder(t.x, t.y + 3, t.z, r, 3, 'wood', GROUP.VEGETATION);
        });
      } else if (!near && c.colliders && Math.hypot(cxw - p.x, czw - p.z) > R + 16) {
        for (const col of c.colliders) this.physics.removeCollider(col);
        c.colliders = null;
      }
    }
  }

  /** Make every instanced mesh drawable once so the renderer can compile all pipelines up front. */
  prepareWarmup(on: boolean): void {
    for (const lods of this.lods) for (const l of lods) for (const s of l.slots) { s.mesh.count = on ? 1 : l.count; s.mesh.visible = on || l.count > 0; }
    if (!on) this.lastPos.set(1e9, 0, 0);
  }

  /** Approximate tree density around a point (0..1), for audio ambience. */
  densityAt(x: number, z: number): number {
    const cx = Math.floor((x + WORLD_HALF) / CELL), cz = Math.floor((z + WORLD_HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= NC || cz >= NC) return 0;
    return Math.min(1, this.cells[cz * NC + cx].trees.length / 40);
  }
}

export { grow };
