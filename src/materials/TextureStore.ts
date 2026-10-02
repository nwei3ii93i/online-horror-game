import * as THREE from 'three/webgpu';
import { TEXGEN_VERSION, TEXTURE_DEFS, textureResolution } from './texgen/registry';
import { TextureCache, CachedTex } from './texgen/TextureCache';
import { PHOTO_OVERRIDES } from './photoSets';

/** Photo texture entries of public/assets/manifest.json. */
export type PhotoManifest = Record<string, { res: number; disp: boolean }>;

export interface PBRTextureSet {
  id: string;
  /** albedo (sRGB) + alpha (height | metalness | opacity) */
  a: THREE.DataTexture;
  /** normal.xy, roughness, ao (linear) */
  b: THREE.DataTexture;
  alphaMode: 'height' | 'metal' | 'opacity';
  /** Real-world tile size in metres for photoscanned sets (overrides material scale). */
  scale?: [number, number];
  /** True when this set is a CC0 photoscan rather than procedural. */
  photo?: boolean;
}

/**
 * Generates every procedural PBR texture set in a worker pool (cached in IndexedDB)
 * and wraps them as GPU textures.
 */
export class TextureStore {
  readonly sets = new Map<string, PBRTextureSet>();
  private cache = new TextureCache();

  constructor(private size: number, private anisotropy: number) {}

  get(id: string): PBRTextureSet {
    const s = this.sets.get(id);
    if (!s) throw new Error(`Texture set '${id}' not loaded`);
    return s;
  }

  /**
   * Builds every texture set. Ids listed in PHOTO_OVERRIDES whose scan is present in
   * `photos` are packed from the photoscans; everything else is synthesised.
   */
  async loadAll(onProgress?: (done: number, total: number, label: string) => void, photos: PhotoManifest = {}, photoBase = ''): Promise<void> {
    const all = TEXTURE_DEFS.map((d) => d.id);
    const photoIds = all.filter((id) => PHOTO_OVERRIDES[id] && photos[PHOTO_OVERRIDES[id].photo]);
    const ids = all.filter((id) => !photoIds.includes(id));
    const total = all.length;
    let done = 0;
    const tick = (id: string) => onProgress?.(++done, total, id);
    const photoP = this.loadPhotos(photoIds, photos, photoBase, tick);
    // 1. cache lookups in parallel
    const cached = await Promise.all(ids.map((id) => this.cache.get(this.key(id))));
    const pending: string[] = [];
    ids.forEach((id, k) => {
      const c = cached[k];
      if (c && c.size === textureResolution(id, this.size)) {
        this.add(id, c);
        tick(id);
      } else pending.push(id);
    });
    // 2. generate the rest in a worker pool
    await Promise.all([this.synthesise(pending, tick), photoP]);
    // 3. a scan that failed to load falls back to the procedural generator
    const missing = photoIds.filter((id) => !this.sets.has(id));
    if (missing.length) {
      console.warn('photo textures missing, synthesising:', missing);
      await this.synthesise(missing, () => undefined);
    }
  }

  private async synthesise(pending: string[], tick: (id: string) => void): Promise<void> {
    if (!pending.length) return;
    pending.sort((x, y) => textureResolution(y, this.size) - textureResolution(x, this.size));
    const poolSize = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    const workers: Worker[] = [];
    for (let i = 0; i < Math.min(poolSize, pending.length); i++) {
      workers.push(new Worker(new URL('./texgen/texgen.worker.ts', import.meta.url), { type: 'module' }));
    }
    let next = 0;
    let jobId = 0;
    await Promise.all(workers.map((w) => new Promise<void>((resolve) => {
      const pump = () => {
        if (next >= pending.length) { w.terminate(); resolve(); return; }
        const id = pending[next++];
        const myJob = ++jobId;
        w.onmessage = (e: MessageEvent) => {
          const d = e.data;
          if (d.jobId !== myJob) return;
          if (d.error) console.error('texgen failed', id, d.error);
          else {
            const tex: CachedTex = { size: d.size, a: d.a, b: d.b, alphaMode: d.alphaMode };
            this.add(id, tex);
            void this.cache.put(this.key(id), tex);
          }
          tick(id);
          pump();
        };
        w.postMessage({ jobId: myJob, id, size: this.size });
      };
      pump();
    })));
  }

