import * as THREE from 'three/webgpu';
import { MeshBuilder } from './MeshBuilder';
import type { Physics } from '../../physics/Physics';

export interface RoofDef {
  type: 'hip' | 'gable' | 'shed' | 'gable_x' | 'gable_z';
  /** Wall-plate rectangle (outer wall faces). */
  x0: number; z0: number; x1: number; z1: number;
  /** Height of the wall plate (eaves line before overhang). */
  eaveY: number;
  pitch: number;               // radians
  overhang?: number;
  thickness?: number;
  tileMat?: string;
  innerMat?: string | null;    // underside (attic boards); null = none
  fasciaMat?: string;
  ridgeMat?: string;
  gutters?: boolean;
  gutterMat?: string;
  /** Shed roof: which side is high ('n' | 's' | 'e' | 'w'). */
  shedHigh?: 'n' | 's' | 'e' | 'w';
  rafters?: { mat: string; spacing: number; size: number } | null;
  /** Holes (chimneys) – rectangles in XZ that the roof is NOT cut for; chimneys are built separately. */
}

export interface RoofInfo {
  /** Inner roof surface height at (x,z) — used for the interior map. */
  innerHeight: (x: number, z: number) => number;
  ridgeY: number;
}

/**
 * Builds pitched roofs from a rectangular wall plate. Roof planes are thick slabs with
 * tiled upper faces whose UVs run up the slope (tile rows stay horizontal), fascia boards,
 * half-round ridge/hip caps, gutters and the visible rafter structure on the inside.
 */
