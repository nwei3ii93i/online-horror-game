import * as THREE from 'three/webgpu';
import {
  uniform, vec2, vec3, vec4, float, Fn, mix, smoothstep, positionWorld, cameraPosition, normalize, dot, max, exp, abs,
  length, clamp, pow, mx_fractal_noise_float, mx_noise_float, time, fog, positionLocal, select, step, sin, fract,
} from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { worldUniforms } from './WorldUniforms';
import type { QualityProfile } from '../core/Settings';
import { LAYER_VOLUMETRIC } from './PostFX';

/**
 * Night sky, moon, ambient light and height fog. Everything is tuned to read as a
 * cloudy late-autumn night in Central Europe: weak moonlight diffused through
 * stratocumulus, cold blue-grey ambience, dense ground-hugging fog.
 */
export class Atmosphere {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  readonly moonDir = new THREE.Vector3(-0.6, 0.52, 0.6).normalize(); // south-west: rakes the entrance façade
  readonly moonDirU: any = uniform(new THREE.Vector3());
  readonly fogDensity: any = uniform(0.024);
  readonly fogHeightFalloff: any = uniform(0.09);
  readonly fogBaseHeight: any = uniform(2);
  readonly fogColor: any = uniform(new THREE.Color(0x232a33));
  readonly moonGlowColor: any = uniform(new THREE.Color(0x5d6a7c));
  readonly cloudCover: any = uniform(0.78);
  readonly skyBrightness: any = uniform(1);
  readonly moonIntensity = 0.95;
  csm: CSMShadowNode | null = null;
  private cloudTime: any = uniform(0);

  constructor(private scene: THREE.Scene, quality: QualityProfile) {
    this.moonDirU.value.copy(this.moonDir);

    // Moonlight through thin cloud: desaturated cold light.
    this.moon = new THREE.DirectionalLight(0xa3adc2, this.moonIntensity);
    this.moon.position.copy(this.moonDir).multiplyScalar(150);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 400;
    // the moon is NOT on the volumetric layer: near-field volumetrics are for the torch only (big perf win)
    scene.add(this.moon, this.moon.target);

    // Sky / ground ambient
    this.hemi = new THREE.HemisphereLight(0x3a4458, 0x14110d, 0.34);
    scene.add(this.hemi);

    this.sky = this.createSky();
    scene.add(this.sky);
    this.setupFog();
  }

  enableCSM(camera: THREE.PerspectiveCamera, quality: QualityProfile): void {
    const csm = new CSMShadowNode(this.moon, { cascades: quality.shadowCascades, maxFar: quality.shadowFar, mode: 'practical', lightMargin: 60 });
    csm.fade = true;
    this.moon.shadow.shadowNode = csm;
    this.csm = csm;
    void camera;
  }

  private createSky(): THREE.Mesh {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    mat.fog = false;
    const dir = normalize(positionLocal);
    const moonDir = this.moonDirU;
    const sky = Fn(() => {
      const up = clamp(dir.y, -0.2, 1);
      // horizon = exactly the fog colour for this direction, so fully fogged objects melt into the sky
      const horizon = this.horizonColorFor(dir);
      const zenith = vec3(0.012, 0.016, 0.026);
      const col = mix(horizon, zenith, smoothstep(-0.02, 0.55, up)).toVar();
      // clouds: domain-warped fractal noise on a plane
      const t = this.cloudTime;
      const cp = dir.xz.div(max(dir.y, 0.06)).mul(0.55);
      const warp = mx_noise_float(vec3(cp.mul(0.7), t.mul(0.01))).mul(0.6);
      const n = mx_fractal_noise_float(vec3(cp.add(vec2(t.mul(0.012), t.mul(0.004))).add(warp), t.mul(0.004)), 5, 2.0, 0.55, 1.0);
      const cloud = smoothstep(float(0.62).sub(this.cloudCover), float(1.1).sub(this.cloudCover.mul(0.6)), n.mul(0.5).add(0.5));
      // moon: disc + wide forward-scattering glow, attenuated by clouds
      const md = max(dot(dir, moonDir), 0);
      const disc = smoothstep(0.99955, 0.99975, md);
      const halo = pow(md, 60).mul(0.35).add(pow(md, 8).mul(0.12)).add(pow(md, 2).mul(0.03));
      const cloudLit = vec3(this.moonGlowColor).mul(pow(md, 4).mul(0.9).add(0.12));
      // stars (only through gaps, very faint)
      const sp = dir.mul(420);
      const star = step(0.985, fract(sin(dot(sp.floor(), vec3(12.99, 78.23, 37.71))).mul(43758.55))).mul(smoothstep(0.1, 0.5, up)).mul(0.35);
      const clear = float(1).sub(cloud);
      col.addAssign(vec3(0.85, 0.88, 0.95).mul(disc).mul(clear.mul(0.9).add(0.1)).mul(2.5));
      col.addAssign(vec3(this.moonGlowColor).mul(halo).mul(clear.mul(0.6).add(0.4)));
      col.addAssign(vec3(star).mul(clear));
      // cloud body: dark grey with moon-lit edges, darker underside toward zenith
      const cloudCol = mix(vec3(this.fogColor).mul(0.75), cloudLit, smoothstep(0.2, 1.0, n.mul(0.5).add(0.5)).mul(0.6));
      col.assign(mix(col, cloudCol, cloud.mul(smoothstep(-0.03, 0.12, up))));
      // lightning illuminates the cloud deck
      col.addAssign(vec3(0.5, 0.55, 0.65).mul(worldUniforms.lightning).mul(cloud.add(0.2)).mul(smoothstep(-0.05, 0.3, up)));
      // horizon blend into fog (no visible horizon line in fog)
      col.assign(mix(col, horizon, smoothstep(0.12, -0.02, up)));
      return col.mul(this.skyBrightness);
    });
    mat.colorNode = sky();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.name = 'sky';
    return mesh;
  }

