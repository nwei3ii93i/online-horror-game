import * as THREE from 'three/webgpu';
import { float, mix } from 'three/tsl';
import type { Physics } from '../physics/Physics';
import { GROUP } from '../physics/Physics';
import type { Interaction } from './Interaction';
import type { Anchor } from '../world/architecture/BuildingKit';
import { worldUniforms } from '../render/WorldUniforms';

export interface KeyDef {
  /** Item id checked by doors (DoorSpec.key). */
  item: string;
  /** Anchor the key hangs from / lies at. */
  anchor: string;
  label: string;
  /** Hanging from a hook (true) or lying flat. */
  hanging?: boolean;
}

/** Keys of the estate and where they are found. */
export const KEYS: KeyDef[] = [
  { item: 'key_manor_front', anchor: 'key_manor_front', label: 'Schlüssel „Haupthaus"', hanging: true },
];

/**
 * Small pickable items (keys). A modelled bit-key with a paper tag; picking it up adds the
 * item to the inventory, which locked doors check.
 */
export class Pickups {
  readonly group = new THREE.Group();

  constructor(private physics: Physics, private interaction: Interaction, private onPick: (item: string, label: string) => void) {
    this.group.name = 'pickups';
  }

  addKeys(anchors: Anchor[]): void {
    const iron = new THREE.MeshStandardNodeMaterial();
    iron.color.set(0x3a342c);
    iron.roughness = 0.45;
    iron.metalness = 0.9;
    (iron as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
    const tag = new THREE.MeshStandardNodeMaterial();
    tag.color.set(0xcbbf9e);
    tag.roughness = 0.9;
    (tag as any).aoNode = mix(float(1), worldUniforms.indoorAmbient, worldUniforms.indoorAt());
    for (const k of KEYS) {
      const a = anchors.find((x) => x.id === k.anchor);
      if (!a) continue;
      const key = new THREE.Group();
      // bow, shank, bit (old mortise-lock key, ~11 cm) and a tied paper tag
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 14), iron);
      bow.position.y = -0.016;
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.08, 6), iron);
      shank.position.y = -0.072;
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, 0.014), iron);
      bit.position.set(0, -0.104, 0.008);
      const label = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.001), tag);
      label.position.set(0.02, -0.03, 0.004);
      label.rotation.z = -0.3;
      key.add(bow, shank, bit, label);
      key.position.copy(a.pos);
      key.rotation.y = a.ry;
      if (!k.hanging) key.rotation.x = -Math.PI / 2;
      key.traverse((o) => { o.castShadow = true; });
      this.group.add(key);
      const col = this.physics.addBox({ cx: a.pos.x, cy: a.pos.y - 0.06, cz: a.pos.z, hx: 0.08, hy: 0.09, hz: 0.08, surface: 'metal' }, GROUP.TRIGGER);
      let taken = false;
      this.interaction.register(col, {
        id: `key:${k.item}`,
        range: 1.8,
        prompt: () => (taken ? null : `Nehmen: ${k.label}`),
        interact: () => {
          if (taken) return;
          taken = true;
          key.visible = false;
          this.onPick(k.item, k.label);
        },
      });
    }
  }
}