export function buildRoof(mb: MeshBuilder, r: RoofDef, physics?: Physics): RoofInfo {
  const oh = r.overhang ?? 0.5;
  const th = r.thickness ?? 0.22;
  const tile = r.tileMat ?? 'roof_tiles';
  const inner = r.innerMat === undefined ? 'rough_timber' : r.innerMat;
  const fascia = r.fasciaMat ?? 'painted_wood_brown_ext';
  const tan = Math.tan(r.pitch);
  const X0 = r.x0 - oh, X1 = r.x1 + oh, Z0 = r.z0 - oh, Z1 = r.z1 + oh;
  const eave = r.eaveY - oh * tan; // eaves drop with the overhang
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  let type = r.type;
  if (type === 'gable') type = w >= d ? 'gable_x' : 'gable_z';

  // Height function of the TOP surface over the extended rectangle.
  const topH = (x: number, z: number): number => {
    const ex = Math.min(x - X0, X1 - x), ez = Math.min(z - Z0, Z1 - z);
    if (type === 'hip') return eave + tan * Math.min(ex, ez);
    if (type === 'gable_x') return eave + tan * ez;
    if (type === 'gable_z') return eave + tan * ex;
    // shed
    const hs = r.shedHigh ?? 'n';
    const t = hs === 'n' ? (Z1 - z) : hs === 's' ? (z - Z0) : hs === 'e' ? (x - X0) : (X1 - x);
    return eave + tan * t;
  };
  const span = type === 'gable_x' ? (Z1 - Z0) / 2 : type === 'gable_z' ? (X1 - X0) / 2 : type === 'hip' ? Math.min(X1 - X0, Z1 - Z0) / 2 : (type === 'shed' && (r.shedHigh === 'n' || r.shedHigh === 's') ? Z1 - Z0 : X1 - X0);
  const ridgeY = eave + tan * span;
  const vThick = th / Math.cos(r.pitch);

  // Planes as polygons (top surface corners), each with its downslope direction.
  type Plane = { pts: [number, number][]; down: [number, number] };
  const planes: Plane[] = [];
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  if (type === 'hip') {
    const hw = (X1 - X0) / 2, hd = (Z1 - Z0) / 2;
    if (hw >= hd) {
      const rx0 = X0 + hd, rx1 = X1 - hd;
      planes.push({ pts: [[X0, Z1], [X1, Z1], [rx1, cz], [rx0, cz]], down: [0, 1] });  // south
      planes.push({ pts: [[X1, Z0], [X0, Z0], [rx0, cz], [rx1, cz]], down: [0, -1] }); // north
      planes.push({ pts: [[X1, Z1], [X1, Z0], [rx1, cz]], down: [1, 0] });              // east
      planes.push({ pts: [[X0, Z0], [X0, Z1], [rx0, cz]], down: [-1, 0] });             // west
    } else {
      const rz0 = Z0 + hw, rz1 = Z1 - hw;
      planes.push({ pts: [[X1, Z1], [X1, Z0], [cx, rz0], [cx, rz1]], down: [1, 0] });
      planes.push({ pts: [[X0, Z0], [X0, Z1], [cx, rz1], [cx, rz0]], down: [-1, 0] });
      planes.push({ pts: [[X0, Z1], [X1, Z1], [cx, rz1]], down: [0, 1] });
      planes.push({ pts: [[X1, Z0], [X0, Z0], [cx, rz0]], down: [0, -1] });
    }
  } else if (type === 'gable_x') {
    planes.push({ pts: [[X0, Z1], [X1, Z1], [X1, cz], [X0, cz]], down: [0, 1] });
    planes.push({ pts: [[X1, Z0], [X0, Z0], [X0, cz], [X1, cz]], down: [0, -1] });
  } else if (type === 'gable_z') {
    planes.push({ pts: [[X1, Z1], [X1, Z0], [cx, Z0], [cx, Z1]], down: [1, 0] });
    planes.push({ pts: [[X0, Z0], [X0, Z1], [cx, Z1], [cx, Z0]], down: [-1, 0] });
  } else {
    const hs = r.shedHigh ?? 'n';
    const down: [number, number] = hs === 'n' ? [0, 1] : hs === 's' ? [0, -1] : hs === 'e' ? [-1, 0] : [1, 0];
    planes.push({ pts: [[X0, Z1], [X1, Z1], [X1, Z0], [X0, Z0]], down });
  }

  for (const pl of planes) {
    const pts3 = pl.pts.map(([x, z]) => [x, topH(x, z), z]);
    // UV: u along the eave (perpendicular to down), v up the slope (metres along the surface)
    const [dx, dz] = pl.down;
    const ux = -dz, uz = dx; // along eave
    const uvOf = (p: number[]) => {
      const along = p[0] * ux + p[2] * uz;
      const upSlope = -(p[0] * dx + p[2] * dz) / Math.cos(r.pitch);
      return [along, upSlope];
    };
    const n = new THREE.Vector3(dx * Math.sin(r.pitch), Math.cos(r.pitch), dz * Math.sin(r.pitch));
    const tri = (a: number[], b: number[], c: number[]) => {
      // ensure CCW for normal n
      const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const e2 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const cr = new THREE.Vector3().crossVectors(e1, e2);
      if (cr.dot(n) < 0) [b, c] = [c, b];
      mb.tri(tile, a, b, c, [uvOf(a), uvOf(b), uvOf(c)]);
      if (inner) {
        const lo = (p: number[]) => [p[0], p[1] - vThick, p[2]];
        mb.tri(inner, lo(a), lo(c), lo(b), [uvOf(a), uvOf(c), uvOf(b)]);
      }
    };
    tri(pts3[0], pts3[1], pts3[2]);
    if (pts3.length === 4) tri(pts3[0], pts3[2], pts3[3]);
    // fascia / edge along the eave (first two points)
    const a = pts3[0], b = pts3[1];
    mb.quad(fascia, [b[0], b[1] - vThick - 0.04, b[2]], [a[0], a[1] - vThick - 0.04, a[2]], [a[0], a[1] + 0.02, a[2]], [b[0], b[1] + 0.02, b[2]], [dx, 0, dz]);
    if (physics) {
      // thin oriented box per plane (keeps players off roofs, blocks rays)
      const c = new THREE.Vector3();
      pts3.forEach((p) => c.add(new THREE.Vector3(p[0], p[1], p[2])));
      c.multiplyScalar(1 / pts3.length);
      const along = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const ex = new THREE.Vector3(ux, 0, uz).normalize();
      const ey = n.clone().normalize();
      const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ey, ez));
      const slopeLen = span / Math.cos(r.pitch);
      physics.addBox({ cx: c.x - ey.x * vThick / 2, cy: c.y - ey.y * vThick / 2, cz: c.z - ey.z * vThick / 2, hx: along / 2, hy: vThick / 2, hz: slopeLen / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'tile' });
    }
  }

  // gable end walls (triangles) are built by the building itself (masonry); add bargeboards
  if (type === 'gable_x' || type === 'gable_z') {
    const along = type === 'gable_x';
    for (const e of [0, 1]) {
      const edge = along ? (e === 0 ? X0 : X1) : (e === 0 ? Z0 : Z1);
      const p0 = along ? new THREE.Vector3(edge, eave, Z0) : new THREE.Vector3(X0, eave, edge);
      const p1 = along ? new THREE.Vector3(edge, ridgeY, cz) : new THREE.Vector3(cx, ridgeY, edge);
      const p2 = along ? new THREE.Vector3(edge, eave, Z1) : new THREE.Vector3(X1, eave, edge);
      const off = new THREE.Vector3(0, -0.06, 0);
      mb.beam(fascia, p0.clone().add(off), p1.clone().add(off), 0.04, 0.24, new THREE.Vector3(along ? 1 : 0, 0, along ? 0 : 1));
      mb.beam(fascia, p1.clone().add(off), p2.clone().add(off), 0.04, 0.24, new THREE.Vector3(along ? 1 : 0, 0, along ? 0 : 1));
      // verge tiles edge
      mb.beam(tile, p0.clone().add(new THREE.Vector3(0, 0.03, 0)), p1.clone().add(new THREE.Vector3(0, 0.03, 0)), 0.08, 0.05, new THREE.Vector3(0, 1, 0));
      mb.beam(tile, p1.clone().add(new THREE.Vector3(0, 0.03, 0)), p2.clone().add(new THREE.Vector3(0, 0.03, 0)), 0.08, 0.05, new THREE.Vector3(0, 1, 0));
    }
  }

  // ridge & hip caps (half-round tiles)
  const ridgeMat = r.ridgeMat ?? tile;
  const capLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    mb.push(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    // half cylinder along local z
    const segs = 6, rad = 0.13;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
      const p0 = [Math.cos(a0) * rad, Math.sin(a0) * rad * 0.8, 0], p1 = [Math.cos(a1) * rad, Math.sin(a1) * rad * 0.8, 0];
      const nrm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
      mb.quad(ridgeMat, [p1[0], p1[1], 0], [p0[0], p0[1], 0], [p0[0], p0[1], len], [p1[0], p1[1], len], nrm, [[a1 * 0.3, 0], [a0 * 0.3, 0], [a0 * 0.3, len], [a1 * 0.3, len]]);
    }
    mb.pop();
  };
  const up = 0.02;
  if (type === 'hip') {
    const hw = (X1 - X0) / 2, hd = (Z1 - Z0) / 2;
    if (hw >= hd) {
      const rx0 = X0 + hd, rx1 = X1 - hd;
      capLine(new THREE.Vector3(rx0, ridgeY + up, cz), new THREE.Vector3(rx1, ridgeY + up, cz));
      for (const [x, z, rx] of [[X0, Z0, rx0], [X0, Z1, rx0], [X1, Z0, rx1], [X1, Z1, rx1]] as const) capLine(new THREE.Vector3(x, eave + up, z), new THREE.Vector3(rx, ridgeY + up, cz));
    } else {
      const rz0 = Z0 + hw, rz1 = Z1 - hw;
      capLine(new THREE.Vector3(cx, ridgeY + up, rz0), new THREE.Vector3(cx, ridgeY + up, rz1));
      for (const [x, z, rz] of [[X0, Z0, rz0], [X1, Z0, rz0], [X0, Z1, rz1], [X1, Z1, rz1]] as const) capLine(new THREE.Vector3(x, eave + up, z), new THREE.Vector3(cx, ridgeY + up, rz));
    }
  } else if (type === 'gable_x') capLine(new THREE.Vector3(X0, ridgeY + up, cz), new THREE.Vector3(X1, ridgeY + up, cz));
  else if (type === 'gable_z') capLine(new THREE.Vector3(cx, ridgeY + up, Z0), new THREE.Vector3(cx, ridgeY + up, Z1));

  // gutters along the eaves of downward planes
  if (r.gutters !== false) {
    const gm = r.gutterMat ?? 'rust_metal';
    const prof: [number, number][] = [[-0.07, 0.06], [-0.07, 0.0], [-0.04, -0.06], [0.04, -0.06], [0.07, 0.0], [0.07, 0.06], [0.06, 0.06], [0.06, 0.0], [0.035, -0.05], [-0.035, -0.05], [-0.06, 0.0], [-0.06, 0.06]];
    const gut = (a: THREE.Vector3, b: THREE.Vector3) => mb.sweep(gm, prof, [a, b], new THREE.Vector3(0, 1, 0), true);
    const gy = eave - vThick - 0.02;
    const g = 0.09;
    if (type === 'hip' || type === 'gable_x' || (type === 'shed' && (r.shedHigh === 'n' || r.shedHigh === 's'))) {
      if (type !== 'shed' || r.shedHigh === 'n') gut(new THREE.Vector3(X0, gy, Z1 + g), new THREE.Vector3(X1, gy, Z1 + g));
      if (type !== 'shed' || r.shedHigh === 's') gut(new THREE.Vector3(X1, gy, Z0 - g), new THREE.Vector3(X0, gy, Z0 - g));
    }
    if (type === 'hip' || type === 'gable_z' || (type === 'shed' && (r.shedHigh === 'e' || r.shedHigh === 'w'))) {
      if (type !== 'shed' || r.shedHigh === 'w') gut(new THREE.Vector3(X1 + g, gy, Z1), new THREE.Vector3(X1 + g, gy, Z0));
      if (type !== 'shed' || r.shedHigh === 'e') gut(new THREE.Vector3(X0 - g, gy, Z0), new THREE.Vector3(X0 - g, gy, Z1));
    }
  }

  // rafters (visible in attics)
  if (r.rafters) {
    const { mat, spacing, size } = r.rafters;
    if (type === 'gable_x' || type === 'hip') {
      for (let x = r.x0 + 0.3; x <= r.x1 - 0.3; x += spacing) {
        for (const [ze, s] of [[r.z0, 1], [r.z1, -1]] as const) {
          const zR = cz;
          let hTop = topH(x, zR);
          if (type === 'hip') hTop = Math.min(hTop, topH(x, cz));
          const a = new THREE.Vector3(x, topH(x, ze) - vThick - size / 2, ze);
          const b = new THREE.Vector3(x, hTop - vThick - size / 2, zR - s * 0.0);
          if (b.y - a.y > 0.3) mb.beam(mat, a, b, size * 0.6, size, new THREE.Vector3(1, 0, 0));
        }
      }
      // collar ties
      for (let x = r.x0 + 0.3; x <= r.x1 - 0.3; x += spacing * 2) {
        const y = r.eaveY + (ridgeY - r.eaveY) * 0.62;
        const zoff = (ridgeY - y) / tan;
        mb.box(mat, x, y, cz, size * 0.5, size * 0.8, zoff * 2, { uv: 'local' });
      }
    } else if (type === 'gable_z') {
      for (let z = r.z0 + 0.3; z <= r.z1 - 0.3; z += spacing) {
        for (const [xe] of [[r.x0], [r.x1]] as const) {
          const a = new THREE.Vector3(xe, topH(xe, z) - vThick - size / 2, z);
          const b = new THREE.Vector3(cx, topH(cx, z) - vThick - size / 2, z);
          mb.beam(mat, a, b, size * 0.6, size, new THREE.Vector3(0, 0, 1));
        }
      }
    }
  }

  return {
    innerHeight: (x: number, z: number) => topH(x, z) - vThick,
    ridgeY,
  };
}