  /**
   * Colour of fully fogged geometry along a view direction: follows the sky gradient so
   * distant tree crowns above the horizon don't glow brighter than the sky behind them.
   */
  fogColorFor(v: any): any {
    // the sky's *average* colour along v: gradient + the cloud deck (cloud noise averaged out by
    // the coverage). If fog were brighter than the cloudy sky, fogged crowns would glow as pale
    // ghosts above dark trunk "posts" – fog and sky must agree at every elevation.
    const up = clamp(v.y, -0.2, 1);
    const horizon = this.horizonColorFor(v);
    let c: any = mix(horizon, vec3(0.012, 0.016, 0.026), smoothstep(-0.02, 0.55, up));
    const md = max(dot(v, this.moonDirU), 0);
    const cloudLit = vec3(this.moonGlowColor).mul(pow(md, 4).mul(0.9).add(0.12));
    const cloudCol = mix(vec3(this.fogColor).mul(0.75), cloudLit, 0.25);
    c = mix(c, cloudCol, this.cloudCover.mul(0.8).mul(smoothstep(-0.03, 0.12, up)));
    return mix(c, horizon, smoothstep(0.12, -0.02, up));
  }

  /** In-scattered colour at the horizon along a view direction (moon glow, lightning). */
  horizonColorFor(v: any): any {
    const md = max(dot(v, this.moonDirU), 0);
    const glow = pow(md, 6).mul(0.45).add(pow(md, 2).mul(0.1));
    const c = mix(vec3(this.fogColor), vec3(this.moonGlowColor), glow);
    return c.add(vec3(0.3, 0.33, 0.4).mul(worldUniforms.lightning).mul(0.25));
  }

  private setupFog(): void {
    const W = worldUniforms;
    const fogFactor = Fn(() => {
      const pw = positionWorld;
      const cp = cameraPosition;
      const d = length(pw.sub(cp));
      // analytic integral of exponential height density along the view ray
      const k = this.fogHeightFalloff;
      const hc = cp.y.sub(this.fogBaseHeight);
      const hp = pw.y.sub(this.fogBaseHeight);
      const dy = hp.sub(hc);
      const ec = exp(k.mul(hc).negate());
      const ep = exp(k.mul(hp).negate());
      const integ = select(abs(dy).greaterThan(0.01), ec.sub(ep).div(k.mul(dy)), ec);
      const dens = this.fogDensity.mul(clamp(integ, 0.15, 6.0));
      let f = float(1).sub(exp(dens.mul(d).negate()));
      // interiors keep only a little dusty haze
      f = f.mul(mix(float(1), float(0.25), W.indoorAt()));
      return clamp(f, 0, 1);
    });
    const fogCol = Fn(() => this.fogColorFor(normalize(positionWorld.sub(cameraPosition))));
    this.scene.fogNode = fog(fogCol(), fogFactor());
  }

  update(dt: number, camera: THREE.Camera): void {
    this.cloudTime.value += dt;
    // keep the shadow frustum centred on the player
    this.moon.target.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(this.moonDir, 150);
    this.sky.position.copy(camera.position);
    void time;
  }
}

export { vec4 };
