import * as THREE from 'three/webgpu';
import { MeshBuilder } from '../architecture/MeshBuilder';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import type { Physics } from '../../physics/Physics';

/**
 * The players' van: a late-1980s boxy transporter (T3-like), parked where the road meets
 * the estate. Body = side profile extruded across the width with rounded edges; the
 * right-hand sliding door stands open onto a cargo bay with the group's gear.
 * Local frame: +Z forward, +Y up, right-hand side = −X.
 */
const L = 4.57, W = 1.84, BEV = 0.06;
const R_WHEEL = 0.33, WB = 2.46;
const ZF = L / 2, ZR = -L / 2;
const Y_BOT = 0.36, Y_ROOF = 1.93, Y_BELT = 1.12;
/** Sliding-door opening (right side), in local z / y. */
const DOOR = { z0: -0.42, z1: 0.66, y0: 0.42, y1: 1.79 };

export interface VanOutput {
  group: THREE.Group;
  /** Headlight / interior light anchors in world space. */
  headlight: { pos: THREE.Vector3; dir: THREE.Vector3 };
  cabinLight: THREE.Vector3;
  /** Where players stand when they arrive (beside the open door), world space + facing. */
  spawn: { x: number; z: number; rot: number }[];
  /** Spots in the cargo bay for props (world space). */
  cargo: { x: number; y: number; z: number; ry: number }[];
}

function profile(): THREE.Shape {
  const s = new THREE.Shape();
  const rr = 0.16; // rear roof radius
  const wheel = (zc: number) => {
    // cut the arch into the sill (clockwise along the bottom edge, travelling rear→front)
    const r = R_WHEEL + 0.07;
    s.lineTo(zc - r, Y_BOT);
    s.absarc(zc, R_WHEEL, r, Math.PI, 0, true);
  };
  s.moveTo(ZR + 0.1, Y_BOT);
  wheel(-WB / 2);
  wheel(WB / 2);
  s.lineTo(ZF - 0.08, Y_BOT);
  s.quadraticCurveTo(ZF, Y_BOT, ZF, Y_BOT + 0.08);            // front lower corner
  s.lineTo(ZF + 0.01, 0.95);                                   // flat nose
  s.quadraticCurveTo(ZF + 0.01, 1.1, ZF - 0.04, 1.16);         // nose → windscreen
  s.lineTo(ZF - 0.36, Y_ROOF - 0.12);                          // raked windscreen
  s.quadraticCurveTo(ZF - 0.42, Y_ROOF, ZF - 0.6, Y_ROOF);
  s.lineTo(ZR + rr, Y_ROOF);
  s.quadraticCurveTo(ZR, Y_ROOF, ZR, Y_ROOF - rr);
  s.lineTo(ZR, Y_BOT + 0.1);
  s.quadraticCurveTo(ZR, Y_BOT, ZR + 0.1, Y_BOT);
  return s;
}

