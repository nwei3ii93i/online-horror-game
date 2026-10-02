/**
 * three.js visualisation of the other players.
 *
 *  - Silhouette avatar from primitives (dark jacket, trousers, head with a cap in the
 *    player's colour, arms, legs, shoes, hand-held torch), procedurally animated:
 *    walk cycle driven by the replicated velocity, blended stand / crouch / prone-crawl
 *    poses, head follows the view pitch, the torch arm aims where the player looks.
 *  - Subtle name label (sprite), only within `labelDistance` (12 m), occluded by walls.
 *  - Flashlights from a FIXED pool of SpotLights allocated at construction. three.js node
 *    lighting recompiles every material when the number of lights changes, so lights are
 *    never added, removed or hidden after construction – unused ones sit at intensity 0
 *    and the pool is re-assigned to the nearest remote players with their light on.
 *
 * Usage: `const rp = new RemotePlayers(scene)` once at load (before the first render),
 * then `rp.update(dt, session, session.renderTime(), player.position)` every frame.
 */

import * as THREE from 'three/webgpu';
import type { Session } from './Session';
import type { PlayerInfo } from './protocol';
import { createRemoteSample, type RemoteSample } from './Interpolation';

export interface RemoteFlashlightParams {
  color: number;
  intensity: number;
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
}

export interface RemotePlayersOptions {
  /** Size of the fixed SpotLight pool (default 5). Use 0 to render no remote torches. */
  lights?: number;
  /** If set, the pool lights are also enabled on this layer (e.g. LAYER_VOLUMETRIC for fog beams). */
  volumetricLayer?: number;
  /** Name labels are shown within this distance (m). Default 12. */
  labelDistance?: number;
  /** Avatars cast shadows from the local flashlight / moon. Default true. */
  castShadows?: boolean;
  flashlight?: Partial<RemoteFlashlightParams>;
}

const DEFAULT_FLASHLIGHT: RemoteFlashlightParams = { color: 0xfff1dc, intensity: 420, distance: 45, angle: 0.48, penumbra: 0.6, decay: 2 };

// ---------------------------------------------------------------------------------------
// Pose tables. Angles are rotations about the body's X axis in the avatar's yaw frame:
// for hanging limbs (arms, legs) positive = swing forward; for upward parts (spine, neck)
// negative = lean forward. `elbow` / `knee` are relative bends.
// ---------------------------------------------------------------------------------------

interface Pose {
  hipY: number; lean: number; neck: number; hip: number; knee: number; foot: number;
  arm: number; elbow: number; swingLeg: number; swingArm: number; kneeFlex: number; bob: number; twist: number;
  /** Speed (m/s) at which the gait reaches full amplitude. */
  refSpeed: number; stride: number;
}

const STAND: Pose = {
  hipY: 0.96, lean: -0.04, neck: -0.06, hip: 0.02, knee: -0.06, foot: 0, arm: 0.06, elbow: 0.2,
  swingLeg: 0.5, swingArm: 0.4, kneeFlex: 0.9, bob: 0.025, twist: 0.12, refSpeed: 2.2, stride: 0.75,
};
const CROUCH: Pose = {
  hipY: 0.5, lean: -0.5, neck: -0.25, hip: 1.3, knee: -2.15, foot: 0, arm: 0.55, elbow: 0.7,
  swingLeg: 0.28, swingArm: 0.22, kneeFlex: 0.35, bob: 0.015, twist: 0.08, refSpeed: 1.0, stride: 0.45,
};
/** Prone (commando) crawl – fits the 0.62 m crawl capsule of the PlayerController. */
const CRAWL: Pose = {
  hipY: 0.2, lean: -1.5, neck: -1.15, hip: -1.45, knee: -0.15, foot: -1.25, arm: 0.9, elbow: 0.67,
  swingLeg: 0.18, swingArm: 0.3, kneeFlex: 0.7, bob: 0.01, twist: 0.15, refSpeed: 0.5, stride: 0.3,
};
const POSE_KEYS = Object.keys(STAND) as (keyof Pose)[];

const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------
// Shared geometry / materials
// ---------------------------------------------------------------------------------------

