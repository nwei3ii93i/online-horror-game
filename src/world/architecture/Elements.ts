import * as THREE from 'three/webgpu';
import { MeshBuilder } from './MeshBuilder';
import { WallFrame, Opening, wallPoint } from './Walls';
import type { Physics } from '../../physics/Physics';
import { RNG } from '../../core/Random';

export interface WindowOpts {
  style: 'kasten' | 'single' | 'barn' | 'cellar' | 'small';
  /** +1 if the exterior is on the wall's right side, -1 if on the left. */
  exterior: 1 | -1;
  frameMat?: string;
  sashMat?: string;
  sillOut?: string | null;
  sillIn?: string | null;
  /** 0..1 fraction of panes broken / missing. */
  broken?: number;
  boarded?: boolean;
  shutters?: 'open' | 'closed' | 'hanging' | null;
  shutterMat?: string;
  /** Sash open angle on the inside (rad), 0 = closed. */
  ajar?: number;
  seed?: number;
  muntins?: boolean;
}

/** Local helper: transform into the opening's frame. x = along wall (centred), y = up from sill, z = toward exterior. */
function pushOpeningFrame(mb: MeshBuilder, f: WallFrame, o: Opening, exterior: 1 | -1): void {
  const c = wallPoint(f, o.at, f.y0 + o.bottom, 0);
  const ry = -Math.atan2(f.dz, f.dx);
  // local z = wall right normal; flip so +z points to the exterior
  const m = new THREE.Matrix4().makeRotationY(ry);
  if (exterior < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  m.setPosition(c[0], c[1], c[2]);
  mb.push(m);
}

/** A glazed sash (frame + panes), built in a local frame where (0,0) is its lower-left corner. */
function sash(mb: MeshBuilder, w: number, h: number, depth: number, mat: string, rng: RNG, brokenP: number, muntin: boolean): void {
  const fw = Math.min(0.055, w * 0.15);
  mb.box(mat, w / 2, fw / 2, 0, w, fw, depth, { uv: 'local' });
  mb.box(mat, w / 2, h - fw / 2, 0, w, fw, depth, { uv: 'local' });
  mb.box(mat, fw / 2, h / 2, 0, fw, h - 2 * fw, depth, { uv: 'local', uvRotate: true });
  mb.box(mat, w - fw / 2, h / 2, 0, fw, h - 2 * fw, depth, { uv: 'local', uvRotate: true });
  const gx0 = fw, gx1 = w - fw, gy0 = fw, gy1 = h - fw;
  const panes: [number, number, number, number][] = [];
  if (muntin && h > 0.6) {
    const my = gy0 + (gy1 - gy0) * 0.5;
    mb.box(mat, w / 2, my, 0, gx1 - gx0, 0.03, depth * 0.7, { uv: 'local' });
    panes.push([gx0, gy0, gx1, my - 0.015], [gx0, my + 0.015, gx1, gy1]);
  } else panes.push([gx0, gy0, gx1, gy1]);
  for (const [x0, y0, x1, y1] of panes) {
    const broken = rng.chance(brokenP);
    if (!broken) {
      mb.quad('glass', [x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    } else if (rng.chance(0.7)) {
      // jagged shards left in the putty
      const nShard = rng.int(2, 4);
      for (let k = 0; k < nShard; k++) {
        const edge = rng.int(0, 3);
        const t0 = rng.range(0.05, 0.7), t1 = t0 + rng.range(0.1, 0.3);
        const depthIn = rng.range(0.04, 0.18);
        let a: number[], b: number[], c: number[];
        if (edge === 0) { a = [x0 + (x1 - x0) * t0, y0, 0]; b = [x0 + (x1 - x0) * Math.min(1, t1), y0, 0]; c = [x0 + (x1 - x0) * (t0 + t1) / 2, y0 + depthIn, 0]; }
        else if (edge === 1) { a = [x1, y0 + (y1 - y0) * t0, 0]; b = [x1, y0 + (y1 - y0) * Math.min(1, t1), 0]; c = [x1 - depthIn, y0 + (y1 - y0) * (t0 + t1) / 2, 0]; }
        else if (edge === 2) { b = [x0 + (x1 - x0) * t0, y1, 0]; a = [x0 + (x1 - x0) * Math.min(1, t1), y1, 0]; c = [x0 + (x1 - x0) * (t0 + t1) / 2, y1 - depthIn, 0]; }
        else { b = [x0, y0 + (y1 - y0) * t0, 0]; a = [x0, y0 + (y1 - y0) * Math.min(1, t1), 0]; c = [x0 + depthIn, y0 + (y1 - y0) * (t0 + t1) / 2, 0]; }
        mb.tri('glass', a, b, c, [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]]]);
      }
    }
  }
}

/**
 * Period window inside an opening. 'kasten' = Austrian box window with an outer and an
 * inner casement pair, transom and top lights. Glass is emitted into the 'glass' part.
 */
export function buildWindow(mb: MeshBuilder, f: WallFrame, o: Opening, opts: WindowOpts): void {
  const rng = new RNG(opts.seed ?? Math.floor(o.at * 1000 + f.ax * 37 + f.az * 91));
  const W = o.width, H = o.top - o.bottom, T = f.t;
  const frameMat = opts.frameMat ?? 'painted_wood_white_ext';
  const sashMat = opts.sashMat ?? frameMat;
  const broken = opts.broken ?? 0;
  pushOpeningFrame(mb, f, o, opts.exterior);
  const fs = 0.065; // frame section
  const frameAt = (z: number, depth: number, withSashes: boolean, inner: boolean) => {
    // frame (Stock)
    mb.box(frameMat, 0, fs / 2, z, W, fs, depth, { uv: 'local' });
    mb.box(frameMat, 0, H - fs / 2, z, W, fs, depth, { uv: 'local' });
    mb.box(frameMat, -W / 2 + fs / 2, H / 2, z, fs, H - 2 * fs, depth, { uv: 'local', uvRotate: true });
    mb.box(frameMat, W / 2 - fs / 2, H / 2, z, fs, H - 2 * fs, depth, { uv: 'local', uvRotate: true });
    if (!withSashes) return;
    const iw = W - 2 * fs, ih = H - 2 * fs;
    const hasTransom = opts.style === 'kasten' && ih > 1.3;
    const transomY = hasTransom ? fs + ih * 0.72 : H;
    if (hasTransom) mb.box(frameMat, 0, transomY, z, W, 0.06, depth, { uv: 'local' });
    const lowerH = (hasTransom ? transomY - 0.03 : H - fs) - fs;
    const twoLeaves = iw > 0.7 && opts.style !== 'small' && opts.style !== 'cellar';
    const leafW = twoLeaves ? iw / 2 : iw;
    const sd = 0.045;
    for (let k = 0; k < (twoLeaves ? 2 : 1); k++) {
      const x0 = -iw / 2 + k * leafW;
      const ajar = inner && opts.ajar && k === 1 ? opts.ajar : 0;
      const hingeX = k === 0 ? x0 : x0 + leafW;
      const m = new THREE.Matrix4().makeTranslation(hingeX, fs, z - (opts.exterior ? 0 : 0))
        .multiply(new THREE.Matrix4().makeRotationY(k === 0 ? ajar : -ajar))
        .multiply(new THREE.Matrix4().makeTranslation(k === 0 ? 0 : -leafW, 0, 0));
      mb.push(m);
      sash(mb, leafW, lowerH, sd, sashMat, rng, broken, opts.muntins ?? true);
      // handle (Olive) on inner sash
      if (inner && k === 0 && twoLeaves) mb.box('brass', leafW - 0.03, lowerH * 0.5, -0.04, 0.018, 0.09, 0.03);
      mb.pop();
    }
    if (hasTransom) {
      const topH = H - fs - (transomY + 0.03);
      for (let k = 0; k < (twoLeaves ? 2 : 1); k++) {
        mb.push(new THREE.Matrix4().makeTranslation(-iw / 2 + k * leafW, transomY + 0.03, z));
        sash(mb, leafW, topH, sd, sashMat, rng, broken * 0.7, false);
        mb.pop();
      }
    }
  };

  if (opts.style === 'kasten') {
    frameAt(T / 2 - 0.09, 0.07, true, false);           // outer casements
    frameAt(-T / 2 + 0.07, 0.07, true, true);           // inner casements
  } else if (opts.style === 'barn') {
    frameAt(0, 0.06, true, false);
  } else {
    frameAt(T / 2 - 0.08, 0.07, true, true);
  }

  // sills
  if (opts.sillOut !== null) {
    const m = opts.sillOut ?? 'painted_metal_ext';
    mb.push(new THREE.Matrix4().makeTranslation(0, -0.01, T / 2 + 0.02).multiply(new THREE.Matrix4().makeRotationX(0.12)));
    mb.box(m, 0, 0, -0.06, W + 0.08, 0.012, 0.2, { uv: 'local' });
    mb.box(m, 0, -0.025, 0.04, W + 0.08, 0.05, 0.012, { uv: 'local' });
    mb.pop();
  }
  if (opts.sillIn !== null && o.bottom > 0.2) {
    const m = opts.sillIn ?? 'painted_wood_white';
    mb.box(m, 0, -0.015, -T / 2 + 0.06, W + 0.12, 0.035, 0.2, { uv: 'local' });
  }

  // boarded up (improvised repair): rough planks on the outside
  if (opts.boarded) {
    const n = Math.max(2, Math.round(H / 0.28));
    for (let k = 0; k < n; k++) {
      const y = 0.15 + (k + 0.5) * (H - 0.2) / n + rng.range(-0.04, 0.04);
      mb.push(new THREE.Matrix4().makeTranslation(rng.range(-0.05, 0.05), y, T / 2 + 0.03).multiply(new THREE.Matrix4().makeRotationZ(rng.range(-0.12, 0.12))));
      mb.withColor([0.75 + rng.float() * 0.2, 0.75 + rng.float() * 0.2, 0.7 + rng.float() * 0.2], () => {
        mb.box('rough_timber', 0, 0, 0, W + 0.35, rng.range(0.14, 0.22), 0.025, { uv: 'local', uvOffset: [rng.float() * 5, rng.float() * 5] });
      });
      mb.pop();
    }
  }

  // shutters (Fensterläden) hinged on the outside
  if (opts.shutters) {
    const smat = opts.shutterMat ?? 'painted_wood_green';
    const leafW = W / 2 + 0.02;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      let ang = 0;
      if (opts.shutters === 'open') ang = side * -Math.PI * 0.94;
      else if (opts.shutters === 'hanging') ang = k === 0 ? -Math.PI * 0.9 : Math.PI * 0.35;
      const hx = side * (W / 2 + 0.02);
      const m = new THREE.Matrix4().makeTranslation(hx, 0, T / 2 + 0.02).multiply(new THREE.Matrix4().makeRotationY(ang));
      if (opts.shutters === 'hanging' && k === 1) m.multiply(new THREE.Matrix4().makeRotationZ(0.18));
      mb.push(m);
      const cx = -side * leafW / 2;
      const nb = 4;
      for (let b = 0; b < nb; b++) {
        mb.box(smat, cx - side * (b - (nb - 1) / 2) * (leafW / nb), H / 2, 0, leafW / nb - 0.006, H, 0.028, { uv: 'local', uvRotate: true, uvOffset: [b * 0.37, k] });
      }
      mb.box(smat, cx, H * 0.2, 0.018, leafW * 0.9, 0.08, 0.02, { uv: 'local' });
      mb.box(smat, cx, H * 0.8, 0.018, leafW * 0.9, 0.08, 0.02, { uv: 'local' });
      mb.box('iron_black', cx, H * 0.2, 0.03, leafW * 0.8, 0.03, 0.006);
      mb.box('iron_black', cx, H * 0.8, 0.03, leafW * 0.8, 0.03, 0.006);
      mb.pop();
    }
  }
  mb.pop();
}

