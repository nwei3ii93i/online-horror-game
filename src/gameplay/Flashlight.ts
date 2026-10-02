import * as THREE from 'three/webgpu';
import { LAYER_VOLUMETRIC } from '../render/PostFX';

/** Projected light pattern of a cheap reflector torch: hot centre, ring, soft spill, lens dust. */
function createCookie(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const dust: [number, number, number, number][] = [];
  for (let i = 0; i < 40; i++) dust.push([rnd(), rnd(), 0.005 + rnd() * 0.02, 0.05 + rnd() * 0.12]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2; // 0 centre, 1 edge
    const hot = Math.exp(-r * r * 22) * 0.9;
    const ring = Math.exp(-Math.pow((r - 0.32) / 0.05, 2)) * 0.25;
    const body = Math.exp(-r * r * 4.5) * 0.65;
    const spill = Math.max(0, 1 - r) * 0.12;
    let val = hot + ring + body + spill;
    // reflector imperfections: faint concentric ripples + angular streaks
    val *= 1 + Math.sin(r * 90) * 0.025 + Math.sin(Math.atan2(dy, dx) * 7 + r * 4) * 0.02 * (r < 0.6 ? 1 : 0);
    for (const [px, py, pr, s] of dust) {
      const d = Math.hypot(u - px, v - py);
      if (d < pr) val *= 1 - s * (1 - d / pr);
    }
    const o = (y * size + x) * 4;
    const k = Math.max(0, Math.min(1, val));
    img.data[o] = 255 * Math.min(1, k * 1.02);
    img.data[o + 1] = 255 * Math.min(1, k * 0.99);
    img.data[o + 2] = 255 * Math.min(1, k * 0.93);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Handheld torch. The light trails the view slightly (it is held in a hand, not glued
 * to the eye), sways with movement and casts shadows. Also lights the volumetric fog.
 */
export class Flashlight {
  readonly light: THREE.SpotLight;
  readonly fill: THREE.PointLight;
  on = true;
  battery = 1;
  intensity = 420;
  private quat = new THREE.Quaternion();
  private flicker = 0;
  private flickerTime = 0;
  private aim = new THREE.Vector3();
  private initialized = false;

  constructor(scene: THREE.Scene, shadowSize: number) {
    const l = new THREE.SpotLight(0xfff1dc, this.intensity, 45, 0.48, 0.6, 2);
    l.map = createCookie();
    l.castShadow = true;
    l.shadow.mapSize.set(shadowSize, shadowSize);
    l.shadow.camera.near = 0.15;
    l.shadow.camera.far = 38;
    l.shadow.bias = -0.0006;
    l.shadow.normalBias = 0.02;
    l.layers.enable(LAYER_VOLUMETRIC);
    this.light = l;
    scene.add(l, l.target);
    // faint bounce/spill so the near field isn't pitch black around the beam
    this.fill = new THREE.PointLight(0xffe8cc, 0.6, 6, 2);
    scene.add(this.fill);
  }

  toggle(): void { this.on = !this.on; }

  /** Brief instability (e.g. when something happens nearby). */
  stutter(duration = 0.6): void { this.flickerTime = Math.max(this.flickerTime, duration); }

  update(dt: number, camera: THREE.Camera, moving: number): void {
    // hand position: lower right of the view
    const offset = new THREE.Vector3(0.18, -0.2, -0.15).applyQuaternion(camera.quaternion);
    this.light.position.copy(camera.position).add(offset);
    // trailing rotation
    if (!this.initialized) { this.quat.copy(camera.quaternion); this.initialized = true; }
    this.quat.slerp(camera.quaternion, 1 - Math.exp(-dt * 14));
    const t = performance.now() * 0.001;
    const wobble = new THREE.Euler(Math.sin(t * 1.3) * 0.004 + Math.sin(t * 7.1) * 0.002 * moving, Math.sin(t * 0.9) * 0.005, 0);
    const q = this.quat.clone().multiply(new THREE.Quaternion().setFromEuler(wobble));
    this.aim.set(0, 0, -10).applyQuaternion(q).add(this.light.position);
    this.light.target.position.copy(this.aim);
    this.light.target.updateMatrixWorld();

    // battery drain is slow; low battery dims and occasionally flickers
    if (this.on) this.battery = Math.max(0.05, this.battery - dt / 2400);
    this.flickerTime = Math.max(0, this.flickerTime - dt);
    let k = this.on ? 1 : 0;
    if (this.battery < 0.2) k *= 0.55 + this.battery * 2.2;
    if (this.flickerTime > 0 || (this.battery < 0.15 && Math.random() < 0.01)) {
      this.flicker = Math.random() < 0.35 ? 0.05 + Math.random() * 0.3 : 1;
    } else this.flicker += (1 - this.flicker) * Math.min(1, dt * 20);
    const I = this.intensity * k * this.flicker;
    // never toggle .visible: changing the light count recompiles every material
    this.light.intensity = I;
    this.fill.position.copy(this.aim).sub(this.light.position).normalize().multiplyScalar(1.2).add(this.light.position);
    this.fill.intensity = 0.6 * k * this.flicker;
  }
}
