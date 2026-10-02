import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { MeshBuilder } from '../world/architecture/MeshBuilder';
import { buildDoorLeaf } from '../world/architecture/Elements';
import type { DoorSpec } from '../world/architecture/BuildingKit';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { Physics, GROUP, groups } from '../physics/Physics';
import type { Interaction, InteractionContext } from './Interaction';
import type { WorldBridge } from './WorldBridge';
import { EventBus } from '../core/Events';

export interface DoorEvents extends Record<string, unknown> {
  creak: { id: string; position: THREE.Vector3; speed: number; kind: string };
  close: { id: string; position: THREE.Vector3; kind: string };
  locked: { id: string; position: THREE.Vector3 };
  unlock: { id: string; position: THREE.Vector3 };
}

interface Door {
  spec: DoorSpec;
  pivot: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  angle: number;
  target: number;
  vel: number;
  locked: boolean;
  blockedTime: number;
  creaked: boolean;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Hinged doors. Leaf geometry is generated once per door, the hinge pivot is animated
 * with a damped spring, a kinematic Rapier body follows the leaf. All state changes go
 * through the WorldBridge so they replicate in multiplayer.
 */
const EXTERIOR_DOOR = /front|terrace|kitchen_back|balcony/;

export class Doors {
  readonly group = new THREE.Group();
  readonly events = new EventBus<DoorEvents>();
  private doors = new Map<string, Door>();
  private byCollider = new Map<number, Door>();
  playerPos: THREE.Vector3 | null = null;

  constructor(private physics: Physics, private materials: MaterialLibrary, private interaction: Interaction, private world: WorldBridge) {
    this.group.name = 'doors';
    world.subscribe((id, state) => {
      const d = this.doors.get(id);
      if (!d || !state) return;
      if (typeof state.locked === 'boolean') d.locked = state.locked;
      if (typeof state.target === 'number') d.target = state.target;
    });
  }