/** Capsule hanging from its pivot (y = 0) down to y = −len, ends overlapping the joints. */
function limb(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2, 0);
  return g;
}

class AvatarKit {
  readonly geo = {
    torso: new THREE.CapsuleGeometry(0.165, 0.34, 4, 12),
    pelvis: new THREE.SphereGeometry(0.16, 12, 8),
    neck: new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8),
    head: new THREE.SphereGeometry(0.105, 16, 12),
    cap: new THREE.SphereGeometry(0.113, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    brim: new THREE.BoxGeometry(0.15, 0.012, 0.075),
    upperArm: limb(0.052, 0.28),
    forearm: limb(0.044, 0.25),
    hand: new THREE.SphereGeometry(0.045, 8, 6),
    thigh: limb(0.072, 0.44),
    shin: limb(0.056, 0.44),
    shoe: new THREE.BoxGeometry(0.105, 0.075, 0.26).translate(0, -0.02, -0.06),
    torch: new THREE.CylinderGeometry(0.02, 0.026, 0.2, 10),
    lens: new THREE.CircleGeometry(0.023, 12).rotateX(Math.PI / 2),
  };
  readonly mat = {
    jacket: new THREE.MeshStandardNodeMaterial({ color: 0x24282a, roughness: 0.86, metalness: 0 }),
    trousers: new THREE.MeshStandardNodeMaterial({ color: 0x2b2f36, roughness: 0.92, metalness: 0 }),
    skin: new THREE.MeshStandardNodeMaterial({ color: 0xa88068, roughness: 0.62, metalness: 0 }),
    shoes: new THREE.MeshStandardNodeMaterial({ color: 0x151413, roughness: 0.6, metalness: 0 }),
    torch: new THREE.MeshStandardNodeMaterial({ color: 0x2e2e2e, roughness: 0.4, metalness: 0.6 }),
  };

  dispose(): void {
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of Object.values(this.mat)) m.dispose();
  }
}

// ---------------------------------------------------------------------------------------
// One avatar
// ---------------------------------------------------------------------------------------

class Avatar {
  readonly root = new THREE.Group();
  readonly sample: RemoteSample = createRemoteSample();
  /** Smoothed 0..1 flashlight state (drives arm pose, lens glow and beam intensity). */
  lightW = 0;
  hasPose = false;
  /** World position of the torch lens and aim direction (valid after `pose`). */
  readonly lensWorld = new THREE.Vector3();
  readonly aim = new THREE.Vector3(0, 0, -1);
  readonly headWorld = new THREE.Vector3();
  readonly label: THREE.Sprite;
  private labelMat: THREE.SpriteNodeMaterial;
  private labelTex: THREE.CanvasTexture;
  private capMat: THREE.MeshStandardNodeMaterial;
  private lensMat: THREE.MeshStandardNodeMaterial;
  private name = '';
  private color = '';

  private pelvis = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private ankleL = new THREE.Group();
  private ankleR = new THREE.Group();
  private lens = new THREE.Object3D();

  private w = { stand: 1, crouch: 0, crawl: 0 };
  private phase = 0;
  private amp = 0;
  private pose: Pose = { ...STAND };

