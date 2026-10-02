import RAPIER from '@dimforge/rapier3d-compat';
import type { TerrainData } from '../world/TerrainData';
import { WORLD_HALF, Rect } from '../world/Layout';

export type R = typeof RAPIER;

/** Collision groups (membership << 16 | filter). */
export const GROUP = {
  STATIC: 0x0001,
  TERRAIN: 0x0002,
  PLAYER: 0x0004,
  DYNAMIC: 0x0008,
  DOOR: 0x0010,
  TRIGGER: 0x0020,
  VEGETATION: 0x0040,
};
export const groups = (member: number, filter: number) => (member << 16) | filter;

export interface StaticBox {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  /** Rotation about Y (radians). */
  ry?: number;
  /** Optional full rotation quaternion. */
  q?: { x: number; y: number; z: number; w: number };
  /** Surface tag for footsteps. */
  surface?: string;
}

/**
 * Thin wrapper around Rapier: world stepping, static geometry helpers, terrain
 * height field and the per-collider surface registry used for footstep audio.
 */
export class Physics {
  static R: R;
  world!: RAPIER.World;
  readonly surfaces = new Map<number, string>();
  terrainCollider: RAPIER.Collider | null = null;
  /** Regions where terrain collision is ignored (basement stairs, shafts). */
  terrainExclusions: { rect: Rect; below: number }[] = [];
  private staticBody!: RAPIER.RigidBody;

  static async load(): Promise<R> {
    if (!Physics.R) {
      await RAPIER.init();
      Physics.R = RAPIER;
    }
    return Physics.R;
  }

  async init(): Promise<void> {
    const R = await Physics.load();
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.staticBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
  }

  get R(): R { return Physics.R; }

  step(): void { this.world.step(); }

  addTerrain(data: TerrainData): void {
    const R = this.R;
    const n = data.n - 1; // subdivisions
    // Rapier expects column-major heights: index = col * (nrows + 1) + row,
    // rows along X? We verify orientation at runtime in tests; here rows run along Z.
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) {          // x index
      for (let j = 0; j <= n; j++) {        // z index
        heights[i * (n + 1) + j] = data.heights[j * data.n + i];
      }
    }
    const desc = R.ColliderDesc.heightfield(n, n, heights, { x: WORLD_HALF * 2, y: 1, z: WORLD_HALF * 2 })
      .setTranslation(0, 0, 0)
      .setFriction(0.9)
      .setCollisionGroups(groups(GROUP.TERRAIN, 0xffff));
    this.terrainCollider = this.world.createCollider(desc, this.staticBody);
    this.surfaces.set(this.terrainCollider.handle, 'terrain');
  }

  addBox(b: StaticBox, group = GROUP.STATIC): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cuboid(Math.max(0.005, b.hx), Math.max(0.005, b.hy), Math.max(0.005, b.hz))
      .setTranslation(b.cx, b.cy, b.cz)
      .setFriction(0.8)
      .setCollisionGroups(groups(group, 0xffff));
    if (b.q) desc.setRotation(b.q);
    else if (b.ry) {
      const s = Math.sin(b.ry / 2), c = Math.cos(b.ry / 2);
      desc.setRotation({ x: 0, y: s, z: 0, w: c });
    }
    const col = this.world.createCollider(desc, this.staticBody);
    if (b.surface) this.surfaces.set(col.handle, b.surface);
    return col;
  }

  addCylinder(x: number, y: number, z: number, radius: number, halfHeight: number, surface = 'wood', group = GROUP.VEGETATION): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z).setCollisionGroups(groups(group, 0xffff));
    const col = this.world.createCollider(desc, this.staticBody);
    this.surfaces.set(col.handle, surface);
    return col;
  }

  /** Static triangle mesh (stairs, ramps, irregular props). */
  addTrimesh(vertices: Float32Array, indices: Uint32Array, surface = 'stone'): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    const col = this.world.createCollider(desc, this.staticBody);
    this.surfaces.set(col.handle, surface);
    return col;
  }

  removeCollider(c: RAPIER.Collider): void {
    this.surfaces.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  /** Should terrain be ignored for a body at this position? */
  ignoreTerrainAt(x: number, y: number, z: number): boolean {
    for (const e of this.terrainExclusions) {
      const r = e.rect;
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && y < e.below) return true;
    }
    return false;
  }

  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxToi: number, filterGroups = 0xffffffff, exclude?: RAPIER.Collider) {
    const R = this.R;
    const ray = new R.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true, undefined, filterGroups, exclude);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, collider: hit.collider };
  }

  surfaceOf(c: RAPIER.Collider | null | undefined): string {
    if (!c) return 'none';
    return this.surfaces.get(c.handle) ?? 'stone';
  }
}
