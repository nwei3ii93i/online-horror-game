import * as THREE from 'three/webgpu';
import { float, mix, texture, uv } from 'three/tsl';
import type { AssetManager } from '../../assets/AssetManager';
import type { Physics } from '../../physics/Physics';
import { worldUniforms } from '../../render/WorldUniforms';

export interface PropOptions {
  /** Uniform scale (photoscans are already in metres). */
  scale?: number;
  /** Rotation around X/Z in radians (fallen chairs, tilted frames). */
  tiltX?: number;
  tiltZ?: number;
  /** Collision: 'box' = oriented bounding box (default for bigger props), 'none' for small clutter. */
  collider?: 'box' | 'none';
  surface?: string;
  /** Colour multiplier to age / dirty the scan. */
  tint?: number;
  castShadow?: boolean;
  /**
   * Which point of the model's bounds lands on (x, y, z):
   * 'base' = bottom centre (furniture), 'back' = centre of the back face (wall-hung, front = +Z),
   * 'top' = top centre (hanging lamps).
   */
  anchor?: 'base' | 'back' | 'top';
}

/**
 * Places photoscanned GLB props. Their materials are converted once per source material to
 * node materials that follow the world's interior lighting rules (sky light dies indoors,
 * slight dust) so scans sit in the procedural rooms instead of glowing.
 */
export class PropPlacer {
  readonly group = new THREE.Group();
  private converted = new Map<THREE.Material, THREE.Material>();
  private bounds = new Map<string, THREE.Box3>();
  /** Unit fix per model: some scans ship in decimetres; compare with the catalogue size. */
  private unit = new Map<string, number>();
  /** Placed props for distance / floor culling. */
  readonly placed: { obj: THREE.Object3D; x: number; y: number; z: number; r: number }[] = [];
  private _box = new THREE.Box3();
  private _v = new THREE.Vector3();
  count = 0;

  constructor(private assets: AssetManager, private physics?: Physics) {
    this.group.name = 'props';
  }

