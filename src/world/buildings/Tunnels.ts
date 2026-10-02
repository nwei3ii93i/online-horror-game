import * as THREE from 'three/webgpu';
import { BuildingKit, BuildingOutput } from '../architecture/BuildingKit';
import type { FaceSpec } from '../architecture/Walls';
import type { MeshBuilder } from '../architecture/MeshBuilder';
import type { Physics } from '../../physics/Physics';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import { RNG } from '../../core/Random';
import { TUNNELS } from '../Layout';
import {
  V, defineMaterials, TUNNEL_MATS, spanFromInner, pipe, flange, puddle, heap, scatterBlocks, wallPatch, drainGrate, orientedQuad,
} from './BuildingDetails';

/**
 * Underground passages of Gut Waldegg (Layout.TUNNELS):
 *  - "Heizgang 1958": cast-concrete service tunnel from the manor's iron basement door
 *    (west wall, z = −24.5, outer face x = −13) west to x = −27.5, then north to the pump-house
 *    basement (south wall z = −48). Heating loop and water main on brackets, Josef's 1993
 *    generator cable clamped to the ceiling, drains, puddles, damp walls.
 *  - Coal gallery (1923, brick barrel vault) branching west at z = −34, partly collapsed and
 *    propped with timber (a short CROUCH stretch, 1.30 m), ending at a bricked-up face.
 *
 * Height: the ground above is ≈ 0 m, so with the floor at −2.05 the layout's nominal 2.15 m
 * cannot be met underground. The concrete tunnel gets 1.90 m clear (ceiling −0.15, 0.10 m slab
 * top just under the turf); where `heightAt` dips lower the ceiling steps down in sections (never
 * below 1.82 m). Next to the manor door a 1.4 m head chamber is raised to −0.02 so the door
 * leaf (top −0.08) clears it when it swings in; its concrete lid shows 0.1 m above ground.
 * The coal gallery is lower (crown 1.80 m, springing 1.20 m).
 *
 * INTEGRATION — World.build():  this.add(buildTunnels(this.physics, this.materials, (x, z) => this.terrain.heightAt(x, z)));
 * (see the header of Outbuildings.ts for the complete list; documents log_1988_q1 / drawing_2001
 * are in story/OutbuildingDocs.ts, the lantern in props/OutbuildingProps.ts). The pump-house end
 * wall with its steel door is built by buildPumpHouse(); build both.
 *
 * Anchors (decals): 'stencil_heizgang', 'stencil_pumpe', 'stencil_kohle', 'tunnel_shelf', 'tunnel_traps'.
 */

type HeightFn = (x: number, z: number) => number;
interface Section { a: number; b: number; c: number }

const svc = TUNNELS.find((t) => t.id === 'service')!;
const coalDef = TUNNELS.find((t) => t.id === 'coal')!;

export const TUNNEL = {
  F: svc.y,
  T: 0.25,
  /** Design ceiling of the concrete tunnel (1.90 m clear) and its slab. */
  CEIL: svc.y + 1.9, SLAB: 0.1, MIN_CLEAR: 1.82,
  /** Raised head chamber at the manor door. */
  HEAD_CEIL: svc.y + 2.03, HEAD_LEN: 1.4, HEAD_RECESS: 0.3,
  /** Coal gallery vault (above floor). */
  SPRING: 1.2, CROWN: 1.8,
  /** Collapsed, timbered stretch of the coal gallery (crouch). */
  COLLAPSE: { x0: -32.37, x1: -31.13, clear: 1.3 },
} as const;

/** Interior geometry derived from Layout.TUNNELS (two straight legs + a side gallery). */
function tunnelGeometry() {
  const hw = svc.width / 2, T = TUNNEL.T;
  const [ax, az] = svc.points[0];
  const [bx] = svc.points[1];
  const [, cz] = svc.points[2];
  const L1 = { x0: bx - hw, x1: ax, z0: az - hw, z1: az + hw };                 // west run incl. the corner
  const L2 = { x0: bx - hw, x1: bx + hw, z0: cz, z1: az - hw };                 // north run to the pump house
  const HEAD = { x0: ax - TUNNEL.HEAD_LEN, x1: ax, z0: L1.z0 - TUNNEL.HEAD_RECESS, z1: L1.z1 };
  const chw = coalDef.width / 2;
  const gz = coalDef.points[0][1];
  const G = { x0: coalDef.points[1][0], x1: L2.x0 - T, z0: gz - chw, z1: gz + chw, zc: gz };
  return { hw, ax, az, bx, cz, L1, L2, HEAD, G };
}
export const TUNNEL_GEOMETRY = tunnelGeometry();

