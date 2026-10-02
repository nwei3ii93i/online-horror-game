import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, GROUP, groups } from '../physics/Physics';
import type { Input } from '../core/Input';
import type { Settings } from '../core/Settings';

export type Stance = 'stand' | 'crouch' | 'crawl';

const STANCE = {
  stand: { height: 1.76, eye: 1.64, speed: 1.55 },
  crouch: { height: 1.15, eye: 1.02, speed: 0.85 },
  crawl: { height: 0.62, eye: 0.42, speed: 0.45 },
} as const;
const RADIUS = 0.28;
const SPRINT_SPEED = 3.5;

export interface FootstepEvent { position: THREE.Vector3; surface: string; intensity: number; stance: Stance }

/**
 * Kinematic first-person character: capsule with Rapier's character controller,
 * stances (stand / crouch / crawl through crawl spaces), stamina-limited sprint,
 * head-bob and landing response, and footstep events per stride.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance: Stance = 'stand';
  grounded = false;
  stamina = 1;
  eyeHeight: number = STANCE.stand.eye;
  enabled = true;
  noclip = false;
  /** Set when the player is hidden (in a wardrobe etc.) – movement disabled. */
  hidden = false;
  onFootstep: ((e: FootstepEvent) => void) | null = null;
  onLand: ((speed: number, surface: string) => void) | null = null;

  private collider!: RAPIER.Collider;
  private body!: RAPIER.RigidBody;
  private controller!: RAPIER.KinematicCharacterController;
  private vy = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private strideAcc = 0;
  private landDip = 0;
  private lean = 0;
  private sway = new THREE.Vector2();
  private currentHeight: number = STANCE.stand.height;
  private lastSurface = 'terrain';
  private smoothedMove = new THREE.Vector3();

  constructor(private physics: Physics, private input: Input, private settings: Settings, private camera: THREE.PerspectiveCamera) {}

  init(x: number, y: number, z: number, yaw = 0): void {
    const R = this.physics.R;
    const world = this.physics.world;
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.currentHeight / 2, z));
    this.collider = world.createCollider(this.capsuleDesc(this.currentHeight), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.32, 0.12, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(75);
    this.position.set(x, y, z);
    this.yaw = yaw;
  }

  private capsuleDesc(height: number): RAPIER.ColliderDesc {
    const R = this.physics.R;
    const half = Math.max(0.01, height / 2 - RADIUS);
    return R.ColliderDesc.capsule(half, RADIUS).setCollisionGroups(groups(GROUP.PLAYER, 0xffff & ~GROUP.PLAYER & ~GROUP.TRIGGER));
  }

  get colliderHandle(): number { return this.collider.handle; }
  get rapierCollider(): RAPIER.Collider { return this.collider; }

  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.body.setNextKinematicTranslation({ x, y: y + this.currentHeight / 2, z });
    this.body.setTranslation({ x, y: y + this.currentHeight / 2, z }, true);
    this.position.set(x, y, z);
    this.vy = 0;
    if (yaw !== undefined) this.yaw = yaw;
  }

  /** Free headroom above the feet (for stand-up checks). */
  private headroom(): number {
    const R = this.physics.R;
    const p = this.position;
    const shape = new R.Ball(RADIUS * 0.9);
    const hit = this.physics.world.castShape(
      { x: p.x, y: p.y + RADIUS, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0 }, shape, 0, 3, true,
      undefined, groups(GROUP.PLAYER, GROUP.STATIC | GROUP.DOOR | GROUP.DYNAMIC), this.collider,
    );
    return hit ? hit.time_of_impact + RADIUS * 2 : 3;
  }

  private setStance(s: Stance): boolean {
    if (s === this.stance) return true;
    const target = STANCE[s].height;
    if (target > this.currentHeight && this.headroom() < target + 0.02) return false;
    this.stance = s;
    const world = this.physics.world;
    const handle = this.collider;
    world.removeCollider(handle, false);
    this.currentHeight = target;
    this.collider = world.createCollider(this.capsuleDesc(target), this.body);
    const p = this.position;
    this.body.setTranslation({ x: p.x, y: p.y + target / 2, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + target / 2, z: p.z });
    return true;
  }

  fixedUpdate(dt: number): void {
    if (!this.enabled || this.hidden) { this.velocity.set(0, 0, 0); return; }
    const inp = this.input;
    // stance changes
    if (inp.wasPressed('crouch')) {
      if (this.stance === 'stand') this.setStance('crouch');
      else if (this.stance === 'crouch') this.setStance('stand') || this.setStance('crawl');
      else this.setStance('crouch') || this.setStance('crawl');
    }
    if (inp.wasPressed('jump') && this.stance !== 'stand') {
      this.setStance('crouch');
      this.setStance('stand');
    }
    // automatic crawl when the ceiling drops while crouching into a crawl space
    if (this.stance === 'crouch' && this.headroom() < STANCE.crouch.height - 0.05) this.setStance('crawl');

    const fwd = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    const strafe = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    const wantSprint = inp.isDown('sprint') && fwd > 0 && this.stance === 'stand' && this.stamina > 0.05;
    let speed: number = STANCE[this.stance].speed;
    if (wantSprint) speed = SPRINT_SPEED;
    this.stamina = Math.max(0, Math.min(1, this.stamina + (wantSprint ? -dt / 9 : dt / 14)));

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const move = new THREE.Vector3(
      (-sin * fwd + cos * strafe),
      0,
      (-cos * fwd - sin * strafe),
    );
    if (move.lengthSq() > 1) move.normalize();
    move.multiplyScalar(speed);
    // inertia: humans don't start/stop instantly
    const accel = this.grounded ? 9 : 2;
    this.smoothedMove.lerp(move, 1 - Math.exp(-accel * dt));

    if (this.noclip) {
      const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
      const v = look.multiplyScalar(fwd).add(right.multiplyScalar(strafe)).multiplyScalar(wantSprint ? 25 : 6);
      this.position.addScaledVector(v, dt);
      this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.currentHeight / 2, z: this.position.z });
      return;
    }

    // gravity and jump
    if (this.grounded) {
      this.vy = -1.0;
      if (inp.wasPressed('jump') && this.stance === 'stand') this.vy = 3.4;
    } else {
      this.vy -= 9.81 * dt;
      if (this.vy < -30) this.vy = -30;
    }

    const desired = { x: this.smoothedMove.x * dt, y: this.vy * dt, z: this.smoothedMove.z * dt };
    const t = this.body.translation();
    const ignoreTerrain = this.physics.ignoreTerrainAt(t.x, t.y - this.currentHeight / 2, t.z);
    const terrain = this.physics.terrainCollider;
    this.controller.computeColliderMovement(
      this.collider, desired, undefined, undefined,
      ignoreTerrain && terrain ? (c: RAPIER.Collider) => c.handle !== terrain.handle : undefined,
    );
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vy;
    this.grounded = this.controller.computedGrounded();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.velocity.set(mv.x / dt, mv.y / dt, mv.z / dt);
    this.position.set(nx, ny - this.currentHeight / 2, nz);
    if (this.grounded && mv.y > -0.0001 && this.vy > 0) this.vy = 0;
    if (!wasGrounded && this.grounded && fallSpeed > 2.5) {
      this.landDip = Math.min(0.12, fallSpeed * 0.02);
      this.onLand?.(fallSpeed, this.groundSurface());
    }

    // strides → footsteps
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && hs > 0.2) {
      const strideLen = this.stance === 'stand' ? (hs > 2.5 ? 1.45 : 1.05) : this.stance === 'crouch' ? 0.7 : 0.45;
      this.strideAcc += hs * dt;
      if (this.strideAcc >= strideLen) {
        this.strideAcc -= strideLen;
        const surface = this.groundSurface();
        this.onFootstep?.({
          position: this.position.clone(), surface,
          intensity: Math.min(1, hs / SPRINT_SPEED) * (this.stance === 'stand' ? 1 : 0.45),
          stance: this.stance,
        });
      }
    } else this.strideAcc = Math.min(this.strideAcc, 0.6);
  }

  /** Surface tag below the player (collider surface or terrain splat). */
  groundSurface(): string {
    const p = this.position;
    const hit = this.physics.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: -1, z: 0 }, 1.2, groups(GROUP.PLAYER, GROUP.STATIC | GROUP.TERRAIN | GROUP.DYNAMIC), this.collider);
    if (hit) this.lastSurface = this.physics.surfaceOf(hit.collider);
    return this.lastSurface;
  }

  /** Mouse look + camera placement; called every rendered frame. */
  update(dt: number): void {
    const s = this.settings.values;
    if (this.enabled) {
      const { dx, dy } = this.input.consumeMouse();
      const sens = 0.0022 * s.mouseSensitivity;
      this.yaw -= dx * sens;
      this.pitch -= dy * sens * (s.invertY ? -1 : 1);
      const maxPitch = this.stance === 'crawl' ? 0.9 : 1.45;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
      this.sway.x += (dx * 0.00008 - this.sway.x) * Math.min(1, dt * 8);
      this.sway.y += (dy * 0.00008 - this.sway.y) * Math.min(1, dt * 8);
    } else this.input.consumeMouse();

    // smooth eye height between stances
    const targetEye = STANCE[this.stance].eye;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 7);

    // head bob
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && hs > 0.15;
    this.bobAmount += ((moving ? Math.min(1, hs / 1.5) : 0) - this.bobAmount) * Math.min(1, dt * 6);
    const freq = hs > 2.5 ? 2.1 : this.stance === 'stand' ? 1.55 : 1.1;
    this.bobPhase += dt * freq * Math.PI * 2 * (moving ? 1 : 0.3);
    const bobScale = s.headBob ? 1 : 0.15;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.035 * this.bobAmount * bobScale;
    const bobX = Math.sin(this.bobPhase) * 0.018 * this.bobAmount * bobScale;
    const breathe = Math.sin(performance.now() * 0.0011) * 0.004 * (1 + (1 - this.stamina) * 3);
    this.landDip *= Math.exp(-dt * 7);

    // lean (Q/E style peeking is mapped to lean_left only for now)
    const leanTarget = this.input.isDown('lean_left') ? -1 : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);

    const cam = this.camera;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(this.position.x, this.position.y + this.eyeHeight - bobY - this.landDip + breathe, this.position.z);
    cam.position.addScaledVector(right, bobX + this.lean * 0.35);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw - this.sway.x * 0.5;
    cam.rotation.x = this.pitch - this.sway.y * 0.5 - this.landDip * 0.4;
    cam.rotation.z = -bobX * 0.6 - this.lean * 0.12;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}
