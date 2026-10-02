import * as THREE from 'three/webgpu';
import type { Physics } from '../physics/Physics';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { TerrainData } from './TerrainData';
import type { BuildingOutput, InteriorSpan, Room } from './architecture/BuildingKit';
import { buildManor } from './buildings/Manor';
import { buildGreenhouse, buildChapel, buildCemetery, buildHuntingStand } from './buildings/Sacred';
import { buildWorkshop, buildBarn, buildPumpHouse } from './buildings/Outbuildings';
import { buildTunnels } from './buildings/Tunnels';
import { buildCaretaker } from './buildings/Caretaker';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldUniforms } from '../render/WorldUniforms';
import { LAYER_SHADOW_PROXY } from '../render/PostFX';
import { buildVan, VanOutput } from './vehicles/Van';
import { POI } from './Layout';

export const INTERIOR_ORIGIN = new THREE.Vector2(-128, -160);
export const INTERIOR_SIZE = new THREE.Vector2(256, 256);
export const INTERIOR_RES = 0.25;

/** Rasterise interior spans (floor/ceiling per enclosed space) into the top-down interior map. */
export function rasteriseInteriorMap(spans: InteriorSpan[]): { data: Float32Array; w: number; h: number } {
  const w = Math.round(INTERIOR_SIZE.x / INTERIOR_RES), h = Math.round(INTERIOR_SIZE.y / INTERIOR_RES);
  const data = new Float32Array(w * h * 2); // (floor, ceil) — zeros = no interior
  for (const s of spans) {
    const i0 = Math.max(0, Math.ceil((s.x0 - INTERIOR_ORIGIN.x) / INTERIOR_RES));
    const i1 = Math.min(w - 1, Math.floor((s.x1 - INTERIOR_ORIGIN.x) / INTERIOR_RES) - 1);
    const j0 = Math.max(0, Math.ceil((s.z0 - INTERIOR_ORIGIN.y) / INTERIOR_RES));
    const j1 = Math.min(h - 1, Math.floor((s.z1 - INTERIOR_ORIGIN.y) / INTERIOR_RES) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = INTERIOR_ORIGIN.x + (i + 0.5) * INTERIOR_RES, z = INTERIOR_ORIGIN.y + (j + 0.5) * INTERIOR_RES;
      const c = typeof s.ceil === 'number' ? s.ceil : s.ceil(x, z);
      const k = (j * w + i) * 2;
      // merge: keep the widest span
      if (data[k] === 0 && data[k + 1] === 0) { data[k] = s.floorY; data[k + 1] = c; }
      else { data[k] = Math.min(data[k], s.floorY); data[k + 1] = Math.max(data[k + 1], c); }
    }
  }
  return { data, w, h };
}

/**
 * Static world content: buildings and their interactive parts. Building geometry is
 * generated deterministically, so every client constructs the same estate.
 */
export class World {
  readonly group = new THREE.Group();
  readonly buildings: BuildingOutput[] = [];
  readonly rooms: Room[] = [];
  /** The group's van – disabled until a proper photoscanned/realistic model replaces the procedural placeholder. */
  van: VanOutput | null = null;

  static withVan = false;

  constructor(private physics: Physics, private materials: MaterialLibrary, private terrain: TerrainData) {
    this.group.name = 'world';
  }

  /** Building layout data needed before materials compile (interior map). */
  static prepareInteriorSpans(): InteriorSpan[] {
    // spans are produced by the builders; we run them physics-less in a dry pass? Too costly –
    // instead each builder exposes its spans after building. The Game builds geometry first
    // and only then creates materials, so this is just a convenience hook.
    return [];
  }

  build(): void {
    const manor = buildManor(this.physics, this.materials);
    this.add(manor);
    const h = (x: number, z: number) => this.terrain.heightAt(x, z);
    this.add(buildGreenhouse(this.physics, this.materials, h));
    this.add(buildChapel(this.physics, this.materials, h));
    this.add(buildCemetery(this.physics, this.materials, h));
    this.add(buildHuntingStand(this.physics, this.materials, h));
    this.add(buildWorkshop(this.physics, this.materials, h));
    this.add(buildBarn(this.physics, this.materials, h));
    this.add(buildPumpHouse(this.physics, this.materials, h));
    this.add(buildTunnels(this.physics, this.materials, h));
    this.add(buildCaretaker(this.physics, this.materials, h));
    if (World.withVan) {
      const v = POI.van;
      this.van = buildVan(this.materials, this.physics, v.x, v.z, v.heading, (x, z) => this.terrain.heightAt(x, z));
      this.group.add(this.van.group);
    }
  }

  private add(b: BuildingOutput): void {
    this.buildings.push(b);
    this.rooms.push(...b.rooms);
    this.group.add(b.group);
  }

  /** Add an object to a building's group (before the first cull, so interior classification sees it). */
  attach(id: string, obj: THREE.Object3D): void {
    this.buildings.find((b) => b.id === id)?.group.add(obj);
  }

  applyInteriorMap(): void {
    const spans = this.buildings.flatMap((b) => b.spans);
    const { data, w, h } = rasteriseInteriorMap(spans);
    worldUniforms.setInterior(data, w, h, INTERIOR_ORIGIN, INTERIOR_SIZE);
  }