export function buildTunnels(physics: Physics | undefined, materials: MaterialLibrary, heightAt: HeightFn): BuildingOutput {
  defineMaterials(materials, TUNNEL_MATS);
  defineMaterials(materials, { candle_wax: { color: '#d6ccb2', roughness: 0.55 } });
  const kit = new BuildingKit('tunnels', physics, { mat: 'tunnel_wall' });
  const mb = kit.mb;
  const rng = new RNG('tunnels');
  const { F, T, SLAB } = TUNNEL;
  const { ax, L1, L2, HEAD, G } = TUNNEL_GEOMETRY;
  const wallIn: FaceSpec = { mat: 'tunnel_wall', dado: { mat: 'tunnel_wall_damp', h: 0.45 } };
  const brickIn: FaceSpec = { mat: 'tunnel_brick', dado: { mat: 'tunnel_wall_damp', h: 0.3 } };

  // ------------------------------------------------------------------ ceiling sections (follow the terrain)
  const groundMin = (x0: number, x1: number, z0: number, z1: number): number => {
    let m = Infinity;
    for (let x = x0; x <= x1 + 1e-6; x += Math.max(0.2, (x1 - x0) / 8)) for (let z = z0; z <= z1 + 1e-6; z += Math.max(0.2, (z1 - z0) / 8)) m = Math.min(m, heightAt(x, z));
    return m;
  };
  const ceilFor = (g: number): number => {
    const c = Math.floor((g - SLAB) / 0.04) * 0.04;
    return Math.max(F + TUNNEL.MIN_CLEAR, Math.min(TUNNEL.CEIL, c));
  };
  const makeSections = (lo: number, hi: number, cross: (a: number, b: number) => number): Section[] => {
    const n = Math.max(1, Math.round((hi - lo) / 1.5));
    const raw: Section[] = [];
    for (let i = 0; i < n; i++) {
      const a = lo + ((hi - lo) * i) / n, b = lo + ((hi - lo) * (i + 1)) / n;
      raw.push({ a, b, c: ceilFor(cross(a, b)) });
    }
    const out: Section[] = [];
    for (const s of raw) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.c - s.c) < 1e-6) last.b = s.b; else out.push({ ...s });
    }
    return out;
  };
  const s1 = makeSections(L1.x0, HEAD.x0, (a, b) => groundMin(a - 0.3, b + 0.3, L1.z0 - T - 0.1, L1.z1 + T + 0.1));
  const s2 = makeSections(L2.z0, L2.z1, (a, b) => groundMin(L2.x0 - T - 0.1, L2.x1 + T + 0.1, a - 0.3, b + 0.3));
  const ceil1 = (x: number): number => (x >= HEAD.x0 ? TUNNEL.HEAD_CEIL : (s1.find((s) => x >= s.a - 1e-6 && x <= s.b + 1e-6) ?? s1[0]).c);
  const ceil2 = (z: number): number => (s2.find((s) => z >= s.a - 1e-6 && z <= s.b + 1e-6) ?? s2[s2.length - 1]).c;
  const top1 = Math.max(...s1.map((s) => s.c)), top2 = Math.max(...s2.map((s) => s.c));

  // coal gallery vault, lowered if the ground above it is low
  const gGround = groundMin(G.x0, G.x1, G.z0 - T, G.z1 + T);
  const drop = Math.max(0, F + TUNNEL.CROWN + 0.14 - gGround);
  const ys = F + TUNNEL.SPRING - drop, yc = F + TUNNEL.CROWN - drop;
  const va = G.z1 - G.zc, vr = yc - ys;
  const R = (va * va + vr * vr) / (2 * vr), vcy = yc - R;
  const phi0 = Math.asin((ys - vcy) / R);
  const arc = (k: number, n: number): [number, number] => {
    const p = phi0 + ((Math.PI - 2 * phi0) * k) / n;
    return [G.zc + R * Math.cos(p), vcy + R * Math.sin(p)];
  };
  const vaultY = (dz: number): number => vcy + Math.sqrt(Math.max(0, R * R - dz * dz));

  // ------------------------------------------------------------------ rooms
  kit.room({ id: 'tunnel_west', location: 'tunnel', x0: L1.x0, z0: HEAD.z0, x1: L1.x1, z1: L1.z1, y0: F, y1: TUNNEL.CEIL, floor: null, ceiling: null, wall: wallIn, skirting: null, env: 'tunnel', floorSurface: 'concrete' });
  kit.room({ id: 'tunnel_north', location: 'tunnel', x0: L2.x0, z0: L2.z0, x1: L2.x1, z1: L2.z1, y0: F, y1: TUNNEL.CEIL, floor: null, ceiling: null, wall: wallIn, skirting: null, env: 'tunnel', floorSurface: 'concrete' });
  kit.room({ id: 'tunnel_coal', location: 'tunnel', x0: G.x0, z0: G.z0, x1: L2.x0, z1: G.z1, y0: F, y1: yc, floor: null, ceiling: null, wall: brickIn, skirting: null, env: 'tunnel', floorSurface: 'gravel' });

  // ------------------------------------------------------------------ floors
  const floor = (x0: number, z0: number, x1: number, z1: number, mat: string, surface: string) => {
    mb.quad(mat, [x0, F, z1], [x1, F, z1], [x1, F, z0], [x0, F, z0], [0, 1, 0]);
    physics?.addBox({ cx: (x0 + x1) / 2, cy: F - 0.15, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: 0.15, hz: (z1 - z0) / 2, surface });
  };
  floor(L1.x0, L1.z0, L1.x1, L1.z1, 'tunnel_floor', 'concrete');
  floor(HEAD.x0, HEAD.z0, HEAD.x1, L1.z0, 'tunnel_floor', 'concrete');
  floor(L2.x0, L2.z0, L2.x1, L2.z1, 'tunnel_floor', 'concrete');
  floor(G.x0, G.z0, G.x1, G.z1, 'coal_floor', 'gravel');

  // ------------------------------------------------------------------ walls (outer faces are buried: not drawn)
  const common = { y0: F, t: T, cap: 'tunnel_wall', noTop: true, skirting: false, surface: 'concrete' };
  kit.wall({ ...common, a: [L1.x0 - T, L1.z1 + T / 2], b: [ax, L1.z1 + T / 2], y1: TUNNEL.HEAD_CEIL, left: wallIn, right: null });            // west run, south side
  kit.wall({ ...common, a: [ax, HEAD.z0 - T / 2], b: [HEAD.x0 - T, HEAD.z0 - T / 2], y1: TUNNEL.HEAD_CEIL, left: wallIn, right: null });   // head chamber, north
  kit.wall({ ...common, a: [HEAD.x0 - T / 2, L1.z0], b: [HEAD.x0 - T / 2, HEAD.z0 - T], y1: TUNNEL.HEAD_CEIL, left: null, right: wallIn });  // recess end
  kit.wall({ ...common, a: [HEAD.x0, L1.z0 - T / 2], b: [L2.x1, L1.z0 - T / 2], y1: top1, left: wallIn, right: null });                    // west run, north side
  kit.wall({ ...common, a: [L2.x1 + T / 2, L1.z0], b: [L2.x1 + T / 2, L2.z0], y1: Math.max(top2, top1), left: wallIn, right: null });      // north run, east side
  kit.wall({
    ...common, a: [L2.x0 - T / 2, L1.z1], b: [L2.x0 - T / 2, L2.z0], y1: Math.max(top1, top2), left: null, right: wallIn,                   // north run, west side + gallery mouth
    openings: [{ at: L1.z1 - G.zc, width: G.z1 - G.z0, bottom: 0, top: yc - F, kind: 'hole' }],
  });
  const brick = { ...common, cap: 'tunnel_brick', surface: 'stone' };
  kit.wall({ ...brick, a: [G.x0 - T, G.z1 + T / 2], b: [G.x1, G.z1 + T / 2], y1: ys, left: brickIn, right: null });
  kit.wall({ ...brick, a: [G.x1, G.z0 - T / 2], b: [G.x0 - T, G.z0 - T / 2], y1: ys, left: brickIn, right: null });

  // ------------------------------------------------------------------ ceilings with steps between sections
  const ceilQuad = (x0: number, z0: number, x1: number, z1: number, c: number) => {
    mb.quad('tunnel_ceiling', [x0, c, z0], [x1, c, z0], [x1, c, z1], [x0, c, z1], [0, -1, 0]);
  };
  ceilQuad(HEAD.x0, HEAD.z0, HEAD.x1, HEAD.z1, TUNNEL.HEAD_CEIL);
  physics?.addBox({ cx: (HEAD.x0 + HEAD.x1) / 2 - T / 2, cy: TUNNEL.HEAD_CEIL + 0.06, cz: (HEAD.z0 + HEAD.z1) / 2, hx: (HEAD.x1 - HEAD.x0 + T) / 2, hy: 0.06, hz: (HEAD.z1 - HEAD.z0) / 2 + T, surface: 'concrete' });
  for (const s of s1) {
    ceilQuad(s.a, L1.z0, s.b, L1.z1, s.c);
    physics?.addBox({ cx: (s.a + s.b) / 2, cy: s.c + SLAB / 2, cz: (L1.z0 + L1.z1) / 2, hx: (s.b - s.a) / 2, hy: SLAB / 2, hz: (L1.z1 - L1.z0) / 2 + T, surface: 'concrete' });
  }
  for (const s of s2) {
    ceilQuad(L2.x0, s.a, L2.x1, s.b, s.c);
    physics?.addBox({ cx: (L2.x0 + L2.x1) / 2, cy: s.c + SLAB / 2, cz: (s.a + s.b) / 2, hx: (L2.x1 - L2.x0) / 2 + T, hy: SLAB / 2, hz: (s.b - s.a) / 2, surface: 'concrete' });
  }
  // step faces (down-stands) where the ceiling height changes
  const stepX = (x: number, cLo: number, cHi: number, higherSide: 1 | -1) => {
    if (Math.abs(cHi - cLo) < 1e-4) return;
    orientedQuad(mb, 'tunnel_ceiling', [x, cLo, L1.z0], [x, cLo, L1.z1], [x, cHi, L1.z1], [x, cHi, L1.z0], [higherSide, 0, 0]);
  };
  const stepZ = (z: number, cLo: number, cHi: number, higherSide: 1 | -1) => {
    if (Math.abs(cHi - cLo) < 1e-4) return;
    orientedQuad(mb, 'tunnel_ceiling', [L2.x0, cLo, z], [L2.x1, cLo, z], [L2.x1, cHi, z], [L2.x0, cHi, z], [0, 0, higherSide]);
  };
  const last1 = s1[s1.length - 1];
  stepX(HEAD.x0, last1.c, TUNNEL.HEAD_CEIL, 1);
  for (let i = 0; i < s1.length - 1; i++) {
    const p = s1[i], q = s1[i + 1];
    stepX(p.b, Math.min(p.c, q.c), Math.max(p.c, q.c), q.c > p.c ? 1 : -1);
  }
  for (let i = 0; i < s2.length - 1; i++) {
    const p = s2[i], q = s2[i + 1];
    stepZ(p.b, Math.min(p.c, q.c), Math.max(p.c, q.c), q.c > p.c ? 1 : -1);
  }
  const corner = s1[0].c, first2 = s2[s2.length - 1].c;
  stepZ(L2.z1, Math.min(corner, first2), Math.max(corner, first2), corner > first2 ? 1 : -1);

  // concrete lid of the head chamber, flush against the manor wall (shows above the gravel)
  const lidTop = TUNNEL.HEAD_CEIL + 0.12;
  mb.box('concrete', (HEAD.x0 - T + HEAD.x1) / 2, (TUNNEL.HEAD_CEIL + lidTop) / 2, (HEAD.z0 - T + HEAD.z1 + T) / 2, HEAD.x1 - HEAD.x0 + T, lidTop - TUNNEL.HEAD_CEIL, HEAD.z1 - HEAD.z0 + 2 * T, { skip: ['px', 'ny'] });
  for (const z of [HEAD.z0 + 0.2, HEAD.z1 - 0.2]) mb.rod('iron_black', V(HEAD.x0 + 0.5, lidTop, z), V(HEAD.x0 + 0.5, lidTop + 0.025, z), 0.03, 0.03, 8);

  // ------------------------------------------------------------------ manor end: concrete facing round the iron door
  const dz0 = svc.points[0][1] - 0.55, dz1 = svc.points[0][1] + 0.55, dTop = F + 2.0;
  const fx = ax - 0.003;
  orientedQuad(mb, 'tunnel_wall', [fx, F, HEAD.z0], [fx, F, dz0], [fx, TUNNEL.HEAD_CEIL, dz0], [fx, TUNNEL.HEAD_CEIL, HEAD.z0], [-1, 0, 0]);
  orientedQuad(mb, 'tunnel_wall', [fx, F, dz1], [fx, F, HEAD.z1], [fx, TUNNEL.HEAD_CEIL, HEAD.z1], [fx, TUNNEL.HEAD_CEIL, dz1], [-1, 0, 0]);
  orientedQuad(mb, 'tunnel_wall', [fx, dTop, dz0], [fx, dTop, dz1], [fx, TUNNEL.HEAD_CEIL, dz1], [fx, TUNNEL.HEAD_CEIL, dz0], [-1, 0, 0]);
  for (const z of [dz0 - 0.025, dz1 + 0.025]) mb.box('rust_metal_int', fx - 0.006, (F + dTop + 0.05) / 2, z, 0.012, dTop + 0.05 - F, 0.05);
  mb.box('rust_metal_int', fx - 0.006, dTop + 0.0, (dz0 + dz1) / 2, 0.012, 0.03, dz1 - dz0 + 0.1);

  // ------------------------------------------------------------------ coal gallery: vault, mouth, collapse, bricked-up end
  const NA = 14;
  for (let k = 0; k < NA; k++) {
    const [z0, y0] = arc(k, NA), [z1, y1] = arc(k + 1, NA);
    const sm = (Math.PI - 2 * phi0) * R;
    const v0 = (k / NA) * sm, v1 = ((k + 1) / NA) * sm;
    const pm = phi0 + ((Math.PI - 2 * phi0) * (k + 0.5)) / NA;
    orientedQuad(mb, 'tunnel_brick', [G.x0, y0, z0], [G.x1, y0, z0], [G.x1, y1, z1], [G.x0, y1, z1], [0, -Math.sin(pm), -Math.cos(pm)], [[G.x0, v0], [G.x1, v0], [G.x1, v1], [G.x0, v1]]);
    // spandrel at the mouth (fills the rectangular opening above the arch) and the bricked-up end below it
    orientedQuad(mb, 'tunnel_brick', [G.x1, y0, z0], [G.x1, y1, z1], [G.x1, yc, z1], [G.x1, yc, z0], [1, 0, 0]);
    orientedQuad(mb, 'tunnel_brick_new', [G.x0, ys, z0], [G.x0, ys, z1], [G.x0, y1, z1], [G.x0, y0, z0], [1, 0, 0]);
  }
  orientedQuad(mb, 'tunnel_brick_new', [G.x0, F, G.z0], [G.x0, F, G.z1], [G.x0, ys, G.z1], [G.x0, ys, G.z0], [1, 0, 0]);
  physics?.addBox({ cx: G.x0 - T / 2, cy: (F + yc) / 2, cz: G.zc, hx: T / 2, hy: (yc - F) / 2, hz: (G.z1 - G.z0) / 2 + T, surface: 'stone' });
  // vault collider: three bands per side follow the arc
  for (const [d0, d1] of [[0, 0.25], [0.25, 0.5], [0.5, va]] as [number, number][]) {
    const y = vaultY((d0 + d1) / 2);
    for (const s of d0 === 0 ? [0] : [-1, 1]) {
      const zc = d0 === 0 ? G.zc : G.zc + s * (d0 + d1) / 2;
      const hz = d0 === 0 ? d1 : (d1 - d0) / 2;
      physics?.addBox({ cx: (G.x0 + G.x1) / 2, cy: y + 0.15, cz: zc, hx: (G.x1 - G.x0) / 2, hy: 0.15, hz, surface: 'stone' });
    }
  }
  // the missing bricks near the top of the blocking wall (a black gap) and what fell out of it
  mb.quad('black_soot', [G.x0 + 0.002, ys + 0.12, G.zc - 0.42], [G.x0 + 0.002, ys + 0.12, G.zc - 0.12], [G.x0 + 0.002, ys + 0.26, G.zc - 0.14], [G.x0 + 0.002, ys + 0.24, G.zc - 0.4], [1, 0, 0]);
  scatterBlocks(mb, 'tunnel_brick_new', G.x0 + 0.05, G.zc - 0.6, G.x0 + 0.5, G.zc - 0.15, F, 5, rng);
  // collapse: two timber sets with lagging; rubble heaps along the walls (crouch through here)
  const C = TUNNEL.COLLAPSE;
  const capY = F + C.clear;
  for (const x of [C.x0 + 0.07, C.x1 - 0.07]) {
    for (const z of [G.z0 + 0.08, G.z1 - 0.08]) mb.box('rough_timber', x, (F + capY) / 2, z, 0.14, capY - F, 0.14, { uv: 'local', uvRotate: true, uvOffset: [x, z] });
    mb.box('rough_timber', x, capY + 0.07, G.zc, 0.14, 0.14, G.z1 - G.z0 - 0.02, { uv: 'local', uvOffset: [x, 0] });
  }
  for (let k = 0; k < 7; k++) {
    const z = G.z0 + 0.12 + k * ((G.z1 - G.z0 - 0.24) / 6);
    mb.box('rough_timber', (C.x0 + C.x1) / 2, capY + 0.155 + (k % 2) * 0.004, z, C.x1 - C.x0 + 0.1, 0.03, 0.16, { uv: 'local', uvOffset: [k * 0.6, 0] });
  }
  for (let k = 0; k < 9; k++) {
    // bricks hanging out of the broken vault above the lagging
    const z = rng.range(G.z0 + 0.2, G.z1 - 0.2), x = rng.range(C.x0 + 0.1, C.x1 - 0.1);
    mb.pushTRS(x, Math.min(vaultY(z - G.zc) - 0.06, capY + 0.5), z, rng.range(0, 3), 1, 1, 1, rng.range(-0.6, 0.6), rng.range(-0.4, 0.4));
    mb.box('tunnel_brick', 0, 0, 0, 0.24, 0.07, 0.115, { uv: 'local' });
    mb.pop();
  }
  physics?.addBox({ cx: (C.x0 + C.x1) / 2, cy: (capY + yc + 0.3) / 2, cz: G.zc, hx: (C.x1 - C.x0) / 2, hy: (yc + 0.3 - capY) / 2, hz: (G.z1 - G.z0) / 2, surface: 'wood' });
  for (const s of [-1, 1]) {
    heap(mb, 'coal_floor', (C.x0 + C.x1) / 2 - 0.2, F, G.zc + s * (va - 0.12), 0.75, 0.2, 0.22, rng, 12, 3);
    scatterBlocks(mb, 'tunnel_brick', C.x0 - 0.4, G.zc + s * (va - 0.32), C.x1 + 0.3, G.zc + s * (va - 0.08), F, 8, rng);
  }
  scatterBlocks(mb, 'tunnel_brick', C.x0, G.zc - 0.3, C.x1, G.zc + 0.3, F, 4, rng);
  // coal remains at the end, candle stubs below the drawing (the lantern is a prop)
  heap(mb, 'coal', G.x0 + 0.45, F, G.z1 - 0.3, 0.42, 0.26, 0.32, rng, 12, 4);
  scatterBlocks(mb, 'coal', G.x0 + 0.3, G.z1 - 0.7, G.x0 + 1.4, G.z1 - 0.1, F, 16, rng, [0.08, 0.05, 0.07]);
  for (const [z, h] of [[G.zc - 0.05, 0.05], [G.zc + 0.06, 0.03], [G.zc + 0.14, 0.07]]) {
    mb.cylinder('candle_wax', G.x0 + 0.12, F, z, 0.022, 0.02, h, 8);
    mb.cylinder('candle_wax', G.x0 + 0.12, F, z, 0.04, 0.04, 0.004, 10);
    mb.rod('black_soot', V(G.x0 + 0.12, F + h, z), V(G.x0 + 0.12, F + h + 0.008, z), 0.002, 0.002, 3);
  }
  puddle(mb, 'tunnel_water', C.x1 + 0.6, G.zc + 0.2, F + 0.002, 0.35, 0.22, rng);

  // ------------------------------------------------------------------ pipes on brackets (inner side of the bend)
  const zIn = L1.z0 + 0.1, zOut = L1.z0 + 0.28;            // west run, north wall
  const xIn = L2.x1 - 0.12, xOut = L2.x1 - 0.3;            // north run, east wall
  const zInH = HEAD.z0 + 0.1, zOutH = HEAD.z0 + 0.28;      // in the head-chamber recess (behind the door swing)
  const yHeat = F + 1.5, yMain = F + 0.4;
  const jog0 = HEAD.x1 - 1.05, jog1 = HEAD.x0 + 0.1;
  const run = (zH: number, zR: number, xR: number, y: number) => [V(ax, y, zH), V(jog0, y, zH), V(jog1, y, zR), V(xR, y, zR), V(xR, y, L2.z0)];
  pipe(mb, 'pipe_lagging', run(zInH, zIn, xIn, yHeat), 0.075, 10);
  pipe(mb, 'pipe_lagging', run(zOutH, zOut, xOut, yHeat), 0.075, 10);
  pipe(mb, 'rust_metal_int', run(zInH, zIn, xIn, yMain), 0.06, 10);
  for (const [z, y, r] of [[zInH, yHeat, 0.09], [zOutH, yHeat, 0.09], [zInH, yMain, 0.075]]) flange(mb, 'tunnel_wall', V(ax - 0.01, y, z), V(1, 0, 0), r + 0.04, 0.04);
  for (const [x, y, r] of [[xIn, yHeat, 0.09], [xOut, yHeat, 0.09], [xIn, yMain, 0.075]]) flange(mb, 'tunnel_wall', V(x, y, L2.z0 + 0.015), V(0, 0, 1), r + 0.04, 0.03);
  // brackets and joints: west run along x, north run along z
  const bracket = (p: (o: number, y: number) => THREE.Vector3, dir: THREE.Vector3) => {
    const o0 = 0.0, o1 = 0.36;
    mb.beam('rust_metal_int', p(o0, yHeat - 0.1), p(o1, yHeat - 0.1), 0.04, 0.04, V(0, 1, 0));
    mb.beam('rust_metal_int', p(0.02, yHeat - 0.32), p(0.3, yHeat - 0.12), 0.03, 0.03, V(0, 1, 0));
    mb.beam('rust_metal_int', p(0.012, yHeat - 0.36), p(0.012, yHeat - 0.05), 0.05, 0.012, V(0, 1, 0));
    mb.beam('rust_metal_int', p(o0, yMain - 0.08), p(0.17, yMain - 0.08), 0.035, 0.035, V(0, 1, 0));
    for (const o of [0.1, 0.28]) flange(mb, 'rust_metal_int', p(o, yHeat), dir, 0.081, 0.015, 10);
    rustStreak(p(0.0, yHeat - 0.12));
  };
  const streakRng = new RNG('tunnel-streaks');
  const rustStreak = (at: THREE.Vector3) => {
    if (!streakRng.chance(0.5)) return;
    const n = Math.abs(at.z - (L1.z0)) < 0.05 ? V(0, 0, 1) : V(-1, 0, 0);
    wallPatch(mb, 'water_streak', at.clone().addScaledVector(n, 0.003).add(V(0, -0.35, 0)), n, 0.03, 0.32, streakRng, 8);
  };
  for (let x = jog1 - 0.6; x > L2.x1 + 0.4; x -= 1.6) {
    bracket((o, y) => V(x, y, L1.z0 + o), V(1, 0, 0));
    if (Math.round(x * 10) % 3 === 0) flange(mb, 'rust_metal_int', V(x - 0.8, yMain, zIn), V(1, 0, 0), 0.08, 0.05);
  }
  for (let z = L1.z0 - 0.8; z > L2.z0 + 0.3; z -= 1.6) {
    bracket((o, y) => V(L2.x1 - o, y, z), V(0, 0, 1));
    if (Math.round(-z * 10) % 3 === 0) flange(mb, 'rust_metal_int', V(xIn, yMain, z - 0.8), V(0, 0, 1), 0.08, 0.05);
  }
  if (physics) {
    const hx1 = (jog1 - L2.x1) / 2;
    physics.addBox({ cx: (jog1 + L2.x1) / 2, cy: yHeat, cz: L1.z0 + 0.18, hx: hx1, hy: 0.1, hz: 0.18, surface: 'metal' });
    physics.addBox({ cx: (jog1 + L2.x1) / 2, cy: yMain, cz: L1.z0 + 0.09, hx: hx1, hy: 0.08, hz: 0.09, surface: 'metal' });
    physics.addBox({ cx: L2.x1 - 0.18, cy: yHeat, cz: (L2.z0 + L1.z0) / 2, hx: 0.18, hy: 0.1, hz: (L1.z0 - L2.z0) / 2, surface: 'metal' });
    physics.addBox({ cx: L2.x1 - 0.09, cy: yMain, cz: (L2.z0 + L1.z0) / 2, hx: 0.09, hy: 0.08, hz: (L1.z0 - L2.z0) / 2, surface: 'metal' });
  }

  // ------------------------------------------------------------------ Josef's generator cable along the ceiling (1993)
  const zc1 = L1.z1 - 0.2, xc2 = L2.x0 + 0.15;
  const cablePts: THREE.Vector3[] = [V(ax, TUNNEL.HEAD_CEIL - 0.02, zc1), V(HEAD.x0 + 0.02, TUNNEL.HEAD_CEIL - 0.02, zc1)];
  for (let i = s1.length - 1; i >= 0; i--) {
    const s = s1[i];
    cablePts.push(V(s.b - 0.03, s.c - 0.02, zc1), V(Math.max(s.a + 0.03, xc2), s.c - 0.02, zc1));
  }
  for (let i = s2.length - 1; i >= 0; i--) {
    const s = s2[i];
    cablePts.push(V(xc2, s.c - 0.02, Math.min(s.b - 0.03, L1.z1 - 0.2)), V(xc2, s.c - 0.02, s.a + 0.03));
  }
  cablePts.push(V(xc2, -0.17, L2.z0 + 0.01));
  pipe(mb, 'rubber_black', cablePts, 0.009, 5, 0.04);
  for (let x = ax - 0.4; x > xc2; x -= 0.6) mb.box('rust_metal_int', x, ceil1(x) - 0.012, zc1, 0.015, 0.024, 0.032);
  for (let z = L1.z1 - 0.6; z > L2.z0; z -= 0.6) mb.box('rust_metal_int', xc2, (z > L2.z1 ? ceil1(xc2) : ceil2(z)) - 0.012, z, 0.032, 0.024, 0.015);

  // ------------------------------------------------------------------ concrete joints, damp, drains, puddles
  const joint = (p0: number[], p1: number[], n: number[]) => {
    const w = 0.012;
    const t = [p1[0] - p0[0], 0, p1[2] - p0[2]]; const tl = Math.hypot(t[0], t[2]) || 1;
    const u = [-n[2] * w, 0, n[0] * w];
    void tl;
    orientedQuad(mb, 'water_streak', [p0[0] - u[0], p0[1], p0[2] - u[2]], [p0[0] + u[0], p0[1], p0[2] + u[2]], [p1[0] + u[0], p1[1], p1[2] + u[2]], [p1[0] - u[0], p1[1], p1[2] - u[2]], n);
  };
  for (let x = jog1 - 1.4; x > L2.x1 + 0.2; x -= 3.0) {
    joint([x, F, L1.z1 - 0.002], [x, ceil1(x), L1.z1 - 0.002], [0, 0, -1]);
    joint([x + 0.7, F, L1.z0 + 0.002], [x + 0.7, ceil1(x + 0.7), L1.z0 + 0.002], [0, 0, 1]);
  }
  for (let z = L1.z0 - 2.0; z > L2.z0 + 0.2; z -= 3.0) {
    joint([L2.x0 + 0.002, F, z], [L2.x0 + 0.002, ceil2(z), z], [1, 0, 0]);
    joint([L2.x1 - 0.002, F, z - 0.9], [L2.x1 - 0.002, ceil2(z - 0.9), z - 0.9], [-1, 0, 0]);
  }
  for (let i = 0; i < 9; i++) {
    const onWest = i % 2 === 0;
    if (onWest) {
      const z = rng.range(L2.z0 + 0.8, L1.z0 - 0.5);
      if (z > G.z0 - 0.5 && z < G.z1 + 0.5) continue;
      const len = rng.range(0.4, 1.3);
      wallPatch(mb, 'water_streak', V(L2.x0 + 0.003, ceil2(z) - len / 2, z), V(1, 0, 0), rng.range(0.05, 0.16), len / 2, rng, 10);
    } else {
      const x = rng.range(jog1 - 0.5, L2.x1 + 0.5);
      const len = rng.range(0.4, 1.2);
      wallPatch(mb, 'water_streak', V(x, ceil1(x) - len / 2, L1.z1 - 0.003), V(0, 0, -1), rng.range(0.05, 0.14), len / 2, rng, 10);
    }
  }
  const drains: [number, number][] = [[-18.5, (L1.z0 + L1.z1) / 2], [(L2.x0 + L2.x1) / 2, -30.0], [(L2.x0 + L2.x1) / 2, -41.5]];
  for (const [x, z] of drains) {
    drainGrate(mb, x, F, z, 0.28);
    puddle(mb, 'tunnel_water', x + rng.range(-0.2, 0.2), z + rng.range(-0.2, 0.2), F + 0.002, rng.range(0.35, 0.6), rng.range(0.25, 0.4), rng);
  }
  puddle(mb, 'tunnel_water', L2.x0 + 0.8, (L1.z0 + L1.z1) / 2 - 0.1, F + 0.002, 0.7, 0.5, rng);                 // the low corner
  for (const [x, z] of [[-15.6, -24.2], [-22.4, -24.7], [-25.3, -24.0], [-27.7, -27.8], [-27.3, -38.3], [-27.6, -45.6]]) {
    puddle(mb, 'tunnel_water', x, z, F + 0.002, rng.range(0.18, 0.4), rng.range(0.12, 0.3), rng);
  }

  // ------------------------------------------------------------------ marten traps (log 1988: "so she sees them")
  const trap = (x: number, z: number, ry: number) => {
    mb.pushTRS(x, F, z, ry);
    mb.box('rough_timber', 0, 0.095, 0, 0.18, 0.012, 0.72, { uv: 'local' });
    for (const s of [-1, 1]) mb.box('rough_timber', s * 0.084, 0.1, 0, 0.012, 0.2, 0.72, { uv: 'local' });
    mb.box('rough_timber', 0, 0.006, 0, 0.18, 0.012, 0.72, { uv: 'local' });
    for (let k = 0; k < 5; k++) mb.box('iron_black', -0.06 + k * 0.03, 0.1, -0.355, 0.004, 0.18, 0.004);
    mb.pushTRS(0, 0.2, 0.36, 0, 1, 1, 1, -1.2);
    mb.box('rough_timber', 0, -0.09, 0, 0.17, 0.18, 0.01, { uv: 'local' });
    mb.pop();
    mb.box('iron_black', 0, 0.22, 0.1, 0.006, 0.04, 0.5);
    mb.pop();
  };
  trap(L2.x0 + 0.16, -30.6, 0.02);
  trap(G.x1 - 0.9, G.z0 + 0.16, Math.PI / 2 + 0.05);
  kit.anchor('tunnel_traps', L2.x0 + 0.16, F, -30.6, Math.PI / 2, 'tunnel_north');

  // ------------------------------------------------------------------ candle shelf on the west wall (log_1988_q1 lies here)
  const sh = { x0: L2.x0, x1: L2.x0 + 0.32, z0: -36.95, z1: -36.25, y: F + 1.15 };
  mb.box('rough_timber', (sh.x0 + sh.x1) / 2, sh.y + 0.015, (sh.z0 + sh.z1) / 2, sh.x1 - sh.x0, 0.03, sh.z1 - sh.z0, { uv: 'local' });
  for (const z of [sh.z0 + 0.08, sh.z1 - 0.08]) {
    mb.beam('iron_black', V(sh.x0, sh.y - 0.01, z), V(sh.x1 - 0.03, sh.y - 0.01, z), 0.02, 0.02);
    mb.beam('iron_black', V(sh.x0, sh.y - 0.2, z), V(sh.x1 - 0.06, sh.y - 0.01, z), 0.015, 0.015);
  }
  const shTop = sh.y + 0.03;
  for (const [x, z, h] of [[sh.x0 + 0.12, sh.z0 + 0.1, 0.06], [sh.x0 + 0.2, sh.z0 + 0.16, 0.035], [sh.x0 + 0.1, sh.z0 + 0.22, 0.09]]) {
    mb.cylinder('candle_wax', x, shTop, z, 0.021, 0.019, h, 8);
    mb.cylinder('candle_wax', x, shTop, z, 0.035 + h * 0.2, 0.035 + h * 0.2, 0.003, 10);
    mb.rod('black_soot', V(x, shTop + h, z), V(x, shTop + h + 0.008, z), 0.002, 0.002, 3);
  }
  mb.box('cardboard', sh.x0 + 0.24, shTop + 0.009, sh.z1 - 0.12, 0.05, 0.018, 0.035);
  physics?.addBox({ cx: (sh.x0 + sh.x1) / 2, cy: sh.y + 0.015, cz: (sh.z0 + sh.z1) / 2, hx: (sh.x1 - sh.x0) / 2, hy: 0.03, hz: (sh.z1 - sh.z0) / 2, surface: 'wood' });
  kit.anchor('tunnel_shelf', (sh.x0 + sh.x1) / 2, shTop, (sh.z0 + sh.z1) / 2, Math.PI / 2, 'tunnel_north');

  // ------------------------------------------------------------------ lights (one bulb still works, barely)
  const lamp = (id: string, x: number, z: number, c: number, room: string, working: boolean) =>
    kit.light({ id, position: V(x, c - 0.13, z), kind: 'bulb', working, flicker: working ? 0.75 : 0, color: 0xffb468, intensity: working ? 1.3 : undefined, room });
  lamp('light:tunnel_head', -16.2, L1.z1 - 0.45, ceil1(-16.2), 'tunnel_west', false);
  lamp('light:tunnel_corner', -25.6, L1.z1 - 0.45, ceil1(-25.6), 'tunnel_west', false);
  lamp('light:tunnel_junction', L2.x0 + 0.55, G.z1 + 0.9, ceil2(G.z1 + 0.9), 'tunnel_north', true);
  lamp('light:tunnel_pump', L2.x0 + 0.55, -45.4, ceil2(-45.4), 'tunnel_north', false);

  // ------------------------------------------------------------------ stencil anchors (decals: ENV_TEXT.signs.tunnelStencils)
  kit.anchor('stencil_heizgang', HEAD.x0 - 0.9, F + 1.25, L1.z1 - 0.004, Math.PI, 'tunnel_west');
  kit.anchor('stencil_pumpe', -18.0, F + 0.95, L1.z0 + 0.004, 0, 'tunnel_west');
  kit.anchor('stencil_kohle', L2.x0 + 0.004, F + 1.3, G.z1 + 0.85, Math.PI / 2, 'tunnel_north');

  // ------------------------------------------------------------------ interior spans
  kit.span(spanFromInner(L1.x0, HEAD.z0, L1.x1, L1.z1, F - 0.05, (x) => ceil1(Math.min(x, L1.x1)) + 0.01, 0.2));
  kit.span(spanFromInner(L2.x0, L2.z0, L2.x1, L2.z1, F - 0.05, (x, z) => (z > L2.z1 ? ceil1(x) : ceil2(z)) + 0.01, 0.2));
  kit.span(spanFromInner(G.x0, G.z0, L2.x0, G.z1, F - 0.05, yc + 0.01, 0.2));

  const group = mb.build(materials, { name: 'tunnels' });
  return kit.output(group);
}