  add(spec: DoorSpec): void {
    const mb = new MeshBuilder();
    buildDoorLeaf(mb, spec.leaf);
    const leaf = mb.build(this.materials, { name: spec.id });
    const pivot = new THREE.Group();
    pivot.name = spec.id;
    pivot.position.copy(spec.hinge);
    pivot.rotation.y = spec.ry;
    pivot.add(leaf);
    leaf.traverse((o) => { o.matrixAutoUpdate = false; (o as THREE.Mesh).updateMatrix?.(); });
    this.group.add(pivot);

    const R = this.physics.R;
    const w = spec.leaf.width, h = spec.leaf.height, t = spec.leaf.thickness ?? 0.045;
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.hinge.x, spec.hinge.y, spec.hinge.z));
    const col = this.physics.world.createCollider(
      R.ColliderDesc.cuboid(w / 2, h / 2, t / 2).setTranslation(w / 2, h / 2, 0).setCollisionGroups(groups(GROUP.DOOR, 0xffff)),
      body,
    );
    this.physics.surfaces.set(col.handle, spec.sound === 'metal' ? 'metal' : 'wood');
    const initial = spec.open ?? 0;
    const door: Door = { spec, pivot, body, collider: col, angle: initial, target: initial, vel: 0, locked: !!spec.locked, blockedTime: 0, creaked: false };
    this.apply(door);
    this.doors.set(spec.id, door);
    this.byCollider.set(col.handle, door);
    this.world.register(spec.id, { locked: door.locked, target: initial, key: spec.key ?? null });
    this.interaction.register(col, {
      id: spec.id,
      prompt: (ctx) => this.prompt(door, ctx),
      interact: (ctx) => this.use(door, ctx),
    });
  }

  private prompt(d: Door, ctx: InteractionContext): string {
    if (d.locked) return ctx.hasItem(d.spec.key ?? '') ? 'Unlock' : 'Locked';
    return d.target > 0.2 ? 'Close' : 'Open';
  }

  private use(d: Door, ctx: InteractionContext): void {
    const pos = d.spec.hinge.clone();
    if (d.locked) {
      if (d.spec.key && ctx.hasItem(d.spec.key)) {
        this.world.act(d.spec.id, 'unlock', { key: d.spec.key });
        this.events.emit('unlock', { id: d.spec.id, position: pos });
      } else {
        this.events.emit('locked', { id: d.spec.id, position: pos });
        // the handle gives a little: tiny rattle animation
        d.vel += 0.25;
      }
      return;
    }
    const max = d.spec.maxOpen ?? 1.75;
    const target = d.target > 0.2 ? 0 : max;
    this.world.act(d.spec.id, 'open', { target });
    d.target = target;
    d.creaked = false;
  }

  private apply(d: Door): void {
    const a = d.angle * d.spec.swing;
    d.pivot.rotation.y = d.spec.ry + a;
    d.pivot.updateMatrixWorld(true);
    _q.setFromEuler(_e.set(0, d.spec.ry + a, 0));
    d.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }

  /** Would the leaf at angle `a` intersect the player capsule? */
  private hitsPlayer(d: Door, a: number): boolean {
    const p = this.playerPos;
    if (!p) return false;
    const h = d.spec.hinge;
    if (p.y > h.y + d.spec.leaf.height || p.y + 1.8 < h.y) return false;
    const ang = d.spec.ry + a * d.spec.swing;
    const tx = h.x + Math.cos(ang) * d.spec.leaf.width, tz = h.z - Math.sin(ang) * d.spec.leaf.width;
    // distance from player to hinge→tip segment
    const vx = tx - h.x, vz = tz - h.z;
    const len2 = vx * vx + vz * vz;
    let t = ((p.x - h.x) * vx + (p.z - h.z) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (h.x + vx * t), dz = p.z - (h.z + vz * t);
    return dx * dx + dz * dz < 0.33 * 0.33;
  }

  update(dt: number): void {
    for (const d of this.doors.values()) {
      const diff = d.target - d.angle;
      if (Math.abs(diff) < 0.0005 && Math.abs(d.vel) < 0.001) {
        if (d.vel !== 0) { d.vel = 0; }
        continue;
      }
      // critically-damped spring with a heavy, slow feel
      const k = 9, c = 2 * Math.sqrt(k) * 1.05;
      d.vel += (diff * k - d.vel * c) * dt;
      const maxV = 1.6;
      d.vel = Math.max(-maxV, Math.min(maxV, d.vel));
      const next = d.angle + d.vel * dt;
      if (this.hitsPlayer(d, next) && !this.hitsPlayer(d, d.angle)) {
        d.vel = 0;
        d.blockedTime += dt;
        if (d.blockedTime > 0.4) { d.target = d.angle; d.blockedTime = 0; }
        continue;
      }
      d.blockedTime = 0;
      const was = d.angle;
      d.angle = next;
      if (!d.creaked && Math.abs(d.vel) > 0.15) {
        d.creaked = true;
        this.events.emit('creak', { id: d.spec.id, position: d.spec.hinge.clone().add(new THREE.Vector3(0, 1.2, 0)), speed: Math.abs(d.vel), kind: d.spec.sound ?? 'wood' });
      }
      if (d.target === 0 && was > 0.02 && d.angle <= 0.02) {
        d.angle = 0; d.vel = 0;
        this.events.emit('close', { id: d.spec.id, position: d.spec.hinge.clone().add(new THREE.Vector3(0, 1.2, 0)), kind: d.spec.sound ?? 'wood' });
      }
      this.apply(d);
    }
  }

  /**
   * Hide leaves the camera cannot see: beyond `range`, or (camera indoors at floor `floorY`)
   * more than a storey away. Saves a draw call per part and per shadow pass.
   */
  cull(cam: THREE.Vector3, range: number, floorY: number | null): void {
    for (const d of this.doors.values()) {
      const h = d.spec.hinge;
      const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
      // entrance doors stay visible from afar (they read from the courtyard / garden)
      if (EXTERIOR_DOOR.test(d.spec.id) && (floorY === null || Math.abs(h.y - floorY) < 1.5)) { d.pivot.visible = d2 < 70 * 70; continue; }
      let vis = d2 < range * range;
      if (vis && d2 > 25) {
        if (floorY !== null) vis = h.y > floorY - 1.2 && h.y < floorY + 2.8;
        else vis = h.y > -0.6 && h.y < 1.5; // from outside: ground-floor and terrace leaves only
      }
      d.pivot.visible = vis;
    }
  }

  isDoorCollider(handle: number): boolean { return this.byCollider.has(handle); }
  get count(): number { return this.doors.size; }
}
