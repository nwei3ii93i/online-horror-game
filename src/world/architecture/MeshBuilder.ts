import * as THREE from 'three/webgpu';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';

interface Part {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  aux: number[];
  idx: number[];
}

export type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type BoxMats = string | Partial<Record<FaceKey, string | null>> & { default?: string };

export interface BoxOpts {
  /** 'world' projects UVs from world position (seamless across pieces), 'local' from the box's own frame. */
  uv?: 'world' | 'local';
  /** Skip these faces entirely. */
  skip?: FaceKey[];
  /** Extra UV offset (metres) to decorrelate repeated props. */
  uvOffset?: [number, number];
  /** Rotate UVs 90° on side faces (grain running vertically on horizontal boards etc.). */
  uvRotate?: boolean;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/**
 * Accumulates triangles per material key. Geometry is authored in metres; UVs are
 * metres too, the material decides tiling. Supports a transform stack so props can
 * be authored in local space and placed anywhere.
 */
export class MeshBuilder {
  private parts = new Map<string, Part>();
  private stack: THREE.Matrix4[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private identity = true;
  color: [number, number, number] = [1, 1, 1];
  /** Free per-vertex scalar (vegetation: bend weight 0 = rigid … 1 = tip). */
  aux = 0;
  /** Write the `aux` attribute into built geometries. */
  emitAux = false;

  part(mat: string): Part {
    let p = this.parts.get(mat);
    if (!p) { p = { pos: [], nor: [], uv: [], col: [], aux: [], idx: [] }; this.parts.set(mat, p); }
    return p;
  }

  hasContent(): boolean { for (const p of this.parts.values()) if (p.idx.length) return true; return false; }

  // ------------------------------------------------------------------ transform
  push(m: THREE.Matrix4): this {
    this.stack.push(this.m.clone());
    this.m.multiply(m);
    this.nm.getNormalMatrix(this.m);
    this.identity = false;
    return this;
  }

  pushTRS(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz),
    );
    return this.push(m);
  }

  pop(): this {
    this.m.copy(this.stack.pop() ?? new THREE.Matrix4());
    this.nm.getNormalMatrix(this.m);
    this.identity = this.stack.length === 0;
    return this;
  }

  /** Run fn with a temporary transform. */
  with(x: number, y: number, z: number, ry: number, fn: () => void, sx = 1, sy = 1, sz = 1): void {
    this.pushTRS(x, y, z, ry, sx, sy, sz);
    try { fn(); } finally { this.pop(); }
  }

  withColor(c: [number, number, number] | null, fn: () => void): void {
    const prev = this.color;
    if (c) this.color = c;
    try { fn(); } finally { this.color = prev; }
  }

  // ------------------------------------------------------------------ primitives
  private vert(p: Part, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    if (!this.identity) {
      _v.set(x, y, z).applyMatrix4(this.m);
      _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
      x = _v.x; y = _v.y; z = _v.z; nx = _n.x; ny = _n.y; nz = _n.z;
    }
    const i = p.pos.length / 3;
    p.pos.push(x, y, z);
    p.nor.push(nx, ny, nz);
    p.uv.push(u, v);
    p.col.push(this.color[0], this.color[1], this.color[2]);
    p.aux.push(this.aux);
    return i;
  }

  /** World-projected UV from a world-space point and normal (box projection). */
  static worldUV(x: number, y: number, z: number, nx: number, ny: number, nz: number): [number, number] {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return ny > 0 ? [x, -z] : [x, z];
    if (ax >= az) return nx > 0 ? [-z, y] : [z, y];
    return nz > 0 ? [x, y] : [-x, y];
  }

  /**
   * Quad with explicit corners (counter-clockwise when seen from the front) and a normal.
   * UVs are computed per vertex: 'world' (after transform) or provided explicitly.
   */
  quad(mat: string, a: number[], b: number[], c: number[], d: number[], n: number[], uvs?: number[][] | 'world', uvOffset: [number, number] = [0, 0]): void {
    const p = this.part(mat);
    const corners = [a, b, c, d];
    const idx: number[] = [];
    for (let k = 0; k < 4; k++) {
      const q = corners[k];
      let u = 0, v = 0;
      if (uvs === 'world' || !uvs) {
        if (this.identity) [u, v] = MeshBuilder.worldUV(q[0], q[1], q[2], n[0], n[1], n[2]);
        else {
          _v.set(q[0], q[1], q[2]).applyMatrix4(this.m);
          _n.set(n[0], n[1], n[2]).applyMatrix3(this.nm).normalize();
          [u, v] = MeshBuilder.worldUV(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z);
        }
      } else { u = uvs[k][0]; v = uvs[k][1]; }
      idx.push(this.vert(p, q[0], q[1], q[2], n[0], n[1], n[2], u + uvOffset[0], v + uvOffset[1]));
    }
    p.idx.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
  }

