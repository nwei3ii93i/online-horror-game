import * as THREE from 'three/webgpu';
import { color, float, uniform } from 'three/tsl';
import type { LightFixture, Room } from '../world/architecture/BuildingKit';
import { MeshBuilder } from '../world/architecture/MeshBuilder';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { LAYER_OWN_MASK } from '../render/PostFX';

interface FixtureState {
  f: LightFixture;
  /** Emissive strength of the bulb mesh (0 = dark). */
  glow: any;
  level: number;
  /** Seconds until the next random dropout / stutter. */
  nextEvent: number;
  dropout: number;
}

/**
 * Generator-powered lamps. Every fixture gets a bulb mesh; a small fixed pool of point lights
 * (never added or removed, so no shader recompiles) follows the nearest working fixtures.
 * Their cube shadows are static (rendered once on reassignment) because the house never moves.
 */
export class LightPool {
  readonly group = new THREE.Group();
  readonly lights: THREE.PointLight[] = [];
  private assigned: (FixtureState | null)[] = [];
  private states: FixtureState[] = [];
  private t = 0;
  private reassignTimer = 0;
  private shadowsStale = false;

  /**
   * Lamp shadows are static (rendered once per assignment). Call this when casters near the
   * lamps changed: culling showed/hid furniture or a door swung.
   */
  refreshShadows(): void { this.shadowsStale = true; }

  constructor(scene: THREE.Scene, fixtures: LightFixture[], rooms: Room[], materials: MaterialLibrary, size = 2, shadowSize = 512) {
    this.group.name = 'light-fixtures';
    const mb = new MeshBuilder();
    for (const f of fixtures) {
      const room = rooms.find((r) => r.id === f.room);
      const ceil = room ? room.y1 : f.position.y + 0.6;
      const p = f.position;
      const flame = f.kind === 'candle' || f.kind === 'lantern';
      // cord, bakelite socket; pendants get a shallow enamel shade (candles are just a flame)
      if (!flame) mb.rod('rubber_black', new THREE.Vector3(p.x, ceil, p.z), new THREE.Vector3(p.x, p.y + 0.09, p.z), 0.005, 0.005, 5);
      if (!flame) {
        mb.cylinder('plastic_bakelite', p.x, p.y + 0.04, p.z, 0.022, 0.018, 0.06, 10);
        mb.cylinder('plastic_bakelite', p.x, ceil - 0.025, p.z, 0.045, 0.045, 0.025, 12);
      }
      if (f.kind === 'pendant') {
        mb.pushTRS(p.x, p.y - 0.06, p.z);
        mb.lathe('ceramic_white', [[0.21, 0.0], [0.2, 0.02], [0.12, 0.1], [0.03, 0.14]], 18);
        mb.pop();
      }
      const glow = uniform(0);
      const mat = new THREE.MeshStandardNodeMaterial();
      mat.colorNode = color(new THREE.Color(f.working ? 0xe8dcc0 : 0x9a968c));
      mat.roughnessNode = float(0.15);
      (mat as any).emissiveNode = color(new THREE.Color(f.color ?? 0xffc98a)).mul(glow);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(flame ? 0.008 : f.kind === 'pendant' ? 0.04 : 0.032, 12, 8), mat);
      bulb.position.set(p.x, flame ? p.y - 0.06 : p.y, p.z);
      bulb.scale.set(1, flame ? 2.6 : 1.3, 1);
      bulb.castShadow = false;
      this.group.add(bulb);
      this.states.push({ f, glow, level: 0, nextEvent: 1 + Math.random() * 4, dropout: 0 });
    }
    this.group.add(mb.build(materials, { name: 'fixtures', castShadow: false }));
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 9, 2);
      l.castShadow = shadowSize > 0;
      l.shadow.mapSize.set(shadowSize, shadowSize);
      // indoor lamps: no trees or ground cover in the six cube faces
      l.shadow.camera.layers.enable(LAYER_OWN_MASK);
      l.shadow.bias = -0.002;
      l.shadow.camera.near = 0.08;
      l.shadow.camera.far = 12;
      l.shadow.autoUpdate = false;
      l.position.set(0, -500, 0);
      scene.add(l);
      this.lights.push(l);
      this.assigned.push(null);
    }
    scene.add(this.group);
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    // flicker: unstable supply = smooth wobble + occasional dropouts
    for (const s of this.states) {
      if (!s.f.working) { s.level = 0; s.glow.value = 0; continue; }
      const fl = s.f.flicker;
      s.nextEvent -= dt;
      if (s.nextEvent <= 0) {
        s.dropout = Math.random() < fl ? 0.05 + Math.random() * 0.25 : 0;
        s.nextEvent = 0.4 + Math.random() * (6 - 5 * fl);
      }
      s.dropout = Math.max(0, s.dropout - dt);
      const wob = 1 - fl * 0.25 * (0.5 + 0.5 * Math.sin(this.t * 13.1 + s.f.position.x) * Math.sin(this.t * 7.3 + s.f.position.z));
      const target = s.dropout > 0 ? (Math.random() < 0.5 ? 0.05 : 0.4) : wob;
      s.level += (target - s.level) * Math.min(1, dt * 30);
      s.glow.value = s.level * 14;
    }
    // reassign the pool to the nearest working fixtures a few times a second
    this.reassignTimer -= dt;
    if (this.reassignTimer <= 0) {
      this.reassignTimer = 0.25;
      const near = this.states.filter((s) => s.f.working && s.f.position.distanceToSquared(cam) < 26 * 26)
        .sort((a, b) => a.f.position.distanceToSquared(cam) - b.f.position.distanceToSquared(cam))
        .slice(0, this.lights.length);
      // keep existing assignments stable
      const free = this.lights.map((_, i) => i).filter((i) => !this.assigned[i] || !near.includes(this.assigned[i]!));
      for (const s of near) {
        if (this.assigned.includes(s)) continue;
        const i = free.shift();
        if (i === undefined) break;
        this.assigned[i] = s;
        const l = this.lights[i];
        l.position.copy(s.f.position).y -= 0.06;
        l.color.setHex(s.f.color ?? 0xffc98a);
        l.shadow.needsUpdate = true;
      }
      for (const i of free) if (this.assigned[i] && !near.includes(this.assigned[i]!)) { this.assigned[i] = null; this.lights[i].intensity = 0; this.lights[i].position.set(0, -500, 0); }
    }
    if (this.shadowsStale) {
      this.shadowsStale = false;
      // only lamps near the viewer: further out their rooms are culled anyway, and a cube
      // shadow is six passes
      this.assigned.forEach((s, i) => { if (s && s.f.position.distanceToSquared(cam) < 16 * 16) this.lights[i].shadow.needsUpdate = true; });
    }
    this.assigned.forEach((s, i) => {
      if (!s) return;
      this.lights[i].intensity = (s.f.intensity ?? 4) * 2.2 * s.level;
    });
  }
}
