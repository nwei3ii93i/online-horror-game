import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads the CC0 photoscanned assets fetched by tools/fetch-assets.mjs
 * (public/assets/manifest.json). Every consumer falls back to procedural content when
 * an asset is missing, so the game also runs without the asset folder.
 */
export interface PhotoTextureInfo { size: [number, number]; res: number; disp: boolean; name: string }
export interface Manifest { textures: Record<string, PhotoTextureInfo>; models: Record<string, { name: string; polycount: number | null; dimensions: number[] | null }> }

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const BASE = ASSET_BASE;

export class AssetManager {
  manifest: Manifest = { textures: {}, models: {} };
  private gltf = new GLTFLoader();
  private models = new Map<string, Promise<THREE.Group | null>>();

  constructor(private anisotropy = 8) {}

  async init(): Promise<void> {
    try {
      const r = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
      if (r.ok) this.manifest = await r.json();
    } catch { /* no assets – procedural fallbacks */ }
  }

  hasPhoto(id: string): boolean { return !!this.manifest.textures[id]; }
  hasModel(id: string): boolean { return !!this.manifest.models[id]; }

  /** Load a GLB model (cached). Returns a template group – clone it for placement. */
  model(id: string): Promise<THREE.Group | null> {
    let p = this.models.get(id);
    if (!p) {
      p = this.hasModel(id)
        ? this.gltf.loadAsync(`${BASE}models/${id}.glb`).then((g) => {
          const root = g.scene;
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) {
                const sm = mat as THREE.MeshStandardMaterial;
                if (sm.map) sm.map.anisotropy = this.anisotropy;
                // dust: photoscans are clean – age them slightly
                if ('roughness' in sm) sm.roughness = Math.min(1, (sm.roughness ?? 1) * 1.05);
              }
            }
          });
          return root;
        }).catch((e) => { console.warn('model failed', id, e); return null; })
        : Promise.resolve(null);
      this.models.set(id, p);
    }
    return p;
  }

  /** Synchronous access after preload() resolved. */
  readonly ready = new Map<string, THREE.Group>();
  async preload(ids: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      const g = await this.model(id);
      if (g) this.ready.set(id, g);
      onProgress?.(++done, ids.length);
    }));
  }

  clone(id: string): THREE.Group | null {
    const g = this.ready.get(id);
    return g ? g.clone(true) : null;
  }
}
