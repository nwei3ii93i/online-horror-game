import * as THREE from 'three/webgpu';
import { installWebGPUCompat } from '../render/webgpuCompat';
import { Settings } from './Settings';
import { Input } from './Input';
import { PostFX, LAYER_VEGETATION, LAYER_INDOOR } from '../render/PostFX';

export interface System {
  /** Variable-rate update, once per rendered frame. */
  update?(dt: number, time: number): void;
  /** Fixed-rate update (physics / simulation), 60 Hz. */
  fixedUpdate?(dt: number, time: number): void;
  /** After all updates, right before rendering. */
  lateUpdate?(dt: number, time: number): void;
}

export type BackendName = 'webgpu' | 'webgl2';

/**
 * Owns the renderer, camera and frame loop. Rendering prefers WebGPU and falls back
 * to WebGL2 automatically (or on request via settings / ?webgl).
 */
export class Engine {
  renderer!: THREE.WebGPURenderer;
  backend: BackendName = 'webgpu';
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  post!: PostFX;
  private systems: System[] = [];
  private last = 0;
  private acc = 0;
  time = 0;
  frame = 0;
  paused = false;
  readonly fixedDt = 1 / 60;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  onAfterRender: (() => void) | null = null;

  constructor(readonly container: HTMLElement, readonly settings: Settings) {
    this.camera = new THREE.PerspectiveCamera(settings.values.fov, 1, 0.05, 900);
    this.camera.layers.enable(LAYER_VEGETATION);
    this.camera.layers.enable(LAYER_INDOOR);
    this.camera.position.set(0, 1.7, 10);
    this.input = new Input(container);
  }

  async init(): Promise<void> {
    installWebGPUCompat();
    const pref = this.settings.values.backend;
    const forceWebGL = pref === 'webgl' || !('gpu' in navigator);
    const renderer = new THREE.WebGPURenderer({ forceWebGL, antialias: false, powerPreference: 'high-performance' } as any);
    try {
      await renderer.init();
    } catch (e) {
      console.warn('WebGPU init failed, retrying with WebGL2', e);
      const r2 = new THREE.WebGPURenderer({ forceWebGL: true, antialias: false } as any);
      await r2.init();
      this.renderer = r2;
    }
    this.renderer ??= renderer;
    const r = this.renderer;
    this.backend = (r.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.settings.values.brightness;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.classList.add('game-canvas');
    this.container.appendChild(r.domElement);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.settings.onChange((s) => {
      r.toneMappingExposure = s.brightness;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    });
  }

  setupPost(): void {
    this.post = new PostFX(this.renderer, this.scene, this.camera, {
      quality: this.settings.profile,
      filmGrain: this.settings.values.filmGrain,
    });
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const p = this.settings.profile;
    const dpr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio) * p.renderScale * this.dynScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  add<T extends System>(s: T): T {
    this.systems.push(s);
    return s;
  }

  remove(s: System): void {
    this.systems = this.systems.filter((x) => x !== s);
  }

  start(): void {
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  /** Advance exactly one frame with a given dt (used by automation / tests). */
  step(dt: number): void {
    this.advance(dt);
    this.render();
  }

  /** Dynamic resolution: fraction of the profile's render scale currently used (0.55 … 1). */
  dynScale = 1;
  /** Off by default: resizing every target hitches, and the softer image read as blur. */
  dynamicResolution = false;
  private dynTime = -3; // ignore the first seconds (shader warm-up, streaming)
  private dynFrames = 0;
  private dynHold = 0;
  private dynCeil = 1;
  private dynCeilTimer = 0;

  /** Keep ~60 fps by trading resolution (TRAA hides most of it) before anything else. */
  private updateDynamicResolution(dt: number): void {
    if (!this.dynamicResolution) return;
    this.dynTime += dt;
    if (this.dynTime < 0) return;
    this.dynFrames++;
    if (this.dynTime < 1) return;
    const fps = this.dynFrames / this.dynTime;
    this.dynTime = 0; this.dynFrames = 0;
    if ((this.dynCeilTimer -= 1) <= 0) this.dynCeil = 1;
    let next = this.dynScale;
    if (fps < 52) {
      next = Math.max(0.55, this.dynScale - (fps < 40 ? 0.12 : 0.06));
      this.dynCeil = this.dynScale - 0.02; // this level was too much – don't retry it for a while
      this.dynCeilTimer = 20;
      this.dynHold = 4;
    } else if (fps > 57 && --this.dynHold <= 0) {
      next = Math.min(this.dynCeil, this.dynScale + 0.05);
      this.dynHold = 3;
    }
    if (Math.abs(next - this.dynScale) > 0.004) { this.dynScale = next; this.resize(); }
  }

  private tick(): void {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    this.updateDynamicResolution(dt);
    if (!this.paused) this.advance(dt);
    this.render();
  }

  private advance(dt: number): void {
    this.time += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 5) {
      for (const s of this.systems) s.fixedUpdate?.(this.fixedDt, this.time);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    for (const s of this.systems) s.update?.(dt, this.time);
    for (const s of this.systems) s.lateUpdate?.(dt, this.time);
    this.input.endFrame();
  }

  private render(): void {
    this.frame++;
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    this.onAfterRender?.();
  }
}
