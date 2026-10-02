import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, vec4, float, positionWorld, normalWorld, mix, smoothstep, clamp, sqrt, max, dot,
  normalMap, mx_noise_float, int,
} from 'three/tsl';
import { TerrainData, SPLAT_N, SPLAT_LAYERS } from './TerrainData';
import { WORLD_HALF, Rect } from './Layout';
import { TextureStore } from '../materials/TextureStore';
import { worldUniforms } from '../render/WorldUniforms';

const CHUNK = 32;
const LOD_STEPS = [1, 2, 4, 8];

/** Metres per texture tile for each splat layer (same order as SPLAT_LAYERS). */
const LAYER_SCALE = [4.5, 4.2, 4.0, 3.2, 4.0, 5.0, 2.5];
const LAYER_TEX = ['forest_floor', 'meadow', 'mud', 'gravel', 'asphalt', 'rock', 'moss'];

interface Chunk { cx: number; cz: number; mesh: THREE.Mesh; lod: number; geoms: (THREE.BufferGeometry | null)[]; center: THREE.Vector3; hasHole: boolean }

/**
 * Chunked terrain renderer with distance LOD, skirts against cracks and holes
 * under basements. One shared height-blended splat material (7 layers in two
 * texture arrays).
 */
export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  private chunks: Chunk[] = [];
  private splatTex0: THREE.DataTexture;
  private splatTex1: THREE.DataTexture;
  private layerScale: number[];

  constructor(private data: TerrainData, textures: TextureStore, private holes: Rect[]) {
    this.group.name = 'terrain';
    const mk = (d: Uint8Array) => {
      const t = new THREE.DataTexture(d, SPLAT_N, SPLAT_N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.splatTex0 = mk(data.splat0);
    this.splatTex1 = mk(data.splat1);
    const arr = textures.buildArray(LAYER_TEX);
    this.layerScale = LAYER_TEX.map((id, i) => textures.get(id).scale?.[0] ?? LAYER_SCALE[i]);
    this.material = this.createMaterial(arr.a, arr.b);
    void SPLAT_LAYERS;
    const nC = (WORLD_HALF * 2) / CHUNK;
    for (let cz = 0; cz < nC; cz++) for (let cx = 0; cx < nC; cx++) {
      const x0 = -WORLD_HALF + cx * CHUNK, z0 = -WORLD_HALF + cz * CHUNK;
      const hasHole = holes.some((h) => h.x1 > x0 && h.x0 < x0 + CHUNK && h.z1 > z0 && h.z0 < z0 + CHUNK);
      const cy = data.heightAt(x0 + CHUNK / 2, z0 + CHUNK / 2);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.name = `terrain_${cx}_${cz}`;
      this.group.add(mesh);
      this.chunks.push({ cx, cz, mesh, lod: -1, geoms: [null, null, null, null], center: new THREE.Vector3(x0 + CHUNK / 2, cy, z0 + CHUNK / 2), hasHole });
    }
  }

  private createMaterial(arrA: THREE.DataArrayTexture, arrB: THREE.DataArrayTexture): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = 'terrain';
    const W = worldUniforms;
    const pw = positionWorld;
    const suv = pw.xz.add(WORLD_HALF).div(WORLD_HALF * 2);
    const s0 = texture(this.splatTex0, suv);
    const s1 = texture(this.splatTex1, suv);
    // break up splat bilinear blockiness with noise
    const W0 = worldUniforms;
    const jn = W0.noise(pw, 0.6).mul(0.08);
    const weights = [s0.x, s0.y, s0.z, s0.w, s1.x, s1.y, s1.z];
    const A: any[] = [], B: any[] = [];
    for (let i = 0; i < 7; i++) {
      // rotate/offset per layer slightly to decorrelate
      const tuv = pw.xz.div(this.layerScale[i]).add(vec2(i * 0.37, i * 0.71));
      A.push(texture(arrA, tuv).depth(int(i)));
      B.push(texture(arrB, tuv).depth(int(i)));
    }
    // height-based blending (sharp, natural transitions)
    const hw: any[] = weights.map((w, i) => clamp(w.add(jn), 0, 1).mul(1.6).add(A[i].a.mul(0.8)).mul(smoothstep(0.0, 0.08, w)));
    let hmax: any = hw[0];
    for (let i = 1; i < 7; i++) hmax = max(hmax, hw[i]);
    const depth = 0.22;
    const bw = hw.map((h) => max(h.sub(hmax).add(depth), 0));
    let sum: any = bw[0];
    for (let i = 1; i < 7; i++) sum = sum.add(bw[i]);
    const inv = float(1).div(max(sum, 0.0001));
    let albedo: any = vec3(0), nxy: any = vec2(0), rough: any = float(0), ao: any = float(0), height: any = float(0);
    for (let i = 0; i < 7; i++) {
      const w = bw[i].mul(inv);
      albedo = albedo.add(A[i].rgb.mul(w));
      nxy = nxy.add(B[i].xy.mul(2).sub(1).mul(w));
      rough = rough.add(B[i].z.mul(w));
      ao = ao.add(B[i].w.mul(w));
      height = height.add(A[i].a.mul(w));
    }
    // macro variation: large soft patches of tone and moisture
    const m1 = W0.noise(pw, 0.045);
    const m2 = W0.noise(pw.add(9.1), 0.19);
    albedo = albedo.mul(float(1).add(m1.mul(0.22)).add(m2.mul(0.1)));
    // wetness & puddles (puddles only on mud/gravel/asphalt layers, in low spots)
    const outdoor = float(1).sub(W.indoorAt());
    const wet = W.wetness.mul(outdoor);
    const puddleable = bw[2].add(bw[3]).add(bw[4]).mul(inv);
    const pud = smoothstep(0.38, 0.26, height.add(m2.mul(0.08))).mul(puddleable).mul(smoothstep(0.2, 0.7, W.wetness)).mul(smoothstep(0.85, 0.97, normalWorld.y)).mul(outdoor);
    albedo = albedo.mul(mix(float(1), float(0.6), wet.mul(clamp(rough, 0.3, 1))));
    albedo = mix(albedo, albedo.mul(0.4), pud);
    rough = mix(rough, 0.18, wet.mul(0.75));
    rough = mix(rough, 0.03, pud);
    const nscale = float(1.15).mul(float(1).sub(pud.mul(0.95)));
    const nz = sqrt(max(float(1).sub(dot(nxy, nxy)), 0.0));
    mat.colorNode = vec4(albedo, 1);
    mat.normalNode = normalMap(vec3(nxy.mul(0.5).add(0.5), nz.mul(0.5).add(0.5)), vec2(nscale, nscale));
    mat.roughnessNode = clamp(rough, 0.02, 1);
    mat.metalnessNode = float(0);
    mat.aoNode = ao;
    void uv;
    return mat;
  }

  private buildGeometry(c: Chunk, lod: number): THREE.BufferGeometry {
    const step = LOD_STEPS[lod];
    const x0 = -WORLD_HALF + c.cx * CHUNK, z0 = -WORLD_HALF + c.cz * CHUNK;
    const n = CHUNK / step + 1;
    const skirt = 1.5 * step;
    // grid vertices + skirt ring
    const vcount = n * n + 4 * n;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const uvs = new Float32Array(vcount * 2);
    const tmp = { x: 0, y: 0, z: 0 };
    let v = 0;
    const put = (x: number, z: number, drop: number) => {
      const h = this.data.heightAt(x, z) - drop;
      this.data.normalAt(x, z, tmp);
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      nor[v * 3] = tmp.x; nor[v * 3 + 1] = tmp.y; nor[v * 3 + 2] = tmp.z;
      uvs[v * 2] = x; uvs[v * 2 + 1] = z;
      return v++;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(x0 + i * step, z0 + j * step, 0);
    const idx: number[] = [];
    const cutHoles = c.hasHole && lod <= 1;
    const inHole = (x: number, z: number) => this.holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      if (cutHoles) {
        const cxm = x0 + (i + 0.5) * step, czm = z0 + (j + 0.5) * step;
        if (inHole(cxm, czm)) continue;
      }
      // diagonal matches TerrainData.heightAt (split along x+z)
      idx.push(a, cc, b, b, cc, d);
    }
    // skirts: duplicate border vertices dropped down
    const edge = (getIdx: (k: number) => number, flip: boolean) => {
      const start = v;
      for (let k = 0; k < n; k++) {
        const src = getIdx(k);
        put(pos[src * 3], pos[src * 3 + 2], skirt);
      }
      for (let k = 0; k < n - 1; k++) {
        const a = getIdx(k), b = getIdx(k + 1), sa = start + k, sb = start + k + 1;
        if (flip) idx.push(a, b, sa, b, sb, sa); else idx.push(a, sa, b, b, sa, sb);
      }
    };
    edge((k) => k, true);                       // north edge (z0)
    edge((k) => (n - 1) * n + k, false);        // south edge
    edge((k) => k * n, false);                  // west edge
    edge((k) => k * n + n - 1, true);           // east edge
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, v * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Select LODs and visibility around the viewer. */
  update(viewer: THREE.Vector3, viewDistance: number): void {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - viewer.x, c.center.z - viewer.z) - CHUNK * 0.7;
      if (d > viewDistance + 40) { c.mesh.visible = false; continue; }
      let lod = d < 72 ? 0 : d < 150 ? 1 : d < 260 ? 2 : 3;
      if (c.hasHole && d < 90) lod = 0;
      if (lod !== c.lod) {
        if (!c.geoms[lod]) c.geoms[lod] = this.buildGeometry(c, lod);
        c.mesh.geometry = c.geoms[lod]!;
        c.lod = lod;
      }
      c.mesh.visible = true;
    }
  }

  /** Pre-build near LODs so the first frames don't hitch. */
  warm(viewer: THREE.Vector3, viewDistance: number): void {
    this.update(viewer, viewDistance);
  }
}