/** Remove the triangles of the right-hand lid (shape-space z > depth/2) from an ExtrudeGeometry. */
function dropRightLid(g: THREE.BufferGeometry, depth: number): THREE.BufferGeometry {
  const ng = g.toNonIndexed();
  const pos = ng.getAttribute('position');
  const lid = ng.groups[0];
  const keep: number[] = [];
  for (let t = 0; t < pos.count / 3; t++) {
    const i = t * 3;
    const inLid = i >= lid.start && i < lid.start + lid.count;
    if (inLid && pos.getZ(i) > depth / 2 && pos.getZ(i + 1) > depth / 2 && pos.getZ(i + 2) > depth / 2) continue;
    keep.push(i, i + 1, i + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = ng.getAttribute(name);
    const arr = new Float32Array(keep.length * a.itemSize);
    keep.forEach((src, k) => { for (let c = 0; c < a.itemSize; c++) arr[k * a.itemSize + c] = a.array[src * a.itemSize + c]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

export function buildVan(materials: MaterialLibrary, physics: Physics | undefined, x: number, z: number, heading: number, heightAt: (x: number, z: number) => number): VanOutput {
  // sit on the slope: pitch from the axle heights, roll from the left/right wheel tracks
  const f = [Math.sin(heading), Math.cos(heading)], r = [-Math.cos(heading), Math.sin(heading)];
  const hF = heightAt(x + f[0] * WB / 2, z + f[1] * WB / 2), hB = heightAt(x - f[0] * WB / 2, z - f[1] * WB / 2);
  const hR = heightAt(x + r[0] * W / 2, z + r[1] * W / 2), hL = heightAt(x - r[0] * W / 2, z - r[1] * W / 2);
  const y = (hF + hB + hR + hL) / 4 - 0.02;
  const pitch = Math.atan2(hF - hB, WB), roll = Math.atan2(hR - hL, W);
  materials.define('van_paint', { tex: 'painted_metal_cream', scale: 1, color: '#c4c2b2', exterior: true, roughnessAdd: -0.15, groundDirt: 1.4, vertexColors: true });
  materials.define('van_glass', { color: '#07090b', roughness: 0.06, exterior: true });
  materials.define('van_trim', { color: '#151515', roughness: 0.55, exterior: true });
  materials.define('van_interior', { tex: 'fabric_brown', scale: 0.5, color: '#55504a', vertexColors: true });
  materials.define('van_floor', { tex: 'rust_metal', scale: 1, color: '#6a6a6a', vertexColors: true });
  materials.define('van_chrome', { color: '#b8b8b4', roughness: 0.22, metalness: 1, exterior: true });

  const mb = new MeshBuilder();
  const depth = W - 2 * BEV;
  // ---- body shell
  const ext = new THREE.ExtrudeGeometry(profile(), { depth, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 3, curveSegments: 10, steps: 1 });
  const shell = dropRightLid(ext, depth);
  // shape space (sx, sy, sz) → van (x = depth/2 − sz, y = sy, z = sx): right side (−X) is the dropped lid
  const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(depth / 2, 0, 0));
  shell.applyMatrix4(m);
  mb.geometry('van_paint', shell);
  // right-hand panel with the sliding-door opening (flat lid replacement)
  const side = profile();
  const hole = new THREE.Path();
  hole.moveTo(DOOR.z0, DOOR.y0); hole.lineTo(DOOR.z0, DOOR.y1); hole.lineTo(DOOR.z1, DOOR.y1); hole.lineTo(DOOR.z1, DOOR.y0); hole.lineTo(DOOR.z0, DOOR.y0);
  side.holes.push(hole);
  const sg = new THREE.ShapeGeometry(side, 10);
  // ShapeGeometry lies in XY facing +Z; turn it to face −X at the right flank
  sg.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-depth / 2 - BEV, 0, 0)));
  mb.geometry('van_paint', sg);

  const xr = -W / 2 - 0.004, xl = W / 2 + 0.004;   // right / left skin planes (+ tiny offset)
  // ---- door jambs and cargo bay lining (visible through the open door)
  const jd = 0.06;
  mb.quad('van_trim', [xr + 0.004, DOOR.y0, DOOR.z0], [xr + jd, DOOR.y0, DOOR.z0], [xr + jd, DOOR.y1, DOOR.z0], [xr + 0.004, DOOR.y1, DOOR.z0], [0, 0, 1]);
  mb.quad('van_trim', [xr + jd, DOOR.y0, DOOR.z1], [xr + 0.004, DOOR.y0, DOOR.z1], [xr + 0.004, DOOR.y1, DOOR.z1], [xr + jd, DOOR.y1, DOOR.z1], [0, 0, -1]);
  mb.quad('van_trim', [xr + 0.004, DOOR.y1, DOOR.z0], [xr + jd, DOOR.y1, DOOR.z0], [xr + jd, DOOR.y1, DOOR.z1], [xr + 0.004, DOOR.y1, DOOR.z1], [0, -1, 0]);
  const bay = { x0: -W / 2 + 0.05, x1: W / 2 - 0.05, z0: ZR + 0.08, z1: 0.95, y0: 0.5, y1: Y_ROOF - 0.07 };
  {
    const { x0, x1, y0, y1, z0, z1 } = bay;
    mb.quad('van_floor', [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, 1, 0]);
    mb.quad('van_interior', [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, -1, 0]);
    mb.quad('van_interior', [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [-1, 0, 0]);
    mb.quad('van_interior', [x0, y0, DOOR.z0], [x0, y0, z0], [x0, y1, z0], [x0, y1, DOOR.z0], [1, 0, 0]);
    mb.quad('van_interior', [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, 1]);
    mb.quad('van_interior', [x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, -1]);
  }
  // step into the bay and front seat bench backs (behind the cab partition)
  mb.box('van_floor', -W / 2 + 0.14, 0.36, (DOOR.z0 + DOOR.z1) / 2, 0.26, 0.04, DOOR.z1 - DOOR.z0 - 0.04);
  mb.box('van_interior', 0, 0.95, 0.85, W - 0.16, 0.9, 0.12);
  // rear bench seat (fabric) against the back of the bay
  mb.box('van_interior', 0, 0.72, ZR + 0.55, W - 0.2, 0.18, 0.5);
  mb.box('van_interior', 0, 1.05, ZR + 0.3, W - 0.2, 0.6, 0.12);

  // ---- glazing (dark glossy) with rubber surrounds
  const sideWin = (xs: number, z0: number, z1: number, y0: number, y1: number) => {
    const n = Math.sign(xs);
    const xo = xs + n * 0.002;
    const a = [xo, y0, z0], b = [xo, y0, z1], c = [xo, y1, z1], d = [xo, y1, z0];
    if (n > 0) mb.quad('van_glass', a, d, c, b, [1, 0, 0]); else mb.quad('van_glass', a, b, c, d, [-1, 0, 0]);
    const t = 0.03;
    for (const [p0, p1] of [[[z0, y0], [z1, y0]], [[z0, y1], [z1, y1]]] as [number, number][][]) {
      mb.box('van_trim', xs + n * 0.004, p0[1], (p0[0] + p1[0]) / 2, 0.01, t, p1[0] - p0[0] + t);
    }
    mb.box('van_trim', xs + n * 0.004, (y0 + y1) / 2, z0, 0.01, y1 - y0, t);
    mb.box('van_trim', xs + n * 0.004, (y0 + y1) / 2, z1, 0.01, y1 - y0, t);
  };
  const wy0 = Y_BELT + 0.06, wy1 = Y_ROOF - 0.13;
  // cab doors
  sideWin(xl, 1.08, 1.72, wy0, wy1 - 0.02);
  sideWin(xr, 1.08, 1.72, wy0, wy1 - 0.02);
  // left flank: two big windows; right flank: window behind the door
  sideWin(xl, -0.42, 0.66, wy0, wy1);
  sideWin(xl, -1.72, -0.55, wy0, wy1);
  sideWin(xr, -1.72, -0.55, wy0, wy1);
  // rear quarter windows
  sideWin(xl, -2.12, -1.85, wy0, wy1 - 0.05);
  sideWin(xr, -2.12, -1.85, wy0, wy1 - 0.05);
  // windscreen on the raked front (between nose top and roof)
  {
    const za = ZF - 0.07, ya = 1.22, zb = ZF - 0.34, yb = Y_ROOF - 0.15, hw = W / 2 - 0.12;
    const nz = (yb - ya), ny = (za - zb), nl = Math.hypot(nz, ny);
    const off = 0.012;
    const o = (zv: number, yv: number) => [zv + (nz / nl) * off, yv + (ny / nl) * off];
    const [z0, y0] = o(za, ya), [z1, y1] = o(zb, yb);
    mb.quad('van_glass', [-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1], [0, ny / nl, nz / nl]);
    mb.beam('van_trim', new THREE.Vector3(-hw, y0, z0), new THREE.Vector3(hw, y0, z0), 0.04, 0.03);
    mb.beam('van_trim', new THREE.Vector3(-hw, y1, z1), new THREE.Vector3(hw, y1, z1), 0.04, 0.03);
    mb.beam('van_trim', new THREE.Vector3(-hw, y0, z0), new THREE.Vector3(-hw, y1, z1), 0.04, 0.03);
    mb.beam('van_trim', new THREE.Vector3(hw, y0, z0), new THREE.Vector3(hw, y1, z1), 0.04, 0.03);
    // wipers
    mb.beam('van_trim', new THREE.Vector3(-0.7, y0 + 0.03, z0 + 0.02), new THREE.Vector3(-0.15, y0 + 0.2, z0 - 0.04), 0.012, 0.012);
    mb.beam('van_trim', new THREE.Vector3(0.05, y0 + 0.03, z0 + 0.02), new THREE.Vector3(0.6, y0 + 0.2, z0 - 0.04), 0.012, 0.012);
  }
  // rear window in the tailgate
  mb.quad('van_glass', [W / 2 - 0.2, 1.2, ZR - BEV - 0.003], [-W / 2 + 0.2, 1.2, ZR - BEV - 0.003], [-W / 2 + 0.2, 1.75, ZR - BEV - 0.003], [W / 2 - 0.2, 1.75, ZR - BEV - 0.003], [0, 0, -1]);

  // ---- front: grille band, headlights, indicators, bumper, badge
  const zf = ZF + 0.012;
  mb.box('van_trim', 0, 0.8, zf, W - 0.3, 0.2, 0.02);                  // lower grille band
  mb.box('van_trim', 0, 1.06, zf - 0.03, W - 0.5, 0.08, 0.02);         // upper vent
  for (const s of [-1, 1]) {
    mb.box('van_chrome', s * 0.62, 0.8, zf + 0.012, 0.34, 0.2, 0.012);
    mb.box('headlamp', s * 0.62, 0.8, zf + 0.02, 0.3, 0.16, 0.01);
    mb.box('indicator', s * 0.62, 0.64, zf + 0.012, 0.16, 0.06, 0.012);
  }
  mb.cylinder('van_chrome', 0, 0.98, zf + 0.012, 0.1, 0.1, 0.01, 18, 'top');
  const bumper = (zc: number) => {
    mb.box('van_trim', 0, 0.45, zc, W + 0.06, 0.16, 0.14);
    for (const s of [-1, 1]) mb.box('van_trim', s * (W / 2 + 0.02), 0.45, zc - Math.sign(zc) * 0.14, 0.06, 0.15, 0.3);
  };
  bumper(ZF + 0.08);
  bumper(ZR - 0.08);
  // rear lights, number plates
  for (const s of [-1, 1]) mb.box('taillamp', s * (W / 2 - 0.14), 0.92, ZR - BEV - 0.012, 0.14, 0.28, 0.012);
  mb.box('plate', 0, 0.62, ZR - BEV - 0.012, 0.52, 0.12, 0.01);
  mb.box('plate', 0, 0.55, ZF + 0.16, 0.52, 0.12, 0.01);

  // ---- mirrors, door handles, rain gutter, sliding-door rail
  for (const s of [-1, 1]) {
    const xm = s * (W / 2 + 0.16);
    mb.beam('van_trim', new THREE.Vector3(s * W / 2, 1.22, 1.62), new THREE.Vector3(xm, 1.32, 1.66), 0.025, 0.025);
    mb.box('van_trim', xm, 1.42, 1.67, 0.06, 0.2, 0.14);
    mb.box('van_chrome', s * (W / 2 + 0.01), 1.05, 1.15, 0.02, 0.03, 0.16);
    mb.beam('van_trim', new THREE.Vector3(s * (W / 2 + 0.01), Y_ROOF - 0.05, ZR + 0.1), new THREE.Vector3(s * (W / 2 + 0.01), Y_ROOF - 0.05, ZF - 0.62), 0.025, 0.02);
  }
  mb.beam('van_trim', new THREE.Vector3(xr - 0.012, 1.2, DOOR.z1 + 0.05), new THREE.Vector3(xr - 0.012, 1.2, ZR + 0.25), 0.025, 0.03);

  // ---- the sliding door, pushed back along the rail (outside the skin)
  {
    const dz = DOOR.z1 - DOOR.z0, dy = DOOR.y1 - DOOR.y0, shift = dz - 0.06;
    const xd = xr - 0.05;
    mb.box('van_paint', xd, (DOOR.y0 + DOOR.y1) / 2, (DOOR.z0 + DOOR.z1) / 2 - shift, 0.04, dy, dz);
    sideWin(xd - 0.02, DOOR.z0 - shift + 0.06, DOOR.z1 - shift - 0.06, wy0, wy1);
    mb.box('van_chrome', xd - 0.025, 1.0, DOOR.z1 - shift - 0.08, 0.02, 0.03, 0.14);
  }

  // ---- wheels: tyre, steel rim, hub cap; slightly turned front wheels
  for (const [zc, steer] of [[WB / 2, 0.18], [-WB / 2, 0]] as [number, number][]) {
    for (const s of [-1, 1]) {
      mb.pushTRS(s * (W / 2 - 0.13), R_WHEEL, zc, steer, 1, 1, 1, 0, Math.PI / 2);
      mb.cylinder('tyre', 0, -0.1, 0, R_WHEEL, R_WHEEL, 0.2, 22, 'none');
      mb.cylinder('tyre', 0, -0.1, 0, R_WHEEL - 0.015, R_WHEEL - 0.015, 0.2, 22, 'both', 'van_trim');
      mb.cylinder('van_paint', 0, s * 0.1 - (s > 0 ? 0 : 0.004), 0, 0.2, 0.2, 0.004, 18, 'both');
      mb.cylinder('van_chrome', 0, s * 0.104 - (s > 0 ? 0 : 0.02), 0, 0.12, 0.1, 0.02, 16, 'both');
      mb.pop();
    }
  }
  // underbody shadow catcher (dark plate so the gap under the van reads as shadowed chassis)
  mb.box('van_trim', 0, Y_BOT + 0.02, 0, W - 0.1, 0.02, L - 0.3);

  materials.define('headlamp', { color: '#fff4dc', roughness: 0.1, emissive: '#ffe8c0', emissiveIntensity: 6, exterior: true });
  materials.define('indicator', { color: '#c87020', roughness: 0.2, exterior: true });
  materials.define('taillamp', { color: '#5a0c08', roughness: 0.2, emissive: '#ff2010', emissiveIntensity: 0.25, exterior: true });
  materials.define('plate', { color: '#d8d8cc', roughness: 0.5, exterior: true });
  materials.define('tyre', { color: '#1a1a1a', roughness: 0.92, exterior: true });

  const group = mb.build(materials, { name: 'van' });
  group.position.set(x, y, z);
  group.rotation.set(-pitch, heading, roll, 'YXZ');
  group.updateMatrixWorld(true);
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  group.updateMatrixWorld(true);

  const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(group.matrixWorld);
  if (physics) {
    // hull + wheels as boxes
    const c = toWorld(0, (Y_BOT + Y_ROOF) / 2 + 0.05, 0);
    physics.addBox({ cx: c.x, cy: c.y, cz: c.z, hx: W / 2, hy: (Y_ROOF - Y_BOT) / 2, hz: L / 2, ry: heading, surface: 'metal' });
  }
  const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading));
  const doorMid = toWorld(-W / 2 - 0.9, 0, (DOOR.z0 + DOOR.z1) / 2);
  const spawn = [0, 1, 2, 3, 4, 5].map((i) => {
    const along = (i % 3 - 1) * 0.9, out = Math.floor(i / 3) * 0.9;
    const p = doorMid.clone().addScaledVector(fwd, along).addScaledVector(right, out);
    return { x: p.x, z: p.z, rot: heading + Math.PI * 0.62 };
  });
  return {
    group,
    headlight: { pos: toWorld(0, 0.8, ZF + 0.1), dir: fwd.clone().add(new THREE.Vector3(0, -0.08, 0)).normalize() },
    cabinLight: toWorld(0, Y_ROOF - 0.2, -0.3),
    spawn,
    cargo: [
      { ...toWorld(0.35, 0.5, -1.1), ry: heading + 0.2 },
      { ...toWorld(0.4, 0.5, 0.1), ry: heading - 0.1 },
      { ...toWorld(-0.3, 0.5, -1.6), ry: heading + 1.4 },
    ].map((p) => ({ x: p.x, y: p.y, z: p.z, ry: p.ry })),
  };
}