  tri(mat: string, a: number[], b: number[], c: number[], uvs?: number[][]): void {
    const p = this.part(mat);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const pts = [a, b, c];
    const ids = pts.map((q, k) => {
      let u: number, v: number;
      if (uvs) { u = uvs[k][0]; v = uvs[k][1]; }
      else {
        if (this.identity) [u, v] = MeshBuilder.worldUV(q[0], q[1], q[2], nx, ny, nz);
        else {
          _v.set(q[0], q[1], q[2]).applyMatrix4(this.m);
          _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
          [u, v] = MeshBuilder.worldUV(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z);
        }
      }
      return this.vert(p, q[0], q[1], q[2], nx, ny, nz, u, v);
    });
    p.idx.push(ids[0], ids[1], ids[2]);
  }

  /**
   * Axis-aligned (in current frame) box from centre and size. Per-face materials.
   */
  box(mats: BoxMats, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: BoxOpts = {}): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const mat = (k: FaceKey): string | null => {
      if (typeof mats === 'string') return mats;
      const v = mats[k];
      if (v === null) return null;
      return v ?? mats.default ?? null;
    };
    const skip = opts.skip ?? [];
    const local = opts.uv === 'local';
    const off = opts.uvOffset ?? [0, 0];
    const rot = opts.uvRotate;
    const face = (k: FaceKey, a: number[], b: number[], c: number[], d: number[], n: number[], luv: number[][]) => {
      if (skip.includes(k)) return;
      const m = mat(k);
      if (!m) return;
      let uvs: number[][] | 'world' = 'world';
      if (local) uvs = rot ? luv.map(([u, v]) => [v, u]) : luv;
      this.quad(m, a, b, c, d, n, uvs, off);
    };
    // +X
    face('px', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
    // -X
    face('nx', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    // +Y
    face('py', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
    // -Y
    face('ny', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    // +Z
    face('pz', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    // -Z
    face('nz', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
  }

  /** Box between two corners (current frame). */
  boxMinMax(mats: BoxMats, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, opts?: BoxOpts): void {
    this.box(mats, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), opts);
  }

  /** Oriented beam between two 3D points with square/rect cross-section. */
  beam(mat: string, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, up = new THREE.Vector3(0, 1, 0), opts: BoxOpts = { uv: 'local', uvRotate: false }): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    let side = new THREE.Vector3().crossVectors(up, dir);
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0).cross(dir);
    side.normalize();
    const u2 = new THREE.Vector3().crossVectors(dir, side).normalize();
    // local: x = side, y = u2, z = dir
    const m = new THREE.Matrix4().makeBasis(side, u2, dir).setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    this.push(m);
    this.box(mat, 0, 0, 0, w, h, len, opts);
    this.pop();
  }

  /** Cylinder / cone frustum along Y. */
  cylinder(mat: string, cx: number, y0: number, cz: number, rBottom: number, rTop: number, height: number, segments = 12, caps: 'both' | 'top' | 'bottom' | 'none' = 'both', capMat?: string, uvOffset: [number, number] = [0, 0]): void {
    const p = this.part(mat);
    const base = p.pos.length / 3;
    const slope = (rBottom - rTop) / height;
    const circ = 2 * Math.PI * Math.max(rBottom, rTop);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nl = Math.hypot(1, slope);
      const nx = ca / nl, ny = slope / nl, nz = sa / nl;
      const u = (i / segments) * circ + uvOffset[0];
      this.vert(p, cx + ca * rBottom, y0, cz + sa * rBottom, nx, ny, nz, u, y0 + uvOffset[1]);
      this.vert(p, cx + ca * rTop, y0 + height, cz + sa * rTop, nx, ny, nz, u, y0 + height + uvOffset[1]);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      p.idx.push(a, b, c, c, b, d);
    }
    const cm = capMat ?? mat;
    const cap = (y: number, r: number, up: boolean) => {
      if (r <= 0) return;
      const q = this.part(cm);
      const center = this.vert(q, cx, y, cz, 0, up ? 1 : -1, 0, cx, cz);
      const first = q.pos.length / 3;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        this.vert(q, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0, up ? 1 : -1, 0, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      }
      for (let i = 0; i < segments; i++) {
        if (up) q.idx.push(center, first + i + 1, first + i);
        else q.idx.push(center, first + i, first + i + 1);
      }
    };
    if (caps === 'both' || caps === 'top') cap(y0 + height, rTop, true);
    if (caps === 'both' || caps === 'bottom') cap(y0, rBottom, false);
  }

  /** Cylinder between two points (pipes, rods, branches). */
  rod(mat: string, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, segments = 8, caps: 'both' | 'none' = 'both'): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-5) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.push(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    this.cylinder(mat, 0, 0, 0, r0, r1, len, segments, caps === 'both' ? 'both' : 'none');
    this.pop();
  }

