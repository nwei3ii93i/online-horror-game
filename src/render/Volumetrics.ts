import * as THREE from 'three/webgpu';
import {
  uniform, vec2, vec3, float, Fn, texture, screenUV, screenCoordinate, interleavedGradientNoise, fract, exp, clamp, max, smoothstep,
  floor, mod, mix, cameraPosition,
} from 'three/tsl';
import { LAYER_VOLUMETRIC } from './PostFX';
import { worldUniforms } from './WorldUniforms';

/**
 * Tileable 3D value noise for drifting fog density, stored as an 8×8 atlas of 64² slices
 * in a 2D texture (3D textures are not reliably uploadable on every WebGPU implementation).
 */
function createFogNoise(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * size);
  const rnd = new Float32Array(size * size * size);
  let s = 1234567;
  for (let i = 0; i < rnd.length; i++) { s = (s * 1103515245 + 12345) >>> 0; rnd[i] = (s >>> 8) / 16777216; }
  const idx = (x: number, y: number, z: number) => ((z % size) * size + (y % size)) * size + (x % size);
  // 3 octaves of smoothed lattice noise
  let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.55, norm = 0;
    for (const cell of [16, 8, 4]) {
      const fx = x / cell, fy = y / cell, fz = z / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
      const n = size / cell;
      const g = (a: number, b: number, c: number) => rnd[idx(((a % n) + n) % n * cell, ((b % n) + n) % n * cell, ((c % n) + n) % n * cell)];
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      const c00 = l(g(x0, y0, z0), g(x0 + 1, y0, z0), sx), c10 = l(g(x0, y0 + 1, z0), g(x0 + 1, y0 + 1, z0), sx);
      const c01 = l(g(x0, y0, z0 + 1), g(x0 + 1, y0, z0 + 1), sx), c11 = l(g(x0, y0 + 1, z0 + 1), g(x0 + 1, y0 + 1, z0 + 1), sx);
      v += amp * l(l(c00, c10, sy), l(c01, c11, sy), sz);
      norm += amp; amp *= 0.5;
    }
    data[i++] = Math.round((v / norm) * 255);
  }
  // pack slices into an atlas (8 × 8 tiles)
  const tiles = 8, W = size * tiles;
  const atlas = new Uint8Array(W * W * 4);
  for (let z = 0; z < size; z++) {
    const tx = (z % tiles) * size, ty = Math.floor(z / tiles) * size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = data[(z * size + y) * size + x];
      const o = ((ty + y) * W + tx + x) * 4;
      atlas[o] = atlas[o + 1] = atlas[o + 2] = v; atlas[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(atlas, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Trilinear lookup into the slice atlas. p in noise-texture units (wraps every 1.0). */
const sampleAtlas3D = (tex: THREE.DataTexture, p: any) => {
  const size = 64, tiles = 8;
  const q: any = fract(p).mul(size);
  const z0 = floor(q.z);
  const f = q.z.sub(z0);
  const z1 = mod(z0.add(1), size);
  const xy = q.xy.clamp(0.5, size - 0.5).div(size * tiles);
  const tileUV = (z: any) => vec2(mod(z, tiles), floor(z.div(tiles))).div(tiles);
  const a = texture(tex, tileUV(z0).add(xy)).r;
  const b = texture(tex, tileUV(z1).add(xy)).r;
  return mix(a, b, f);
};

/**
 * Raymarched participating media around the camera. Lit by every light on the
 * volumetric layer (moon with cascaded shadows, flashlight with its shadow map),
 * so beams and shafts appear naturally where the fog is dense.
 */
export class Volumetrics {
  readonly mesh: THREE.Mesh;
  readonly density: any = uniform(0.009);
  readonly groundFog: any = uniform(0.014);
  readonly drift: any = uniform(new THREE.Vector3(0.35, 0.02, 0.12));
  private t: any = uniform(0);
  private material: THREE.VolumeNodeMaterial;

  constructor(scene: THREE.Scene, steps: number) {
    const noise = createFogNoise(64);
    const mat = new THREE.VolumeNodeMaterial();
    mat.steps = steps;
    // the scene fog must not be applied on top of the in-scattering (it would add a uniform veil)
    mat.fog = false;
    // temporal jitter (works with TRAA) to hide step banding
    mat.offsetNode = fract(interleavedGradientNoise(screenCoordinate).add(this.t.mul(0.618)));
    const W = worldUniforms;
    mat.scatteringNode = Fn(({ positionRay }: { positionRay: any }) => {
      const p = positionRay;
      const drift = vec3(this.drift).mul(this.t);
      const n1 = sampleAtlas3D(noise, p.add(drift).mul(0.035));
      const n2 = sampleAtlas3D(noise, p.add(drift.mul(1.7)).mul(0.11));
      const noiseD = smoothstep(0.25, 0.85, n1.mul(0.7).add(n2.mul(0.45)));
      const hAbove = max(p.y.sub(W.terrainHeight(p.xz)), 0);
      const ground = exp(hAbove.mul(-0.55)).mul(this.groundFog);
      const indoorFade = float(1).sub(W.indoor(p).mul(0.97));
      const rain = W.rainIntensity.mul(0.4).add(1);
      // no scattering right at the lens (avoids the 1/r² hot spot of the hand-held light)
      const dist = p.sub(cameraPosition).length();
      const near = smoothstep(0.5, 1.8, dist);
      // spherical falloff well inside the box so its faces never show up as hard edges
      // near-field only (torch beams, window shafts); distance haze is the analytic height fog
      const far = float(1).sub(smoothstep(5.0, 15.0, dist));
      return vec3(clamp(this.density.mul(noiseD.mul(1.3).add(0.25)).add(ground.mul(noiseD.add(0.3))), 0, 0.5).mul(indoorFade).mul(rain).mul(near).mul(far));
    }) as any;
    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(56, 24, 56), mat);
    this.mesh.layers.disableAll();
    this.mesh.layers.enable(LAYER_VOLUMETRIC);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'volumetrics';
    scene.add(this.mesh);
  }

  setDepth(depthNode: any): void {
    this.material.depthNode = depthNode.sample(screenUV);
    this.material.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t.value += dt;
    this.mesh.position.set(camera.position.x, camera.position.y + 4, camera.position.z);
  }
}