/** Door lining + architraves on both faces (the leaf is a separate, interactive object). */
export function buildDoorFrame(mb: MeshBuilder, f: WallFrame, o: Opening, mat = 'painted_wood_white', architrave = true): void {
  const W = o.width, H = o.top - o.bottom, T = f.t;
  pushOpeningFrame(mb, f, o, 1);
  const lt = 0.03; // lining thickness
  // thin walls get a full-depth wooden lining (Futter); thick masonry keeps its plastered
  // reveal with a frame set into the middle
  const LD = Math.min(T + 0.01, 0.26);
  mb.box(mat, -W / 2 + lt / 2, H / 2, 0, lt, H, LD, { uv: 'local', uvRotate: true });
  mb.box(mat, W / 2 - lt / 2, H / 2, 0, lt, H, LD, { uv: 'local', uvRotate: true });
  mb.box(mat, 0, H - lt / 2, 0, W, lt, LD, { uv: 'local' });
  // door stop
  mb.box(mat, -W / 2 + lt + 0.012, H / 2, 0, 0.024, H - lt, 0.04, { uv: 'local' });
  mb.box(mat, W / 2 - lt - 0.012, H / 2, 0, 0.024, H - lt, 0.04, { uv: 'local' });
  mb.box(mat, 0, H - lt - 0.012, 0, W - 2 * lt, 0.024, 0.04, { uv: 'local' });
  if (architrave && T < 0.4) {
    const aw = 0.09, ad = 0.022;
    for (const side of [1, -1]) {
      const z = side * (T / 2 + ad / 2);
      mb.box(mat, -W / 2 - aw / 2 + 0.01, (H + aw) / 2, z, aw, H + aw, ad, { uv: 'local', uvRotate: true });
      mb.box(mat, W / 2 + aw / 2 - 0.01, (H + aw) / 2, z, aw, H + aw, ad, { uv: 'local', uvRotate: true });
      mb.box(mat, 0, H + aw / 2 - 0.01, z, W + 2 * aw - 0.02, aw, ad, { uv: 'local' });
      // plinth blocks
      mb.box(mat, -W / 2 - aw / 2 + 0.01, 0.1, z + side * 0.006, aw + 0.012, 0.2, ad + 0.012, { uv: 'local' });
      mb.box(mat, W / 2 + aw / 2 - 0.01, 0.1, z + side * 0.006, aw + 0.012, 0.2, ad + 0.012, { uv: 'local' });
    }
  }
  mb.pop();
}

