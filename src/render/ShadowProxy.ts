import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYER_SHADOW_PROXY } from './PostFX';

/**
 * A shadow pass only needs depth, so the plain opaque casters under `root` (one mesh per
 * material) are merged into one position-only stand-in per face side, added to `root` on a
 * layer only shadow cameras see. The sources stop casting. Alpha-tested, transparent or
 * vertex-animated casters can't be merged and are returned in `rest`, still casting.
 */
export function buildShadowProxies(root: THREE.Object3D, name: string, layer = LAYER_SHADOW_PROXY): { proxies: THREE.Mesh[]; rest: THREE.Mesh[] } {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const bySide = new Map<THREE.Side, THREE.BufferGeometry[]>();
  const rest: THREE.Mesh[] = [];
  const sources: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || m.userData.shadowProxy) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.Material & Record<string, any>)[];
    const side = mats[0].side;
    const special = mats.some((mt) => mt.transparent || mt.alphaTest > 0 || mt.alphaTestNode || mt.opacityNode || mt.positionNode || mt.side !== side);
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (special || !pos || (m as any).isInstancedMesh || (m as any).isSkinnedMesh || (m as any).isBatchedMesh) { rest.push(m); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos.clone());
    const idx = m.geometry.getIndex();
    g.setIndex(idx ? idx.clone() : [...Array(pos.count).keys()]);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!bySide.has(side)) bySide.set(side, []);
    bySide.get(side)!.push(g);
    sources.push(m);
  });
  const proxies: THREE.Mesh[] = [];
  for (const [side, geoms] of bySide) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) return { proxies: [], rest: [...rest, ...sources] };
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const proxy = new THREE.Mesh(merged, new THREE.MeshBasicNodeMaterial({ side, colorWrite: false }));
    proxy.name = `${name}:shadow`;
    proxy.userData.shadowProxy = true;
    proxy.layers.set(layer);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    root.add(proxy);
    proxy.updateMatrix();
    proxies.push(proxy);
  }
  for (const m of sources) m.castShadow = false;
  return { proxies, rest };
}