  constructor(kit: AvatarKit, readonly id: string, info: PlayerInfo, castShadows: boolean) {
    const { geo, mat } = kit;
    this.capMat = new THREE.MeshStandardNodeMaterial({ color: 0x444444, roughness: 0.95, metalness: 0 });
    this.lensMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1a, roughness: 0.2, metalness: 0, emissive: 0xfff1dc, emissiveIntensity: 0 });
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = castShadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // hierarchy
    this.root.name = `remote-player-${id}`;
    this.root.add(this.pelvis);
    add(this.pelvis, geo.pelvis, mat.trousers).scale.set(1, 0.6, 0.75);
    this.pelvis.add(this.spine);
    add(this.spine, geo.torso, mat.jacket, 0, 0.27, 0).scale.set(1.05, 1, 0.66);
    this.chest.position.y = 0.5;
    this.spine.add(this.chest);
    this.neck.position.y = 0.03;
    this.chest.add(this.neck);
    add(this.neck, geo.neck, mat.skin, 0, 0.05, 0);
    this.head.position.y = 0.1;
    this.neck.add(this.head);
    add(this.head, geo.head, mat.skin, 0, 0.07, 0).scale.set(1, 1.12, 1);
    add(this.head, geo.cap, this.capMat, 0, 0.1, 0);
    add(this.head, geo.brim, this.capMat, 0, 0.1, -0.1);

    for (const [shoulder, elbow, side] of [[this.shoulderL, this.elbowL, -1], [this.shoulderR, this.elbowR, 1]] as const) {
      shoulder.position.set(0.2 * side, -0.02, 0);
      this.chest.add(shoulder);
      add(shoulder, geo.upperArm, mat.jacket);
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      add(elbow, geo.forearm, mat.jacket);
      add(elbow, geo.hand, mat.skin, 0, -0.29, 0).scale.set(0.9, 1.25, 0.7);
    }
    // torch in the right hand, lens towards −Y of the forearm frame
    add(this.elbowR, geo.torch, mat.torch, 0, -0.34, -0.02);
    const lensMesh = add(this.elbowR, geo.lens, this.lensMat, 0, -0.441, -0.02);
    lensMesh.castShadow = false;
    this.lens.position.set(0, -0.46, -0.02);
    this.elbowR.add(this.lens);

    for (const [hip, knee, ankle, side] of [[this.hipL, this.kneeL, this.ankleL, -1], [this.hipR, this.kneeR, this.ankleR, 1]] as const) {
      hip.position.set(0.095 * side, -0.03, 0);
      this.pelvis.add(hip);
      add(hip, geo.thigh, mat.trousers);
      knee.position.y = -0.44;
      hip.add(knee);
      add(knee, geo.shin, mat.trousers);
      ankle.position.y = -0.44;
      knee.add(ankle);
      add(ankle, geo.shoe, mat.shoes);
    }

    // label
    this.labelTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelMat = new THREE.SpriteNodeMaterial({ map: this.labelTex, transparent: true, depthWrite: false, opacity: 0 });
    this.label = new THREE.Sprite(this.labelMat);
    this.label.scale.set(0.84, 0.21, 1);
    this.label.renderOrder = 10;
    this.label.visible = false;
    this.setInfo(info);
    this.root.visible = false;
  }

  /** Updates name label and cap colour when the player info changes. */
  setInfo(info: PlayerInfo): void {
    if (info.name === this.name && info.color === this.color) return;
    this.name = info.name;
    this.color = info.color;
    this.capMat.color.set(info.color).multiplyScalar(0.55);
    const canvas = this.labelTex.image as HTMLCanvasElement;
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 512, 128);
      g.font = '500 46px "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const w = Math.min(440, g.measureText(info.name).width);
      g.shadowColor = 'rgba(0,0,0,0.9)';
      g.shadowBlur = 12;
      g.fillStyle = 'rgba(228,222,210,0.95)';
      g.fillText(info.name, 256 + 14, 64, 440);
      g.fillStyle = info.color;
      g.beginPath();
      g.arc(256 + 14 - w / 2 - 22, 64, 9, 0, Math.PI * 2);
      g.fill();
    }
    this.labelTex.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    if (!v) this.label.visible = false;
  }

  /** Applies an interpolated network sample: position, procedural gait and stance pose. */
  update(dt: number, s: RemoteSample): void {
    const root = this.root;
    // a big jump (teleport / first pose) resets the smoothing
    const jumped = !this.hasPose || Math.hypot(root.position.x - s.p[0], root.position.z - s.p[2]) > 2.5;
    root.position.set(s.p[0], s.p[1], s.p[2]);
    root.rotation.y = s.yaw;

    // stance blend weights (sum stays 1)
    const kS = jumped ? 1 : damp(7, dt);
    const w = this.w;
    w.stand += ((s.stance === 'stand' ? 1 : 0) - w.stand) * kS;
    w.crouch += ((s.stance === 'crouch' ? 1 : 0) - w.crouch) * kS;
    w.crawl += ((s.stance === 'crawl' ? 1 : 0) - w.crawl) * kS;
    const P = this.pose;
    for (const k of POSE_KEYS) P[k] = STAND[k] * w.stand + CROUCH[k] * w.crouch + CRAWL[k] * w.crawl;
    this.lightW += ((s.light ? 1 : 0) - this.lightW) * (jumped ? 1 : damp(6, dt));
    this.hasPose = true;

    // gait from horizontal speed
    const speed = Math.hypot(s.vel[0], s.vel[2]);
    const ampTarget = speed < 0.12 ? 0 : Math.min(1, speed / P.refSpeed);
    this.amp += (ampTarget - this.amp) * (jumped ? 1 : damp(8, dt));
    this.phase = (this.phase + (speed * dt * Math.PI) / P.stride) % (Math.PI * 2);
    const A = this.amp;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);

    this.pelvis.position.y = P.hipY + P.bob * A * (Math.abs(cw) * 2 - 1);
    this.spine.rotation.set(P.lean, P.twist * A * sw, 0);
    this.neck.rotation.x = P.neck - P.lean;
    const headW = clamp(s.pitch, -1.0, 1.0) * 0.8;
    this.head.rotation.x = headW - P.neck;

    // legs (pelvis frame = yaw frame, so local = world angles)
    this.hipL.rotation.x = P.hip + P.swingLeg * A * sw;
    this.hipR.rotation.x = P.hip - P.swingLeg * A * sw;
    this.kneeL.rotation.x = P.knee - P.kneeFlex * A * Math.max(0, cw);
    this.kneeR.rotation.x = P.knee - P.kneeFlex * A * Math.max(0, -cw);
    this.ankleL.rotation.x = P.foot - this.hipL.rotation.x - this.kneeL.rotation.x;
    this.ankleR.rotation.x = P.foot - this.hipR.rotation.x - this.kneeR.rotation.x;

    // arms: world angle minus the spine lean = local angle
    this.shoulderL.rotation.x = P.arm - P.swingArm * A * sw - P.lean;
    this.elbowL.rotation.x = P.elbow;
    // right arm: free swing, or aiming the torch where the player looks
    const aimUpper = 1.15 + clamp(s.pitch, -1.1, 1.1) * 0.85;
    const L = this.lightW;
    const freeUpper = P.arm + P.swingArm * A * sw;
    this.shoulderR.rotation.x = freeUpper + (aimUpper - freeUpper) * L - P.lean;
    this.shoulderR.rotation.z = 0.12 * L; // bring the torch slightly towards the body centre
    this.elbowR.rotation.x = P.elbow + (0.4 - P.elbow) * L;

    this.lensMat.emissiveIntensity = 6 * L;

    root.updateMatrixWorld(true);
    this.lens.getWorldPosition(this.lensWorld);
    this.head.getWorldPosition(this.headWorld);
    const cp = Math.cos(s.pitch);
    this.aim.set(-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
  }

  updateLabel(cameraDist: number, maxDist: number): void {
    const vis = this.root.visible && cameraDist < maxDist;
    this.label.visible = vis;
    if (!vis) return;
    this.label.position.copy(this.headWorld);
    this.label.position.y += 0.36;
    this.labelMat.opacity = 0.6 * smoothstep(maxDist, maxDist - 3, cameraDist);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.label.removeFromParent();
    this.capMat.dispose();
    this.lensMat.dispose();
    this.labelMat.dispose();
    this.labelTex.dispose();
  }
}

