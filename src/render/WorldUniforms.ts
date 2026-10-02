import * as THREE from 'three/webgpu';
import { uniform, texture, vec2, float, positionWorld, step, Fn, clamp, smoothstep } from 'three/tsl';

/**
 * Global shading inputs shared by every world material:
 *  - weather (wetness, wind) driven by the Weather system
 *  - interior map: top-down texture with (floorY, ceilingY) spans of every enclosed space,
 *    used to keep interiors dry, kill sky ambient indoors and classify audio/rain.
 *  - terrain height map: for ground-contact dirt on walls and puddles.
 */
export class WorldUniforms {
  readonly wetness: any = uniform(0);
  readonly rainIntensity: any = uniform(0);
  readonly windStrength: any = uniform(0.35);
  readonly windDir: any = uniform(new THREE.Vector2(0.8, 0.6).normalize());
  readonly windTime: any = uniform(0);
  /** Multiplier for sky / environment light reaching interiors (0 = pitch dark indoors). */
  readonly indoorAmbient: any = uniform(0.12);
  readonly lightning: any = uniform(0);

  readonly interiorOrigin: any = uniform(new THREE.Vector2(-128, -128));
  readonly interiorSize: any = uniform(new THREE.Vector2(256, 256));
  interiorTex: THREE.DataTexture;

  readonly terrainOrigin: any = uniform(new THREE.Vector2(-300, -300));
  readonly terrainSize: any = uniform(new THREE.Vector2(600, 600));
  terrainTex: THREE.DataTexture;

  /** Texture nodes are shared by all materials; swapping `.value` rebinds everywhere. */
  private interiorNode: any;
  private terrainNode: any;

  constructor() {
    // placeholders until the world is built
    this.interiorTex = WorldUniforms.halfTex(new Float32Array(4 * 4 * 2), 4, 4, 2, true);
    this.terrainTex = WorldUniforms.halfTex(new Float32Array(4 * 4), 4, 4, 1, false);
    this.interiorNode = texture(this.interiorTex);
    this.terrainNode = texture(this.terrainTex);
  }

  static halfTex(data: Float32Array, w: number, h: number, channels: 1 | 2, nearest: boolean): THREE.DataTexture {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, w, h, channels === 1 ? THREE.RedFormat : THREE.RGFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  setInterior(data: Float32Array, w: number, h: number, origin: THREE.Vector2, size: THREE.Vector2): void {
    this.interiorTex = WorldUniforms.halfTex(data, w, h, 2, true);
    this.interiorNode.value = this.interiorTex;
    this.interiorOrigin.value.copy(origin);
    this.interiorSize.value.copy(size);
  }

  setTerrain(data: Float32Array, w: number, h: number, origin: THREE.Vector2, size: THREE.Vector2): void {
    this.terrainTex = WorldUniforms.halfTex(data, w, h, 1, false);
    this.terrainNode.value = this.terrainTex;
    this.terrainOrigin.value.copy(origin);
    this.terrainSize.value.copy(size);
  }

  /** 1 inside an enclosed interior span, 0 outside. */
  indoor = Fn(([pw]: [any]) => {
    const iuv = pw.xz.sub(this.interiorOrigin).div(this.interiorSize);
    const span = this.interiorNode.sample(iuv);
    const inside = step(span.x, pw.y.add(0.05)).mul(step(pw.y, span.y));
    const inB = step(0.0, iuv.x).mul(step(iuv.x, 1.0)).mul(step(0.0, iuv.y)).mul(step(iuv.y, 1.0));
    return inside.mul(inB);
  });

  terrainHeight = Fn(([xz]: [any]) => {
    const tuv = xz.sub(this.terrainOrigin).div(this.terrainSize);
    return this.terrainNode.sample(tuv).x;
  });

  /** Ground-contact factor: 1 at terrain level fading to 0 at `height` metres above. */
  groundContact(height = 0.6) {
    const pw = positionWorld;
    const h = pw.y.sub(this.terrainHeight(pw.xz));
    return float(1).sub(smoothstep(0.0, height, h)).mul(step(-0.3, h));
  }

  indoorAt() {
    return clamp(this.indoor(positionWorld), 0, 1);
  }
}

export const worldUniforms = new WorldUniforms();
export { vec2 };
