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
import { worldUniforms } from '../render/WorldUniforms';
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

  applyInteriorMap(): void {
    const spans = this.buildings.flatMap((b) => b.spans);
    const { data, w, h } = rasteriseInteriorMap(spans);
    worldUniforms.setInterior(data, w, h, INTERIOR_ORIGIN, INTERIOR_SIZE);
  }

  roomAt(p: THREE.Vector3): Room | undefined {
    return this.rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1 && p.y >= r.y0 - 0.3 && p.y < r.y1);
  }

  private cullInfo: { b: BuildingOutput; box: THREE.Box3 }[] | null = null;

  /**
   * Whole-building visibility: beyond ~120 m the fog has swallowed a building anyway, and the
   * tunnels are only drawn when the camera is below ground (they're buried everywhere else).
   */
  cull(cam: THREE.Vector3): void {
    if (!this.cullInfo) this.cullInfo = this.buildings.map((b) => ({ b, box: new THREE.Box3().setFromObject(b.group) }));
    for (const { b, box } of this.cullInfo) {
      const d = box.distanceToPoint(cam);
      if (b.id === 'tunnels') b.group.visible = cam.y < 0.3 && d < 70;
      else b.group.visible = d < (b.id === 'manor' ? 220 : 125);
    }
  }

  get doorSpecs() { return this.buildings.flatMap((b) => b.doors); }
  get lightFixtures() { return this.buildings.flatMap((b) => b.lights); }
}