export interface DoorLeafOpts {
  width: number;
  height: number;
  thickness?: number;
  style: 'panel4' | 'panel2' | 'glazed' | 'plank' | 'ledged' | 'flush';
  mat: string;
  handle?: 'lever' | 'knob' | 'ring' | 'none';
  handleMat?: string;
  /** Hinge on the local left (x=0) — leaf extends to +x. */
  seed?: number;
}

/** Door leaf in hinge-local space: hinge axis at x=0, leaf spans x∈[0,width], centred in z. */
export function buildDoorLeaf(mb: MeshBuilder, o: DoorLeafOpts): void {
  const W = o.width, H = o.height, D = o.thickness ?? 0.042;
  const m = o.mat;
  const st = 0.11;
  if (o.style === 'plank' || o.style === 'ledged') {
    const n = Math.max(3, Math.round(W / 0.14));
    const rng = new RNG(o.seed ?? 3);
    for (let k = 0; k < n; k++) {
      const bw = W / n;
      mb.box(m, (k + 0.5) * bw, H / 2, 0, bw - 0.004, H, D, { uv: 'local', uvRotate: true, uvOffset: [rng.float() * 3, 0] });
    }
    // ledges and brace on the back
    for (const y of [0.25, H - 0.3]) mb.box(m, W / 2, y, -D / 2 - 0.012, W - 0.06, 0.12, 0.025, { uv: 'local' });
    const a = new THREE.Vector3(0.08, 0.3, -D / 2 - 0.012), b = new THREE.Vector3(W - 0.08, H - 0.36, -D / 2 - 0.012);
    mb.beam(m, a, b, 0.1, 0.025, new THREE.Vector3(0, 0, 1));
  } else if (o.style === 'flush') {
    mb.box(m, W / 2, H / 2, 0, W, H, D, { uv: 'local', uvRotate: true });
  } else {
    // stiles and rails
    mb.box(m, st / 2, H / 2, 0, st, H, D, { uv: 'local', uvRotate: true });
    mb.box(m, W - st / 2, H / 2, 0, st, H, D, { uv: 'local', uvRotate: true });
    mb.box(m, W / 2, 0.11, 0, W - 2 * st, 0.22, D, { uv: 'local' });
    mb.box(m, W / 2, H - st / 2, 0, W - 2 * st, st, D, { uv: 'local' });
    const lockRail = H * 0.45;
    mb.box(m, W / 2, lockRail, 0, W - 2 * st, 0.16, D, { uv: 'local' });
    const iw = W - 2 * st;
    const panels: [number, number, number, number][] = [];
    if (o.style === 'panel4') {
      mb.box(m, W / 2, lockRail / 2 + 0.11 / 2 + 0.03, 0, 0.08, lockRail - 0.3, D, { uv: 'local', uvRotate: true });
      mb.box(m, W / 2, (lockRail + H) / 2, 0, 0.08, H - lockRail - 0.2, D, { uv: 'local', uvRotate: true });
      const hw = (iw - 0.08) / 2;
      panels.push([st, 0.22, st + hw, lockRail - 0.08], [st + hw + 0.08, 0.22, W - st, lockRail - 0.08]);
      panels.push([st, lockRail + 0.08, st + hw, H - st], [st + hw + 0.08, lockRail + 0.08, W - st, H - st]);
    } else {
      panels.push([st, 0.22, W - st, lockRail - 0.08], [st, lockRail + 0.08, W - st, H - st]);
    }
    panels.forEach(([x0, y0, x1, y1], k) => {
      const glazed = o.style === 'glazed' && y0 > lockRail;
      if (glazed) {
        mb.quad('glass', [x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, 1], [[x0, y0], [x1, y1], [x1, y1], [x0, y1]]);
        mb.box(m, (x0 + x1) / 2, (y0 + y1) / 2, 0, 0.025, y1 - y0, D * 0.6, { uv: 'local' });
        return;
      }
      // recessed field with raised centre (bevel approximated by stepped boxes)
      const pd = D * 0.45;
      mb.box(m, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, pd, { uv: 'local', uvRotate: true, uvOffset: [k * 0.3, 0] });
      mb.box(m, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0 - 0.07, y1 - y0 - 0.07, pd + 0.012, { uv: 'local', uvRotate: true, uvOffset: [k * 0.3, 0] });
      // small moulding bead
      for (const s of [1, -1]) {
        mb.box(m, (x0 + x1) / 2, y0 + 0.006, s * (pd / 2 + 0.004), x1 - x0, 0.012, 0.012);
        mb.box(m, (x0 + x1) / 2, y1 - 0.006, s * (pd / 2 + 0.004), x1 - x0, 0.012, 0.012);
      }
    });
  }
  // hinges
  for (const y of [0.25, H - 0.25]) mb.cylinder('iron_black', 0, y - 0.06, 0, 0.012, 0.012, 0.12, 6);
  // furniture
  const hm = o.handleMat ?? 'brass';
  const hy = 1.02;
  const hx = W - 0.075;
  if (o.handle !== 'none') {
    for (const s of [1, -1]) {
      const z = s * (D / 2 + 0.003);
      mb.box(hm, hx, hy - 0.05, z, 0.045, 0.24, 0.006);   // escutcheon plate
      mb.box('black_soot', hx, hy - 0.11, z + s * 0.0035, 0.008, 0.02, 0.002); // keyhole
      if (o.handle === 'knob') mb.cylinder(hm, hx, hy, z + s * 0.035, 0.026, 0.022, 0.02, 10);
      else if (o.handle === 'ring') mb.box(hm, hx, hy - 0.05, z + s * 0.02, 0.07, 0.07, 0.01);
      else {
        // lever: neck + grip pointing toward the hinge
        mb.box(hm, hx, hy, z + s * 0.03, 0.02, 0.02, 0.06);
        mb.box(hm, hx - 0.06, hy, z + s * 0.058, 0.12, 0.018, 0.018);
      }
    }
  }
}

