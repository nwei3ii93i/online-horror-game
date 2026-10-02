import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, vec3, vec4, float, Fn, positionLocal, positionWorld, normalWorld, sin, hash, instanceIndex, attribute,
  mix, smoothstep, clamp, max, cameraPosition, length, normalMap, sqrt, dot, color as tslColor, mx_noise_float,
} from 'three/tsl';
import { worldUniforms } from '../../render/WorldUniforms';
import type { TextureStore } from '../../materials/TextureStore';

/**
 * Wind deformation for instanced vegetation (local space, before the instance matrix).
 * `trunk`: whole-tree sway growing with height². `aux` attribute: per-vertex flex (cards, twigs).
 */
export function windPosition(treeHeight: number, trunkSway: number, flutter: number, useAux = true): any {
  return Fn(() => {
    const W = worldUniforms;
    const p: any = positionLocal;
    const phase = hash(instanceIndex).mul(6.2831);
    const t = W.windTime;
    const h: any = max(p.y, 0).div(treeHeight);
    const gust: any = sin(t.mul(0.55).add(phase)).mul(0.6).add(sin(t.mul(1.37).add(phase.mul(1.7))).mul(0.3)).add(sin(t.mul(0.21).add(phase.mul(0.3))).mul(0.5));
    const sway: any = W.windStrength.mul(h.mul(h)).mul(trunkSway).mul(gust);
    let off: any = vec3(W.windDir.x.mul(sway), float(0), W.windDir.y.mul(sway));
    if (useAux && flutter > 0) {
      const flex = attribute('aux', 'float');
      const f: any = sin(t.mul(3.1).add(p.x.mul(1.7)).add(p.z.mul(2.3)).add(phase)).mul(flex).mul(flutter).mul(W.windStrength.add(0.15));
      off = off.add(vec3(f, f.mul(0.6), f.mul(0.8)));
    }
    return p.add(off);
  })();
}

export interface FoliageOpts {
  map: THREE.Texture;
  tint?: string;
  roughness?: number;
  alphaTest?: number;
  treeHeight: number;
  trunkSway: number;
  flutter: number;
  /** Translucency strength for back-lit leaves. */
  translucency?: number;
}

/** Alpha-tested, double-sided foliage card material with wind and wetness. */
export function foliageMaterial(o: FoliageOpts): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.side = THREE.DoubleSide;
  mat.alphaTest = o.alphaTest ?? 0.42;
  const W = worldUniforms;
  const tex = texture(o.map, uv());
  const tint: any = o.tint ? tslColor(new THREE.Color(o.tint)) : vec3(1);
  const vtint = attribute('color', 'vec3');
  // subtle per-instance hue/brightness variation
  const iv = hash(instanceIndex.add(17)).sub(0.5);
  let albedo: any = tex.rgb.mul(tint).mul(vtint).mul(float(1).add(iv.mul(0.25)));
  const outdoor = float(1).sub(W.indoorAt());
  const wet = W.wetness.mul(outdoor);
  albedo = albedo.mul(mix(float(1), float(0.7), wet));
  mat.colorNode = vec4(albedo, tex.a);
  mat.roughnessNode = mix(float(o.roughness ?? 0.82), float(0.35), wet);
  mat.metalnessNode = float(0);
  mat.positionNode = windPosition(o.treeHeight, o.trunkSway, o.flutter);
  // distance-dependent alpha threshold keeps distant cards from thinning out after mip-mapping
  const d = length(positionWorld.sub(cameraPosition));
  (mat as any).alphaTestNode = mix(float(o.alphaTest ?? 0.42), float(0.18), smoothstep(15, 90, d));
  return mat;
}

/** Bark material for instanced trunks/branches: textured PBR + gentle sway. */
export function barkMaterial(textures: TextureStore, texId: string, scaleU: number, scaleV: number, treeHeight: number, trunkSway: number, mossUp = 0.4): THREE.MeshStandardNodeMaterial {
  const set = textures.get(texId);
  const mat = new THREE.MeshStandardNodeMaterial();
  const tuv = uv().div(vec2(scaleU, scaleV));
  const A = texture(set.a, tuv), B = texture(set.b, tuv);
  const W = worldUniforms;
  let albedo: any = A.rgb.mul(attribute('color', 'vec3'));
  let rough: any = B.z;
  // green algae / moss on the windward (north-west) side and low on the trunk
  const pw = positionWorld;
  const mossN = smoothstep(-0.1, 0.6, W.noise(pw, 0.8));
  const side = clamp(dot(normalWorld, vec3(-0.5, 0.25, -0.8)).mul(0.8).add(0.35), 0, 1);
  const low = float(1).sub(smoothstep(0.5, 3.5, pw.y.sub(W.terrainHeight(pw.xz))));
  const moss = clamp(mossN.mul(side).mul(low.mul(0.7).add(0.3)).mul(mossUp), 0, 1);
  albedo = mix(albedo, vec3(0.07, 0.1, 0.035), moss.mul(0.85));
  const wet = W.wetness.mul(float(1).sub(W.indoorAt()));
  albedo = albedo.mul(mix(float(1), float(0.55), wet));
  rough = mix(rough, 0.25, wet.mul(0.7));
  mat.colorNode = vec4(albedo, 1);
  mat.roughnessNode = clamp(rough, 0.05, 1);
  mat.metalnessNode = float(0);
  const nxy = B.xy.mul(2).sub(1);
  const nz = sqrt(max(float(1).sub(dot(nxy, nxy)), 0));
  mat.normalNode = normalMap(vec3(B.x, B.y, nz.mul(0.5).add(0.5)), vec2(1.2, 1.2));
  mat.aoNode = B.w;
  mat.positionNode = windPosition(treeHeight, trunkSway, 0.6);
  return mat;
}