/** Brick chimney stack from y0 up through the roof, with corbelled top and cap. */
export function buildChimney(mb: MeshBuilder, x: number, z: number, y0: number, top: number, sx = 0.6, sz = 0.5, mat = 'brick'): void {
  mb.box(mat, x, (y0 + top) / 2, z, sx, top - y0, sz, { skip: ['ny'] });
  mb.box(mat, x, top + 0.08, z, sx + 0.12, 0.16, sz + 0.12);
  mb.box('concrete', x, top + 0.2, z, sx + 0.08, 0.06, sz + 0.08);
  // flue pots
  mb.cylinder('rust_metal', x - sx * 0.2, top + 0.23, z, 0.09, 0.08, 0.28, 8, 'none');
}

/** Gable-end triangle infill (masonry) between eave and ridge for gable roofs. */
export function buildGableInfill(mb: MeshBuilder, along: 'x' | 'z', edge: number, from: number, to: number, eaveY: number, ridgeY: number, t: number, outMat: string, inMat: string, outward: 1 | -1): void {
  const mid = (from + to) / 2;
  const P = (s: number, y: number, o: number): number[] => along === 'x' ? [s, y, edge + o] : [edge + o, y, s];
  const nOut = along === 'x' ? [0, 0, outward] : [outward, 0, 0];
  const nIn = nOut.map((v) => -v);
  const oo = outward * t / 2, oi = -outward * t / 2;
  const a = P(from, eaveY, oo), b = P(to, eaveY, oo), c = P(mid, ridgeY, oo);
  const ai = P(from, eaveY, oi), bi = P(to, eaveY, oi), ci = P(mid, ridgeY, oi);
  const triOriented = (mat: string, p: number[], q: number[], r: number[], n: number[]) => {
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) mb.tri(mat, p, r, q); else mb.tri(mat, p, q, r);
  };
  triOriented(outMat, a, b, c, nOut);
  triOriented(inMat, ai, bi, ci, nIn);
}