/** Floor slab: top surface, optional ceiling underneath and edges. Rectangles in world XZ. */
export function buildSlab(mb: MeshBuilder, x0: number, z0: number, x1: number, z1: number, yTop: number, thickness: number,
  topMat: string | null, bottomMat: string | null, physics?: Physics, surface = 'wood'): void {
  if (topMat) mb.quad(topMat, [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], [x0, yTop, z0], [0, 1, 0]);
  if (bottomMat) mb.quad(bottomMat, [x0, yTop - thickness, z0], [x1, yTop - thickness, z0], [x1, yTop - thickness, z1], [x0, yTop - thickness, z1], [0, -1, 0]);
  if (physics) physics.addBox({ cx: (x0 + x1) / 2, cy: yTop - thickness / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: thickness / 2, hz: (z1 - z0) / 2, surface });
}

export interface StairDef {
  /** Bottom-front centre of the first step. */
  x: number; z: number; y: number;
  /** Direction of ascent (radians around Y, 0 = toward −Z / north). */
  dir: number;
  width: number;
  rise: number;      // total height
  steps: number;
  run?: number;      // tread depth
  treadMat: string;
  riserMat: string;
  stringerMat?: string;
  /** Side walls / balustrade. */
  rail?: 'left' | 'right' | 'both' | null;
  railMat?: string;
  closedBelow?: boolean;
  surface?: string;
}

