import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, screenUV, uniform, vec2, vec3, vec4, float, Fn, mix, smoothstep,
  packNormalToRGB, unpackRGBToNormal, sample, renderOutput, length, time, fract, sin, dot, clamp, max, pow,
  luminance, screenCoordinate, interleavedGradientNoise,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { QualityProfile } from '../core/Settings';

export const LAYER_VOLUMETRIC = 10;

export interface PostFXOptions {
  quality: QualityProfile;
  filmGrain: boolean;
}

/**
 * Cinematic post chain:
 *   scene (MRT colour/normal/velocity) → GTAO (multiplied, soft) → + volumetric fog pass
 *   → TRAA → bloom → tone map (AgX) → grade, vignette, grain, subtle chromatic fringe.
 */
export class PostFX {
  readonly pipeline: THREE.RenderPipeline;
  readonly aoStrength: any = uniform(0.85);
  readonly volumetricIntensity: any = uniform(1);
  readonly grainAmount: any = uniform(0.045);
  readonly vignette: any = uniform(0.42);
  /** 0..1 red-shift/desaturation used by gameplay for stress, flashes etc. */
  readonly stress: any = uniform(0);
  readonly fade: any = uniform(1);
  readonly exposureBoost: any = uniform(1);
  private scenePass: any;
  private aoPass: any = null;
  volumetricPass: any = null;

  constructor(private renderer: THREE.WebGPURenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, opts: PostFXOptions) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.build(opts);
  }

  build(opts: PostFXOptions): void {
    const q = opts.quality;
    if (this.aoPass) { this.aoPass.dispose?.(); this.aoPass = null; }
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
    const normTex = scenePass.getTexture('normal');
    normTex.type = THREE.UnsignedByteType;
    this.scenePass = scenePass;
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const vel = scenePass.getTextureNode('velocity');
    const normal = sample((uv: any) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uv)));

    let lit: any = color;
    if (q.ao) {
      const aoPass = ao(depth, normal, this.camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      aoPass.thickness.value = 1.2;
      aoPass.scale.value = 1.1;
      aoPass.samples.value = q.renderScale >= 1 ? 16 : 10;
      aoPass.useTemporalFiltering = q.temporalAA;
      this.aoPass = aoPass;
      const aoVal = aoPass.getTextureNode().sample(screenUV).r;
      lit = vec4(color.rgb.mul(mix(float(1), aoVal, this.aoStrength)), color.a);
    }

    if (q.volumetrics) {
      const layers = new THREE.Layers();
      layers.disableAll();
      layers.enable(LAYER_VOLUMETRIC);
      const vp = pass(this.scene, this.camera, { depthBuffer: false });
      vp.setLayers(layers);
      vp.setResolutionScale(q.volumetricScale);
      this.volumetricPass = vp;
      (this as any).sceneDepthNode = depth;
      const blurred = gaussianBlur(vp, uniform(0.65), 3);
      lit = vec4(lit.rgb.add(blurred.rgb.mul(this.volumetricIntensity)), 1);
    }

    let aa: any = lit;
    if (q.temporalAA) {
      const t = traa(lit, depth, vel, this.camera);
      t.useSubpixelCorrection = false;
      aa = t;
    }

    let hdr: any = aa;
    if (q.bloom) {
      const b = bloom(aa, 0.22, 0.55, 0.9);
      hdr = vec4(aa.rgb.add(b.rgb), 1);
    }

    hdr = vec4(hdr.rgb.mul(this.exposureBoost), 1);
    const mapped = renderOutput(hdr);
    let final: any = this.grade(mapped, opts.filmGrain);
    if (!q.temporalAA) final = fxaa(final);
    this.pipeline.outputNode = final;
    this.pipeline.needsUpdate = true;
  }

  /** Scene depth texture node (for volumetric material occlusion). */
  get depthNode(): any { return (this as any).sceneDepthNode; }

  private grade(input: any, grain: boolean): any {
    const stress = this.stress;
    return Fn(() => {
      const c = vec3(input.rgb).toVar();
      // gentle split tone: cool shadows, neutral-warm highlights (kept very subtle)
      const l = luminance(c);
      const shadowTint = vec3(0.94, 0.98, 1.06);
      const highTint = vec3(1.03, 1.0, 0.96);
      c.assign(c.mul(mix(shadowTint, highTint, smoothstep(0.05, 0.6, l))));
      // slight desaturation – "photographed", not graded
      c.assign(mix(vec3(l), c, float(0.88).sub(stress.mul(0.5))));
      // vignette (optical falloff)
      const d = length(screenUV.sub(0.5).mul(vec2(1.0, 0.82)));
      const vig = smoothstep(0.85, 0.2, d).mul(this.vignette).add(float(1).sub(this.vignette));
      c.assign(c.mul(vig));
      // film grain: luminance-weighted, stronger in mid/dark tones like real stock
      if (grain) {
        const g = fract(sin(dot(screenUV.add(fract(time.mul(13.37))), vec2(12.9898, 78.233))).mul(43758.5453));
        const gw = float(1).sub(smoothstep(0.0, 0.8, l)).mul(0.7).add(0.3);
        c.assign(c.add(g.sub(0.5).mul(this.grainAmount).mul(gw)));
      }
      // dithering against banding in dark gradients
      const dither = interleavedGradientNoise(screenCoordinate).sub(0.5).div(255);
      c.assign(c.add(dither));
      c.assign(c.mul(this.fade));
      return vec4(clamp(c, 0, 1), 1);
    })();
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}

export { max, pow };
