import * as THREE from 'three/webgpu';
import { MeshBuilder } from './MeshBuilder';
import { WallDef, FaceSpec, Opening, buildWall, buildSkirting, wallFrame, WallFrame } from './Walls';
import { buildWindow, buildDoorFrame, WindowOpts, DoorLeafOpts, buildSlab } from './Elements';
import type { Physics } from '../../physics/Physics';
import type { Rect } from '../Layout';

export type AudioEnv = 'outdoor' | 'forest' | 'room_small' | 'room_large' | 'hall' | 'basement' | 'tunnel' | 'barn' | 'attic';

export interface Room {
  id: string;
  /** Story location id (documents, audio). */
  location: string;
  x0: number; z0: number; x1: number; z1: number;
  /** Floor (top) height and ceiling height. */
  y0: number; y1: number;
  floor: string | null;
  ceiling: string | null;
  wall: FaceSpec | string;
  skirting?: string | null;
  env: AudioEnv;
  /** Rectangles cut out of the floor (stairwells). */
  voids?: Rect[];
  /** Rectangles cut out of the ceiling. */
  ceilVoids?: Rect[];
  floorSurface?: string;
  slab?: number;
}

export interface DoorSpec {
  id: string;
  /** Hinge axis base position. */
  hinge: THREE.Vector3;
  /** Yaw of the closed leaf (leaf extends along local +x from the hinge). */
  ry: number;
  /** Opening direction: +1 swings toward local −z, −1 toward +z. */
  swing: 1 | -1;
  leaf: DoorLeafOpts;
  locked?: boolean;
  key?: string;
  /** Initial open angle (rad). */
  open?: number;
  /** Max open angle. */
  maxOpen?: number;
  room?: string;
  sound?: 'wood' | 'metal' | 'gate';
}

export interface LightFixture {
  id: string;
  position: THREE.Vector3;
  kind: 'bulb' | 'pendant' | 'wall' | 'tube' | 'lantern' | 'candle';
  /** Whether it works (powered by the generator) and how unstable it is. */
  working: boolean;
  flicker: number;
  color?: number;
  intensity?: number;
  room?: string;
}

export interface InteriorSpan {
  x0: number; z0: number; x1: number; z1: number;
  floorY: number;
  ceil: number | ((x: number, z: number) => number);
}

export interface Anchor { id: string; pos: THREE.Vector3; ry: number; room?: string }

export interface BuildingOutput {
  id: string;
  group: THREE.Group;
  doors: DoorSpec[];
  lights: LightFixture[];
  spans: InteriorSpan[];
  rooms: Room[];
  anchors: Anchor[];
  /** Extra static builders produced by the building (e.g. decoration with own materials). */
}

const asFace = (f: FaceSpec | string): FaceSpec => (typeof f === 'string' ? { mat: f } : f);

export interface KitWall extends Omit<WallDef, 'left' | 'right'> {
  /** Face spec override; 'auto' resolves from the room on that side; 'ext' uses the facade spec. */
  left?: FaceSpec | string | 'auto' | 'ext' | null;
  right?: FaceSpec | string | 'auto' | 'ext' | null;
  windows?: { o: Opening; opts: Partial<WindowOpts> }[];
  doors?: { o: Opening; frame?: string | null; architrave?: boolean }[];
  skirting?: boolean;
}

/**
 * Collects walls, rooms and openings of one building and resolves wall finishes from
 * the rooms on either side, so interior partitions automatically get the right
 * wallpaper/paint on each face.
 */
export class BuildingKit {
  readonly mb = new MeshBuilder();
  readonly rooms: Room[] = [];
  readonly doors: DoorSpec[] = [];
  readonly lights: LightFixture[] = [];
  readonly spans: InteriorSpan[] = [];
  readonly anchors: Anchor[] = [];
  readonly frames: { wall: KitWall; frame: WallFrame }[] = [];

  constructor(readonly id: string, readonly physics: Physics | undefined, readonly facade: FaceSpec) {}

  room(r: Room): Room { this.rooms.push(r); return r; }