// ---------------------------------------------------------------------------------------
// Light pool + manager
// ---------------------------------------------------------------------------------------

interface PooledLight {
  light: THREE.SpotLight;
  owner: string | null;
  intensity: number;
}

export class RemotePlayers {
  private kit = new AvatarKit();
  private avatars = new Map<string, Avatar>();
  private pool: PooledLight[] = [];
  private readonly labelDistance: number;
  private readonly castShadows: boolean;
  private readonly flash: RemoteFlashlightParams;
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, opts: RemotePlayersOptions = {}) {
    this.labelDistance = opts.labelDistance ?? 12;
    this.castShadows = opts.castShadows ?? true;
    this.flash = { ...DEFAULT_FLASHLIGHT, ...opts.flashlight };
    const n = Math.max(0, Math.floor(opts.lights ?? 5));
    for (let i = 0; i < n; i++) {
      const f = this.flash;
      const light = new THREE.SpotLight(f.color, 0, f.distance, f.angle, f.penumbra, f.decay);
      light.castShadow = false;
      light.name = `remote-flashlight-${i}`;
      light.position.set(0, -500, 0);
      light.target.position.set(0, -510, 0);
      if (opts.volumetricLayer !== undefined) light.layers.enable(opts.volumetricLayer);
      scene.add(light, light.target);
      this.pool.push({ light, owner: null, intensity: 0 });
    }
  }

  /** Number of remote avatars currently managed. */
  get count(): number {
    return this.avatars.size;
  }

  /** Root object of a remote player's avatar (e.g. for raycasts or attaching effects). */
  getAvatar(id: string): THREE.Object3D | undefined {
    return this.avatars.get(id)?.root;
  }

  /**
   * Per-frame update. `renderTime` is normally `session.renderTime()`;
   * `localPlayerPos` is used for light assignment and label fading.
   */
  update(dt: number, session: Session, renderTime: number, localPlayerPos: THREE.Vector3): void {
    // roster sync
    for (const [id, rp] of session.players) {
      let av = this.avatars.get(id);
      if (!av) {
        av = new Avatar(this.kit, id, rp.info, this.castShadows);
        this.avatars.set(id, av);
        this.scene.add(av.root, av.label);
      } else av.setInfo(rp.info);
    }
    for (const [id, av] of this.avatars) {
      if (session.players.has(id)) continue;
      av.dispose();
      this.avatars.delete(id);
      for (const l of this.pool) if (l.owner === id) l.owner = null;
    }

    // poses
    for (const av of this.avatars.values()) {
      const s = session.sampleRemote(av.id, renderTime, av.sample);
      if (!s) {
        av.setVisible(false);
        continue;
      }
      av.setVisible(true);
      av.update(dt, s);
      av.updateLabel(av.headWorld.distanceTo(localPlayerPos), this.labelDistance);
    }

    this.updateLights(dt, localPlayerPos);
  }

  private updateLights(dt: number, from: THREE.Vector3): void {
    if (!this.pool.length) return;
    // nearest avatars with their torch on get a light
    const range2 = (this.flash.distance + 20) ** 2;
    const wanted = [...this.avatars.values()]
      .filter((a) => a.root.visible && a.lightW > 0.02)
      .map((a) => ({ a, d: a.root.position.distanceToSquared(from) }))
      .filter((c) => c.d < range2)
      .sort((x, y) => x.d - y.d)
      .slice(0, this.pool.length)
      .map((c) => c.a);
    const wantedIds = new Set(wanted.map((a) => a.id));
    for (const l of this.pool) if (l.owner && !wantedIds.has(l.owner)) l.owner = null;
    for (const a of wanted) {
      if (this.pool.some((l) => l.owner === a.id)) continue;
      // prefer a light that has already faded out, so beams never streak across the map
      const free = this.pool.filter((l) => !l.owner).sort((x, y) => x.intensity - y.intensity)[0];
      if (!free) break;
      free.owner = a.id;
      free.intensity = 0;
    }

    const k = damp(14, dt);
    for (const l of this.pool) {
      const a = l.owner ? this.avatars.get(l.owner) : undefined;
      let target = 0;
      if (a) {
        l.light.position.copy(a.lensWorld);
        this.tmp.copy(a.lensWorld).addScaledVector(a.aim, 10);
        l.light.target.position.copy(this.tmp);
        l.light.target.updateMatrixWorld();
        target = this.flash.intensity * a.lightW;
      }
      l.intensity += (target - l.intensity) * k;
      // never toggle .visible – changing the light count recompiles every material
      l.light.intensity = l.intensity < 0.05 ? 0 : l.intensity;
    }
  }

  /** Removes everything from the scene. Only call at teardown (changes the light count). */
  dispose(): void {
    for (const av of this.avatars.values()) av.dispose();
    this.avatars.clear();
    for (const l of this.pool) {
      l.light.removeFromParent();
      l.light.target.removeFromParent();
      l.light.dispose();
    }
    this.pool = [];
    this.kit.dispose();
  }
}