  roomAt(p: THREE.Vector3): Room | undefined {
    return this.rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1 && p.y >= r.y0 - 0.3 && p.y < r.y1);
  }

  private cullInfo: { b: BuildingOutput; box: THREE.Box3; proxies: THREE.Mesh[]; casters: THREE.Mesh[]; shadows: boolean; interior: THREE.Mesh[]; interiorOn: boolean }[] | null = null;

  /**
   * Meshes whose vertices all lie inside the building's rooms (wall finishes, floors, ceilings,
   * stairs, fittings): invisible from outside except through windows from close by.
   */
  private static interiorMeshes(b: BuildingOutput): THREE.Mesh[] {
    const rooms = b.rooms;
    if (!rooms.length) return [];
    const out: THREE.Mesh[] = [];
    const v = new THREE.Vector3();
    b.group.updateMatrixWorld(true);
    b.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      if (!pos) return;
      let outside = 0;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const inside = rooms.some((r) => v.x > r.x0 - 0.02 && v.x < r.x1 + 0.02 && v.z > r.z0 - 0.02 && v.z < r.z1 + 0.02 && v.y > r.y0 - 0.45 && v.y < r.y1 + 0.45);
        if (!inside && ++outside > 2) return;
      }
      out.push(m);
    });
    return out;
  }

  /**
   * A shadow pass only needs depth, so all of a building's plain opaque casters (one mesh per
   * material, often 50–150) are merged into one position-only stand-in per face side that only
   * shadow cameras see. Alpha-tested, transparent or vertex-animated casters stay as they are.
   */
  private static shadowProxies(b: BuildingOutput): { proxies: THREE.Mesh[]; rest: THREE.Mesh[] } {
    b.group.updateMatrixWorld(true);
    const inv = b.group.matrixWorld.clone().invert();
    const bySide = new Map<THREE.Side, THREE.BufferGeometry[]>();
    const rest: THREE.Mesh[] = [];
    const sources: THREE.Mesh[] = [];
    b.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.Material & Record<string, any>)[];
      const side = mats[0].side;
      const special = mats.some((mt) => mt.transparent || mt.alphaTest > 0 || mt.alphaTestNode || mt.opacityNode || mt.positionNode || mt.side !== side);
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (special || !pos || (m as any).isInstancedMesh || (m as any).isSkinnedMesh) { rest.push(m); return; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pos.clone());
      const idx = m.geometry.getIndex();
      if (idx) g.setIndex(idx.clone());
      else g.setIndex([...Array(pos.count).keys()]);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side)!.push(g);
      sources.push(m);
    });
    const proxies: THREE.Mesh[] = [];
    for (const [side, geoms] of bySide) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) { for (const m of sources) rest.push(m); return { proxies: [], rest }; }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mat = new THREE.MeshBasicNodeMaterial({ side, colorWrite: false });
      const proxy = new THREE.Mesh(merged, mat);
      proxy.name = `${b.id}:shadow`;
      proxy.layers.set(LAYER_SHADOW_PROXY);
      proxy.castShadow = true;
      proxy.receiveShadow = false;
      b.group.add(proxy);
      proxies.push(proxy);
    }
    for (const m of sources) m.castShadow = false;
    return { proxies, rest };
  }

  /**
   * Whole-building visibility: beyond ~120 m the fog has swallowed a building anyway, and the
   * tunnels are only drawn when the camera is below ground (they're buried everywhere else).
   */
  /** Returns true when anything that casts or receives lamp shadows changed visibility. */
  cull(cam: THREE.Vector3): boolean {
    let changed = false;
    if (!this.cullInfo) {
      this.cullInfo = this.buildings.map((b) => {
        const box = new THREE.Box3().setFromObject(b.group);
        const interior = World.interiorMeshes(b);
        const { proxies, rest } = World.shadowProxies(b);
        return { b, box, proxies, casters: rest, shadows: true, interior, interiorOn: true };
      });
    }
    for (const info of this.cullInfo) {
      const { b, box } = info;
      const d = box.distanceToPoint(cam);
      const vis = b.id === 'tunnels' ? cam.y < 0.3 && d < 70 : d < (b.id === 'manor' ? 220 : 95);
      if (vis !== b.group.visible) { b.group.visible = vis; changed = true; }
      // interiors only from close by (through windows / doors) – or from inside, of course
      const interiorOn = d < 14;
      if (interiorOn !== info.interiorOn) {
        info.interiorOn = interiorOn;
        for (const m of info.interior) m.visible = interiorOn;
        changed = true;
      }
      // a building's moon shadow only reads close by; beyond that every caster is a wasted draw
      // call per shadow cascade (the torch never reaches that far either)
      const shadows = d < (b.id === 'manor' ? 60 : 40);
      if (shadows !== info.shadows) {
        info.shadows = shadows;
        for (const m of info.casters) m.castShadow = shadows;
        for (const m of info.proxies) m.visible = shadows;
        changed = true;
      }
    }
    return changed;
  }

  get doorSpecs() { return this.buildings.flatMap((b) => b.doors); }
  get lightFixtures() { return this.buildings.flatMap((b) => b.lights); }
}