  /** Place a prop with its base centred at (x, y, z). Returns null if the asset is missing. */
  place(id: string, x: number, y: number, z: number, ry = 0, o: PropOptions = {}): THREE.Object3D | null {
    const src = this.assets.ready.get(id);
    if (!src) return null;
    let bb = this.bounds.get(id);
    if (!bb) { bb = new THREE.Box3().setFromObject(src, true); this.bounds.set(id, bb); }
    let unit = this.unit.get(id);
    if (unit === undefined) {
      unit = 1;
      const dims = this.assets.manifest.models[id]?.dimensions;
      const ext = bb.getSize(new THREE.Vector3());
      const real = dims ? Math.max(...dims) : 0, got = Math.max(ext.x, ext.y, ext.z);
      if (real > 0 && got > 0 && (got / real > 1.8 || got / real < 0.55)) {
        unit = real / got;
        console.warn(`prop ${id}: rescaled ×${unit.toFixed(3)} to its catalogue size`);
      }
      this.unit.set(id, unit);
    }
    const inner = src.clone(true);
    const anchor = o.anchor ?? 'base';
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    inner.position.set(-cx, anchor === 'top' ? -bb.max.y : anchor === 'back' ? -(bb.min.y + bb.max.y) / 2 : -bb.min.y, anchor === 'back' ? -bb.min.z : -cz);
    const obj = new THREE.Group();
    obj.add(inner);
    obj.name = id;
    const s = (o.scale ?? 1) * unit;
    obj.scale.setScalar(s);
    obj.rotation.set(o.tiltX ?? 0, ry, o.tiltZ ?? 0, 'YXZ');
    obj.position.set(x, y, z);
    // only furniture-sized props cast (flashlight) shadows; clutter would cost a shadow pass each
    const ext = bb.getSize(new THREE.Vector3()).multiplyScalar(s);
    const castDefault = ext.y > 0.9 || ext.x * ext.z > 0.6;
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = o.castShadow ?? castDefault;
      m.receiveShadow = true;
      m.material = Array.isArray(m.material) ? m.material.map((mm) => this.convert(mm, o.tint)) : this.convert(m.material, o.tint);
    });
    obj.updateMatrixWorld(true);
    this.group.add(obj);
    this.count++;
    this.placed.push({ obj, x, y, z, r: Math.max(ext.x, ext.y, ext.z) / 2 });
    const size = bb.getSize(this._v).multiplyScalar(unit);
    const tilted = Math.abs(o.tiltX ?? 0) + Math.abs(o.tiltZ ?? 0) > 0.05;
    const auto = size.x * size.z * s * s > 0.12 || size.y * s > 0.6 ? 'box' : 'none';
    if (this.physics && (o.collider ?? auto) === 'box') {
      if (tilted) this.addWorldBoxCollider(obj, o.surface ?? 'wood');
      else this.addCollider(inner.position, bb, x, y, z, ry, s, o.surface ?? 'wood');
    }
    return obj;
  }

  /**
   * Visibility culling: props further than `range` are hidden; when `floorY` is given (camera is
   * inside a building), props more than one storey away are hidden too unless very close
   * (stairwells). Hidden props also drop out of every shadow pass.
   */
  /** Returns true when any prop changed visibility. */
  cull(cam: THREE.Vector3, range: number, floorY: number | null): boolean {
    const r2 = range * range;
    let changed = false;
    for (const p of this.placed) {
      const dx = p.x - cam.x, dz = p.z - cam.z, d2 = dx * dx + dz * dz;
      let vis = d2 < (range + p.r) * (range + p.r) || d2 < r2;
      if (vis && floorY !== null && d2 > 36) vis = p.y > floorY - 1.0 && p.y < floorY + 3.0;
      else if (vis && floorY === null) vis = p.y > -0.5; // from outside nothing in the cellar can be seen
      if (p.obj.visible !== vis) { p.obj.visible = vis; changed = true; }
    }
    return changed;
  }

  /** Oriented box collider from the template's local bounds. */
  private addCollider(off: THREE.Vector3, b: THREE.Box3, x: number, y: number, z: number, ry: number, s: number, surface: string): void {
    const c = b.getCenter(new THREE.Vector3()).add(off).multiplyScalar(s);
    const h = b.getSize(new THREE.Vector3()).multiplyScalar(s / 2);
    c.applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    this.physics!.addBox({ cx: x + c.x, cy: y + c.y, cz: z + c.z, hx: Math.max(0.02, h.x), hy: Math.max(0.02, h.y), hz: Math.max(0.02, h.z), ry, surface });
  }

  /** Axis-aligned world box for tipped-over props. */
  private addWorldBoxCollider(obj: THREE.Object3D, surface: string): void {
    const b = this._box.setFromObject(obj, true);
    const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.physics!.addBox({ cx: c.x, cy: c.y, cz: c.z, hx: Math.max(0.02, h.x * 0.85), hy: Math.max(0.02, h.y * 0.85), hz: Math.max(0.02, h.z * 0.85), surface });
  }

  private convert(m: THREE.Material, tint = 1): THREE.Material {
    const key = m;
    const hit = this.converted.get(key);
    if (hit && tint === 1) return hit;
    const src = m as THREE.MeshStandardMaterial;
    const n = new THREE.MeshStandardNodeMaterial();
    n.name = `prop:${src.name}`;
    // scans are shot clean and bright; the house has been dusty for decades
    n.color.copy(src.color ?? new THREE.Color(1, 1, 1)).multiplyScalar(tint * 0.84);
    n.map = src.map ?? null;
    n.normalMap = src.normalMap ?? null;
    if (src.normalScale) n.normalScale.copy(src.normalScale);
    n.roughnessMap = src.roughnessMap ?? null;
    n.metalnessMap = src.metalnessMap ?? null;
    n.roughness = Math.min(1, (src.roughness ?? 1) * 1.04);
    n.metalness = src.metalness ?? 0;
    n.side = src.side;
    n.transparent = src.transparent;
    n.alphaTest = src.alphaTest;
    n.opacity = src.opacity;
    n.vertexColors = src.vertexColors;
    if (src.transparent && src.map) {
      // most "transparent" scan materials are cut-outs (leaves, lace) – keep them sorted-free
      n.transparent = false;
      n.alphaTest = 0.5;
    }
    const W = worldUniforms;
    const ao: any = src.aoMap ? texture(src.aoMap, uv(src.aoMap.channel ?? 0)).r.mul(src.aoMapIntensity ?? 1).add(1 - (src.aoMapIntensity ?? 1)) : float(1);
    (n as any).aoNode = ao.mul(mix(float(1), W.indoorAmbient, W.indoorAt()));
    if (src.emissiveMap || (src.emissive && src.emissive.getHex() !== 0)) {
      n.emissive.copy(src.emissive);
      n.emissiveMap = src.emissiveMap ?? null;
      n.emissiveIntensity = src.emissiveIntensity;
    }
    if (tint === 1) this.converted.set(key, n);
    return n;
  }
}