  roomAt(x: number, z: number, y: number): Room | undefined {
    return this.rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && y >= r.y0 - 0.05 && y < r.y1 + 0.05);
  }

  private resolve(w: KitWall, spec: KitWall['left'], side: 1 | -1, f: WallFrame): FaceSpec | null {
    if (spec === null) return null;
    if (spec && spec !== 'auto' && spec !== 'ext') return asFace(spec);
    if (spec === 'ext') return this.facade;
    // auto: sample just beyond the wall face, mid-way along and at mid height
    const s = f.len / 2;
    const y = (w.y0 + w.y1) / 2;
    const off = side * (w.t / 2 + 0.15);
    const x = f.ax + f.dx * s + f.rx * off, z = f.az + f.dz * s + f.rz * off;
    const r = this.roomAt(x, z, y);
    if (r) return asFace(r.wall);
    return this.facade;
  }

  wall(w: KitWall): WallFrame {
    const f0 = wallFrame(w as WallDef);
    const left = this.resolve(w, w.left ?? 'auto', -1, f0);
    const right = this.resolve(w, w.right ?? 'auto', 1, f0);
    const openings = [...(w.openings ?? []), ...(w.windows ?? []).map((x) => x.o), ...(w.doors ?? []).map((x) => x.o)];
    const def: WallDef = { ...w, left, right, openings };
    const f = buildWall(this.mb, def, this.physics);
    for (const win of w.windows ?? []) {
      const exterior: 1 | -1 = win.opts.exterior ?? (right === this.facade ? 1 : left === this.facade ? -1 : 1);
      buildWindow(this.mb, f, win.o, { style: 'kasten', exterior, ...win.opts } as WindowOpts);
      // windows block movement unless explicitly passable
      if (this.physics && !(win.opts as { passable?: boolean }).passable) {
        const c = [f.ax + f.dx * win.o.at, f.y0 + (win.o.bottom + win.o.top) / 2, f.az + f.dz * win.o.at];
        this.physics.addBox({ cx: c[0], cy: c[1], cz: c[2], hx: win.o.width / 2, hy: (win.o.top - win.o.bottom) / 2, hz: 0.05, ry: -Math.atan2(f.dz, f.dx), surface: 'glass' });
      }
    }
    for (const d of w.doors ?? []) {
      if (d.frame !== null) buildDoorFrame(this.mb, f, d.o, d.frame ?? 'painted_wood_white', d.architrave ?? true);
    }
    // thresholds: close the floor across the wall thickness under doors and floor-level holes
    for (const o of openings) {
      if (o.bottom > 0.05) continue;
      const c = [f.ax + f.dx * o.at, f.y0 + o.bottom, f.az + f.dz * o.at];
      const ry = -Math.atan2(f.dz, f.dx);
      const hole = o.kind === 'hole';
      this.mb.pushTRS(c[0], c[1], c[2], ry);
      this.mb.box(hole ? 'concrete_int' : 'furniture_oak', 0, hole ? -0.01 : 0.004, 0, o.width + 0.02, hole ? 0.02 : 0.03, w.t + 0.02, { uv: 'local' });
      this.mb.pop();
      this.physics?.addBox({ cx: c[0], cy: c[1] - 0.1, cz: c[2], hx: o.width / 2 + 0.01, hy: 0.115, hz: w.t / 2 + 0.01, ry, surface: hole ? 'concrete' : 'wood' });
    }
    if (w.skirting !== false) {
      const skL = left ? this.skirtingFor(w, -1, f) : null;
      const skR = right ? this.skirtingFor(w, 1, f) : null;
      if (skL) buildSkirting(this.mb, def, 'left', skL);
      if (skR) buildSkirting(this.mb, def, 'right', skR);
    }
    this.frames.push({ wall: w, frame: f });
    return f;
  }

  private skirtingFor(w: KitWall, side: 1 | -1, f: WallFrame): string | null {
    const off = side * (w.t / 2 + 0.15);
    const x = f.ax + f.dx * f.len / 2 + f.rx * off, z = f.az + f.dz * f.len / 2 + f.rz * off;
    const r = this.roomAt(x, z, w.y0 + 0.5);
    if (!r) return null;
    return r.skirting === undefined ? null : r.skirting;
  }

  /** Floors and ceilings for every room (with voids for stairwells). */
  buildRoomSurfaces(): void {
    for (const r of this.rooms) {
      const slab = r.slab ?? 0.3;
      if (r.floor) for (const [x0, z0, x1, z1] of subtractRects([r.x0, r.z0, r.x1, r.z1], r.voids ?? [])) {
        buildSlab(this.mb, x0, z0, x1, z1, r.y0, slab, r.floor, null, this.physics, r.floorSurface ?? 'wood');
      }
      if (r.ceiling) for (const [x0, z0, x1, z1] of subtractRects([r.x0, r.z0, r.x1, r.z1], r.ceilVoids ?? [])) {
        this.mb.quad(r.ceiling, [x0, r.y1, z0], [x1, r.y1, z0], [x1, r.y1, z1], [x0, r.y1, z1], [0, -1, 0]);
      }
    }
  }

  door(d: DoorSpec): DoorSpec { this.doors.push(d); return d; }
  light(l: LightFixture): LightFixture { this.lights.push(l); return l; }
  span(s: InteriorSpan): void { this.spans.push(s); }
  anchor(id: string, x: number, y: number, z: number, ry = 0, room?: string): void { this.anchors.push({ id, pos: new THREE.Vector3(x, y, z), ry, room }); }

  /**
   * Helper: door leaf placed in a wall opening. `hingeSide` picks which jamb carries the hinge
   * (−1 = toward wall start a, +1 = toward b); `swingSide` the side of the wall it opens into.
   */
  doorInWall(id: string, f: WallFrame, o: Opening, leaf: Omit<DoorLeafOpts, 'width' | 'height'>, hingeSide: 1 | -1, swingSide: 1 | -1, extra: Partial<DoorSpec> = {}): DoorSpec {
    const lining = 0.03 + 0.024;
    const w = o.width - 2 * lining + 0.01;
    const s = o.at + hingeSide * (o.width / 2 - lining);
    const zoff = swingSide * (f.t / 2 - 0.035);
    const hx = f.ax + f.dx * s + f.rx * zoff, hz = f.az + f.dz * s + f.rz * zoff;
    // leaf local +x must point from hinge toward the other jamb
    const dirX = -hingeSide * f.dx, dirZ = -hingeSide * f.dz;
    const ry = Math.atan2(-dirZ, dirX);
    // local −z after rotation ry is (−sin ry, 0, −cos ry)… choose swing so the leaf opens to swingSide
    const lzx = -Math.sin(ry), lzz = -Math.cos(ry);
    const towardSwing = lzx * f.rx * swingSide + lzz * f.rz * swingSide;
    const swing: 1 | -1 = towardSwing > 0 ? 1 : -1;
    return this.door({
      id, hinge: new THREE.Vector3(hx, f.y0 + o.bottom + 0.005, hz), ry, swing,
      leaf: { ...leaf, width: w, height: o.top - o.bottom - 0.035 }, ...extra,
    });
  }

  output(group: THREE.Group): BuildingOutput {
    return { id: this.id, group, doors: this.doors, lights: this.lights, spans: this.spans, rooms: this.rooms, anchors: this.anchors };
  }
}

/** Subtract axis-aligned void rectangles from a rectangle → list of rectangles [x0,z0,x1,z1]. */
export function subtractRects(r: [number, number, number, number], voids: Rect[]): [number, number, number, number][] {
  let out: [number, number, number, number][] = [r];
  for (const v of voids) {
    const next: [number, number, number, number][] = [];
    for (const [x0, z0, x1, z1] of out) {
      if (v.x1 <= x0 || v.x0 >= x1 || v.z1 <= z0 || v.z0 >= z1) { next.push([x0, z0, x1, z1]); continue; }
      const vx0 = Math.max(x0, v.x0), vx1 = Math.min(x1, v.x1), vz0 = Math.max(z0, v.z0), vz1 = Math.min(z1, v.z1);
      if (vz0 > z0) next.push([x0, z0, x1, vz0]);
      if (vz1 < z1) next.push([x0, vz1, x1, z1]);
      if (vx0 > x0) next.push([x0, vz0, vx0, vz1]);
      if (vx1 < x1) next.push([vx1, vz0, x1, vz1]);
    }
    out = next;
  }
  return out;
}
