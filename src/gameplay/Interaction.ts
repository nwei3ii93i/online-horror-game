import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics, GROUP, groups } from '../physics/Physics';

export interface Interactable {
  id: string;
  /** Text shown when looking at it (already localised). Return null to hide. */
  prompt(ctx: InteractionContext): string | null;
  interact(ctx: InteractionContext): void;
  /** Optional: max distance override. */
  range?: number;
}

export interface InteractionContext {
  playerId: string;
  hasItem(id: string): boolean;
  /** World-space point that was hit. */
  point: THREE.Vector3;
}

/**
 * Ray-based focus & use. Anything with a collider can register as interactable.
 * The first collider along the view ray decides (no interacting through walls).
 */
export class Interaction {
  private byCollider = new Map<number, Interactable>();
  focused: Interactable | null = null;
  focusPoint = new THREE.Vector3();
  range = 2.3;

  constructor(private physics: Physics) {}

  register(collider: RAPIER.Collider, it: Interactable): void { this.byCollider.set(collider.handle, it); }
  unregister(collider: RAPIER.Collider): void { this.byCollider.delete(collider.handle); }

  update(camera: THREE.Camera, exclude: RAPIER.Collider | undefined): void {
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const hit = this.physics.raycast({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }, 3.5,
      groups(GROUP.PLAYER, GROUP.STATIC | GROUP.DOOR | GROUP.DYNAMIC | GROUP.TRIGGER | GROUP.TERRAIN), exclude);
    this.focused = null;
    if (!hit) return;
    const it = this.byCollider.get(hit.collider.handle);
    if (!it) return;
    if (hit.toi > (it.range ?? this.range)) return;
    this.focused = it;
    this.focusPoint.copy(o).addScaledVector(d, hit.toi);
  }
}