  private async loadPhotos(ids: string[], photos: PhotoManifest, base: string, onDone: (id: string) => void): Promise<void> {
    if (!ids.length) return;
    const workers = Array.from({ length: Math.min(3, ids.length) }, () => new Worker(new URL('./photoPack.worker.ts', import.meta.url), { type: 'module' }));
    let next = 0, jobId = 0;
    await Promise.all(workers.map((w) => new Promise<void>((resolve) => {
      const pump = () => {
        if (next >= ids.length) { w.terminate(); resolve(); return; }
        const id = ids[next++];
        const o = PHOTO_OVERRIDES[id];
        const info = photos[o.photo];
        const size = Math.min(info.res, Math.max(512, this.size));
        const myJob = ++jobId;
        w.onmessage = (e: MessageEvent) => {
          const d = e.data;
          if (d.jobId !== myJob) return;
          if (d.error) console.error('photo texture failed', id, o.photo, d.error);
          else {
            const sc = Array.isArray(o.scale) ? o.scale : [o.scale, o.scale];
            this.add(id, { size: d.size, a: d.a, b: d.b, alphaMode: d.alphaMode }, [sc[0], sc[1]]);
          }
          onDone(id);
          pump();
        };
        w.postMessage({ jobId: myJob, base: `${base}textures/${o.photo}/`, size, disp: info.disp, alphaMode: o.alphaMode ?? 'height', tint: o.tint ?? [1, 1, 1] });
      };
      pump();
    })));
  }

  private key(id: string): string {
    return `${id}@${textureResolution(id, this.size)}@v${TEXGEN_VERSION}`;
  }

  private add(id: string, t: CachedTex, scale?: [number, number]): void {
    const mk = (data: Uint8Array, srgb: boolean) => {
      const tex = new THREE.DataTexture(data, t.size, t.size, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = this.anisotropy;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.name = id + (srgb ? '_A' : '_B');
      tex.needsUpdate = true;
      return tex;
    };
    this.sets.set(id, { id, a: mk(t.a, true), b: mk(t.b, false), alphaMode: t.alphaMode as PBRTextureSet['alphaMode'], scale, photo: !!scale });
  }

  clearCache(): Promise<void> { return this.cache.clear(); }

  /**
   * Builds two DataArrayTextures (A: albedo+alpha, B: normal/rough/ao) from several
   * texture sets. Mismatched resolutions are resampled to the largest one.
   * Used by the terrain shader to stay within sampler limits.
   */
  buildArray(ids: string[]): { a: THREE.DataArrayTexture; b: THREE.DataArrayTexture; size: number } {
    const sets = ids.map((id) => this.get(id));
    const size = Math.max(...sets.map((s) => s.a.image.width));
    const layer = size * size * 4;
    const A = new Uint8Array(layer * ids.length);
    const B = new Uint8Array(layer * ids.length);
    sets.forEach((s, li) => {
      const n = s.a.image.width;
      const srcA = s.a.image.data as Uint8Array, srcB = s.b.image.data as Uint8Array;
      if (n === size) {
        A.set(srcA, li * layer); B.set(srcB, li * layer);
      } else {
        const f = n / size;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const sx = Math.min(n - 1, Math.floor(x * f)), sy = Math.min(n - 1, Math.floor(y * f));
          const so = (sy * n + sx) * 4, d = li * layer + (y * size + x) * 4;
          for (let c = 0; c < 4; c++) { A[d + c] = srcA[so + c]; B[d + c] = srcB[so + c]; }
        }
      }
    });
    const mk = (data: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataArrayTexture(data, size, size, ids.length);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = this.anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return { a: mk(A, true), b: mk(B, false), size };
  }
}