  /**
   * Generalised tube along a polyline with per-point radius (tree trunks, branches, roots).
   * UV: u around the circumference in metres, v along the path in metres. Optional per-point aux.
   */
  tube(mat: string, pts: THREE.Vector3[], radii: number[], sides = 8, aux?: number[], capEnd = false): void {
    if (pts.length < 2) return;
    const p = this.part(mat);
    const base = p.pos.length / 3;
    // parallel-transport frames
    let t = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
    let n = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(t).normalize() : new THREE.Vector3(1, 0, 0).cross(t).normalize();
    let b = new THREE.Vector3().crossVectors(t, n);
    let along = 0;
    const prevAux = this.aux;
    for (let k = 0; k < pts.length; k++) {
      if (k > 0) {
        const nt = new THREE.Vector3().subVectors(pts[Math.min(k + 1, pts.length - 1)], pts[k - 1]).normalize();
        const axis = new THREE.Vector3().crossVectors(t, nt);
        const ang = Math.asin(Math.min(1, axis.length()));
        if (ang > 1e-5) { axis.normalize(); n.applyAxisAngle(axis, ang); b.applyAxisAngle(axis, ang); }
        t = nt;
        along += pts[k].distanceTo(pts[k - 1]);
      }
      const r = radii[k];
      const circ = 2 * Math.PI * Math.max(r, 0.01);
      if (aux) this.aux = aux[k];
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = n.x * ca + b.x * sa, ny = n.y * ca + b.y * sa, nz = n.z * ca + b.z * sa;
        this.vert(p, pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r, nx, ny, nz, (i / sides) * circ, along);
      }
    }
    const R = sides + 1;
    for (let k = 0; k < pts.length - 1; k++) for (let i = 0; i < sides; i++) {
      const a0 = base + k * R + i, a1 = a0 + 1, b0 = a0 + R, b1 = b0 + 1;
      p.idx.push(a0, b0, a1, a1, b0, b1);
    }
    if (capEnd) {
      const last = pts[pts.length - 1];
      const c = this.vert(p, last.x, last.y, last.z, t.x, t.y, t.z, 0, along);
      const s0 = base + (pts.length - 1) * R;
      for (let i = 0; i < sides; i++) p.idx.push(s0 + i, c, s0 + i + 1);
    }
    this.aux = prevAux;
  }

  /** Surface of revolution around Y from a profile of [radius, y] points. */
  lathe(mat: string, profile: [number, number][], segments = 16, uvScale = 1): void {
    const p = this.part(mat);
    const base = p.pos.length / 3;
    // arc length along profile for v
    const sArr = [0];
    for (let k = 1; k < profile.length; k++) sArr.push(sArr[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < profile.length; k++) {
        const [r, y] = profile[k];
        const prev = profile[Math.max(0, k - 1)], next = profile[Math.min(profile.length - 1, k + 1)];
        const dr = next[0] - prev[0], dy = next[1] - prev[1];
        const l = Math.hypot(dr, dy) || 1;
        const nr = dy / l, ny = -dr / l;
        this.vert(p, ca * r, y, sa * r, ca * nr, ny, sa * nr, (i / segments) * Math.PI * 2 * Math.max(0.05, r) * uvScale, sArr[k] * uvScale);
      }
    }
    const P = profile.length;
    for (let i = 0; i < segments; i++) for (let k = 0; k < P - 1; k++) {
      const a = base + i * P + k, b = a + 1, c = a + P, d = c + 1;
      p.idx.push(a, b, c, c, b, d);
    }
  }

  /** Sweep a 2D profile ([side, up] pairs, CCW) along a 3D polyline. For mouldings, gutters, rails. */
  sweep(mat: string, profile: [number, number][], path: THREE.Vector3[], up = new THREE.Vector3(0, 1, 0), closedProfile = true): void {
    const p = this.part(mat);
    const base = p.pos.length / 3;
    const P = profile.length + (closedProfile ? 1 : 0);
    let s = 0;
    for (let k = 0; k < path.length; k++) {
      const prev = path[Math.max(0, k - 1)], next = path[Math.min(path.length - 1, k + 1)];
      const t = new THREE.Vector3().subVectors(next, prev).normalize();
      const side = new THREE.Vector3().crossVectors(t, up).normalize();
      const u2 = new THREE.Vector3().crossVectors(side, t).normalize();
      // mitre scale at corners
      let scale = 1;
      if (k > 0 && k < path.length - 1) {
        const t0 = new THREE.Vector3().subVectors(path[k], prev).normalize();
        const t1 = new THREE.Vector3().subVectors(next, path[k]).normalize();
        scale = 1 / Math.max(0.5, Math.cos(t0.angleTo(t1) / 2));
      }
      if (k > 0) s += path[k].distanceTo(path[k - 1]);
      for (let j = 0; j < P; j++) {
        const [px, py] = profile[j % profile.length];
        const pos = path[k].clone().addScaledVector(side, px * scale).addScaledVector(u2, py);
        const [qx, qy] = profile[(j + 1) % profile.length];
        const [ox, oy] = profile[(j - 1 + profile.length) % profile.length];
        const ex = qx - ox, ey = qy - oy;
        const n = side.clone().multiplyScalar(ey).addScaledVector(u2, -ex).normalize();
        const v = j / profile.length;
        this.vert(p, pos.x, pos.y, pos.z, n.x, n.y, n.z, s, v * 0.2);
      }
    }
    for (let k = 0; k < path.length - 1; k++) for (let j = 0; j < P - 1; j++) {
      const a = base + k * P + j, b = a + 1, c = a + P, d = c + 1;
      p.idx.push(a, c, b, b, c, d);
    }
  }

  /** Append an existing BufferGeometry (positions/normals/uvs) under the current transform. */
  geometry(mat: string, g: THREE.BufferGeometry, uvScale = 1): void {
    const p = this.part(mat);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const base = p.pos.length / 3;
    for (let i = 0; i < pos.count; i++) {
      this.vert(p, pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0, uv ? uv.getX(i) * uvScale : 0, uv ? uv.getY(i) * uvScale : 0);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) p.idx.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) p.idx.push(base + i);
  }

  /** Merge another builder's content into this one (respecting the current transform). */
  append(other: MeshBuilder): void {
    for (const [mat, src] of other.parts) {
      const p = this.part(mat);
      const base = p.pos.length / 3;
      for (let i = 0; i < src.pos.length / 3; i++) {
        let x = src.pos[i * 3], y = src.pos[i * 3 + 1], z = src.pos[i * 3 + 2];
        let nx = src.nor[i * 3], ny = src.nor[i * 3 + 1], nz = src.nor[i * 3 + 2];
        if (!this.identity) {
          _v.set(x, y, z).applyMatrix4(this.m); x = _v.x; y = _v.y; z = _v.z;
          _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize(); nx = _n.x; ny = _n.y; nz = _n.z;
        }
        p.pos.push(x, y, z); p.nor.push(nx, ny, nz);
        p.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
        p.col.push(src.col[i * 3], src.col[i * 3 + 1], src.col[i * 3 + 2]);
        p.aux.push(src.aux[i] ?? 0);
      }
      for (const i of src.idx) p.idx.push(base + i);
    }
  }

  // ------------------------------------------------------------------ output
  /** Build geometries per material. */
  geometries(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [mat, p] of this.parts) {
      if (!p.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      if (this.emitAux) g.setAttribute('aux', new THREE.Float32BufferAttribute(p.aux, 1));
      const vc = p.pos.length / 3;
      g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(p.idx, 1) : new THREE.Uint16BufferAttribute(p.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(mat, g);
    }
    return out;
  }

  /** Build a group with one mesh per material. */
  build(materials: MaterialLibrary, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = opts.name ?? 'built';
    for (const [mat, g] of this.geometries()) {
      const material = mat === 'glass' ? materials.getGlass() : materials.get(mat);
      const mesh = new THREE.Mesh(g, material);
      mesh.name = `${group.name}:${mat}`;
      mesh.castShadow = opts.castShadow ?? mat !== 'glass';
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    return group;
  }

  clear(): void { this.parts.clear(); }

  stats(): { vertices: number; triangles: number; materials: number } {
    let v = 0, t = 0;
    for (const p of this.parts.values()) { v += p.pos.length / 3; t += p.idx.length / 3; }
    return { vertices: v, triangles: t, materials: this.parts.size };
  }
}

void _m3;