/** Straight flight of stairs with treads, risers, stringers, optional handrail; ramp collider. */
export function buildStairs(mb: MeshBuilder, d: StairDef, physics?: Physics): void {
  const run = d.run ?? 0.27;
  const sh = d.rise / d.steps;
  const len = run * d.steps;
  mb.pushTRS(d.x, d.y, d.z, d.dir);
  // local: -z = ascent direction
  for (let i = 0; i < d.steps; i++) {
    const y = (i + 1) * sh;
    const zc = -(i + 0.5) * run;
    mb.box(d.treadMat, 0, y - 0.02, zc - 0.01, d.width, 0.04, run + 0.03, { uv: 'local', uvOffset: [i * 0.37, i * 0.11] });
    mb.box(d.riserMat, 0, y - sh / 2 - 0.02, -i * run + 0.005, d.width - 0.01, sh - 0.04, 0.02, { uv: 'local' });
    if (d.closedBelow) mb.box(d.riserMat, 0, (y - 0.04) / 2, zc, d.width - 0.02, y - 0.04, run, { skip: ['py', 'pz', 'nz'] });
  }
  // stringers
  const sm = d.stringerMat ?? d.treadMat;
  for (const sx of [-d.width / 2 - 0.03, d.width / 2 + 0.03]) {
    const a = new THREE.Vector3(sx, 0.12, 0.05), b = new THREE.Vector3(sx, d.rise + 0.12, -len);
    mb.beam(sm, a, b, 0.05, 0.28, new THREE.Vector3(1, 0, 0));
  }
  if (d.rail) {
    const rm = d.railMat ?? sm;
    const sides = d.rail === 'both' ? [-1, 1] : d.rail === 'left' ? [-1] : [1];
    for (const s of sides) {
      const x = s * (d.width / 2 + 0.03);
      const a = new THREE.Vector3(x, 0.95, 0), b = new THREE.Vector3(x, d.rise + 0.95, -len);
      mb.beam(rm, a, b, 0.06, 0.05, new THREE.Vector3(1, 0, 0));
      for (let i = 0; i <= d.steps; i += 1) {
        const y = i * sh;
        mb.box(rm, x, y + 0.48, -i * run + (i === 0 ? -0.05 : 0.0), 0.028, 0.95, 0.028);
      }
      mb.box(rm, x, 0.55, 0, 0.09, 1.1, 0.09);
      mb.box(rm, x, d.rise + 0.55, -len, 0.09, 1.1, 0.09);
    }
  }
  mb.pop();
  if (physics) {
    const slopeLen = Math.hypot(len, d.rise);
    const ang = Math.atan2(d.rise, len);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, d.dir, 0, 'YXZ'));
    const cLocal = new THREE.Vector3(0, d.rise / 2 - 0.05, -len / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.dir);
    physics.addBox({ cx: d.x + cLocal.x, cy: d.y + cLocal.y, cz: d.z + cLocal.z, hx: d.width / 2, hy: 0.05, hz: slopeLen / 2, q: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: d.surface ?? 'wood' });
  }
}
