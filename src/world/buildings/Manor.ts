import * as THREE from 'three/webgpu';
import { BuildingKit, BuildingOutput, KitWall } from '../architecture/BuildingKit';
import { buildStairs, buildSlab } from '../architecture/Elements';
import { buildRoof, buildChimney } from '../architecture/Roofs';
import { buildCornice } from '../architecture/Walls';
import type { Physics } from '../../physics/Physics';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import { RNG } from '../../core/Random';

/**
 * Herrenhaus Gut Waldegg (1923, renovated 1958 / 1974).
 * Footprint x ∈ [−13, 13], z ∈ [−29, −15]; entrance façade faces south onto the courtyard.
 *
 * Levels: basement −2.05 | ground 0.75 | upper 4.40 | attic 7.70 | wall plate 8.35.
 */
export const MANOR = {
  X0: -13, X1: 13, Z0: -29, Z1: -15,
  B0: -2.05, G0: 0.75, U0: 4.4, A0: 7.7, EAVE: 8.35,
  T: 0.55,
} as const;

const H = MANOR;
const WX0 = H.X0 + H.T / 2, WX1 = H.X1 - H.T / 2, WZ0 = H.Z0 + H.T / 2, WZ1 = H.Z1 - H.T / 2; // ext. wall centrelines
const IX0 = H.X0 + H.T, IX1 = H.X1 - H.T, IZ0 = H.Z0 + H.T, IZ1 = H.Z1 - H.T;           // inner faces

export function buildManor(physics: Physics | undefined, materials: MaterialLibrary): BuildingOutput {
  const kit = new BuildingKit('manor', physics, { mat: 'plaster_ext_ochre' });
  const mb = kit.mb;
  const rng = new RNG('manor');
  const plaster = { mat: 'plaster_int' };

  // ======================================================================= rooms
  const G0 = H.G0, Gc = H.U0 - 0.35, U0 = H.U0, Uc = H.A0 - 0.3, B0 = H.B0, Bc = G0 - 0.3;
  // U-shaped hall stair: flights along the side walls, half landing against the back wall
  // (with the stair window), two-storey open stairwell above it.
  const STAIR_TOP = -23.92, LANDING = -27.0;
  const stairVoid = { x0: -2.85, z0: IZ0, x1: 2.85, z1: STAIR_TOP };
  const cellarStairVoid = { x0: 8.85, z0: IZ0, x1: IX1, z1: -27.35 };   // kitchen → potato cellar
  const atticStairVoid = { x0: 3.15, z0: IZ0, x1: 6.1, z1: -27.55 };      // upper storage → attic

  // --- basement
  kit.room({ id: 'b_corridor', location: 'manor_basement_storage', x0: -2.85, z0: IZ0, x1: 2.85, z1: IZ1, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', wall: 'stone_wall_int', env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'b_coal', location: 'manor_basement_storage', x0: IX0, z0: -22.1, x1: -3.15, z1: IZ1, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', wall: 'brick_int', env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'b_boiler', location: 'manor_basement_boiler', x0: -7.0, z0: IZ0, x1: -3.15, z1: -22.3, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', wall: 'brick_int', env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'b_sealed', location: 'manor_basement_sealed_room', x0: IX0, z0: IZ0, x1: -7.2, z1: -22.3, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', wall: { mat: 'plaster_int', dado: { mat: 'stone_wall_int', h: 0.6 } }, env: 'room_small', floorSurface: 'concrete' });
  kit.room({ id: 'b_storage', location: 'manor_basement_storage', x0: 3.15, z0: -21.075, x1: IX1, z1: IZ1, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', wall: 'stone_wall_int', env: 'basement', floorSurface: 'concrete' });
  kit.room({ id: 'b_laundry', location: 'manor_basement_storage', x0: 3.15, z0: IZ0, x1: 6.1, z1: -21.325, y0: B0, y1: Bc, floor: 'floor_tiles', ceiling: 'concrete_int', wall: { mat: 'plaster_int', dado: { mat: 'wall_tiles', h: 1.4 } }, env: 'basement', floorSurface: 'tile' });
  kit.room({ id: 'b_potato', location: 'manor_basement_storage', x0: 6.3, z0: IZ0, x1: IX1, z1: -21.325, y0: B0, y1: Bc, floor: 'concrete_int', ceiling: 'concrete_int', ceilVoids: [cellarStairVoid], wall: 'brick_int', env: 'basement', floorSurface: 'concrete' });

  // --- ground floor
  const sk = 'painted_wood_white';
  kit.room({ id: 'g_vestibule', location: 'manor_hall', x0: -2.85, z0: -18.125, x1: 2.85, z1: IZ1, y0: G0, y1: Gc, floor: 'floor_tiles', ceiling: 'ceiling', wall: { mat: 'plaster_int', dado: { mat: 'oil_dado_brown', h: 1.2 } }, skirting: null, env: 'room_small', floorSurface: 'tile' });
  kit.room({ id: 'g_hall', location: 'manor_hall', x0: -2.85, z0: IZ0, x1: 2.85, z1: -18.275, y0: G0, y1: Gc, floor: 'floor_tiles', ceiling: 'ceiling', ceilVoids: [stairVoid], wall: { mat: 'wallpaper_stripe', dado: { mat: 'wainscot', h: 1.05 } }, skirting: 'painted_wood_brown', env: 'hall', floorSurface: 'tile' });
  kit.room({ id: 'g_salon', location: 'manor_salon', x0: IX0, z0: -22.1, x1: -3.15, z1: IZ1, y0: G0, y1: Gc, floor: 'parquet', ceiling: 'ceiling', wall: 'wallpaper_floral', skirting: sk, env: 'room_large', floorSurface: 'wood_old' });
  kit.room({ id: 'g_dining', location: 'manor_dining', x0: IX0, z0: IZ0, x1: -3.15, z1: -22.3, y0: G0, y1: Gc, floor: 'floor_boards_dark', ceiling: 'ceiling', wall: { mat: 'wallpaper_stripe', dado: { mat: 'wainscot', h: 1.0 } }, skirting: 'painted_wood_brown', env: 'room_large', floorSurface: 'wood_old' });
  kit.room({ id: 'g_study', location: 'manor_study', x0: 3.15, z0: -21.075, x1: 7.925, z1: IZ1, y0: G0, y1: Gc, floor: 'parquet', ceiling: 'ceiling', wall: { mat: 'plaster_int_green', dado: { mat: 'wainscot', h: 1.15 } }, skirting: 'painted_wood_brown', env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'g_library', location: 'manor_library', x0: 8.075, z0: -21.075, x1: IX1, z1: IZ1, y0: G0, y1: Gc, floor: 'floor_boards_dark', ceiling: 'ceiling', wall: 'wallpaper_floral', skirting: 'painted_wood_brown', env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'g_corridor', location: 'manor_kitchen', x0: 3.15, z0: -25.525, x1: 6.1, z1: -21.325, y0: G0, y1: Gc, floor: 'linoleum', ceiling: 'ceiling', wall: { mat: 'plaster_int', dado: { mat: 'oil_dado', h: 1.4 } }, skirting: null, env: 'room_small', floorSurface: 'wood' });
  kit.room({ id: 'g_pantry', location: 'manor_pantry', x0: 3.15, z0: IZ0, x1: 6.1, z1: -25.675, y0: G0, y1: Gc, floor: 'floor_tiles', ceiling: 'ceiling', wall: 'plaster_int', skirting: null, env: 'room_small', floorSurface: 'tile' });
  kit.room({ id: 'g_kitchen', location: 'manor_kitchen', x0: 6.3, z0: IZ0, x1: IX1, z1: -21.325, y0: G0, y1: Gc, floor: 'linoleum', ceiling: 'ceiling', voids: [cellarStairVoid], wall: { mat: 'plaster_int', dado: { mat: 'wall_tiles', h: 1.5 } }, skirting: null, env: 'room_small', floorSurface: 'wood' });

  // --- upper floor
  kit.room({ id: 'u_landing', location: 'manor_hall', x0: -2.85, z0: IZ0, x1: 2.85, z1: -18.275, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', voids: [stairVoid], wall: { mat: 'wallpaper_stripe', dado: { mat: 'wainscot', h: 1.0 } }, skirting: 'painted_wood_brown', env: 'hall', floorSurface: 'wood_old' });
  kit.room({ id: 'u_sewing', location: 'manor_hall', x0: -2.85, z0: -18.125, x1: 2.85, z1: IZ1, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'wallpaper_70s', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_master', location: 'manor_master_bedroom', x0: IX0, z0: -22.1, x1: -3.15, z1: IZ1, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'wallpaper_floral', skirting: sk, env: 'room_large', floorSurface: 'wood_old' });
  kit.room({ id: 'u_oma', location: 'manor_oma_room', x0: IX0, z0: IZ0, x1: -6.1, z1: -22.3, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'wallpaper_stripe', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_bath', location: 'manor_bathroom', x0: -5.9, z0: IZ0, x1: -3.15, z1: -22.3, y0: U0, y1: Uc, floor: 'floor_tiles', ceiling: 'ceiling', wall: { mat: 'plaster_int_blue', dado: { mat: 'wall_tiles', h: 1.6 } }, skirting: null, env: 'room_small', floorSurface: 'tile' });
  kit.room({ id: 'u_marie', location: 'manor_marie_room', x0: 3.15, z0: -21.075, x1: 7.925, z1: IZ1, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'wallpaper_70s', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_thomas', location: 'manor_thomas_room', x0: 8.075, z0: -21.075, x1: IX1, z1: IZ1, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'plaster_int_blue', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_corridor', location: 'manor_hall', x0: 3.15, z0: -25.525, x1: 6.1, z1: -21.325, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'plaster_int', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_storage', location: 'manor_hall', x0: 3.15, z0: IZ0, x1: 6.1, z1: -25.675, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', ceilVoids: [atticStairVoid], wall: 'plaster_int', skirting: null, env: 'room_small', floorSurface: 'wood_old' });
  kit.room({ id: 'u_guest', location: 'manor_hall', x0: 6.3, z0: IZ0, x1: IX1, z1: -21.325, y0: U0, y1: Uc, floor: 'floor_boards', ceiling: 'ceiling', wall: 'wallpaper_stripe', skirting: sk, env: 'room_small', floorSurface: 'wood_old' });

  // --- attic (one space under the roof)
  kit.room({ id: 'a_attic', location: 'manor_attic', x0: IX0, z0: IZ0, x1: IX1, z1: IZ1, y0: H.A0, y1: 16, floor: 'rough_timber', ceiling: null, voids: [atticStairVoid], wall: 'brick_int', skirting: null, env: 'attic', floorSurface: 'wood_old', slab: 0.3 });

  kit.buildRoomSurfaces();

  // ======================================================================= walls
  const ext = (level: 'B' | 'G' | 'U' | 'A') => level === 'B' ? { mat: 'stone_wall' } : { mat: 'plaster_ext_ochre' };
  const extIn = (level: 'B' | 'G' | 'U' | 'A') => level === 'B' ? 'auto' : 'auto';
  const y0Of = { B: B0, G: G0 - 0.3, U: U0 - 0.3, A: H.A0 - 0.3 } as const;
  const y1Of = { B: G0 - 0.3, G: U0 - 0.3, U: H.A0 - 0.3, A: H.EAVE } as const;
  const win = (at: number, w: number, level: 'G' | 'U', extra: Record<string, unknown> = {}) => {
    const y0 = y0Of[level];
    const floorY = level === 'G' ? G0 : U0;
    const sill = floorY + 0.85 - y0, head = floorY + (level === 'G' ? 3.0 : 2.65) - y0;
    return { o: { at, width: w, bottom: sill, top: head, kind: 'window' as const }, opts: { style: 'kasten' as const, broken: 0.15, ...extra } };
  };
  const bwin = (at: number) => ({ o: { at, width: 0.8, bottom: 2.08, top: 2.38, kind: 'window' as const }, opts: { style: 'cellar' as const, broken: 0.3, sillIn: null, sillOut: null, muntins: false } });

  // exterior walls per level. Walls run clockwise seen from above so the RIGHT side is outside:
  // front (south) west→east has right = +z (outside) ✓
  const levels: ('B' | 'G' | 'U' | 'A')[] = ['B', 'G', 'U', 'A'];
  for (const L of levels) {
    const y0 = y0Of[L], y1 = y1Of[L];
    const outer = ext(L);
    const common = { y0, y1, t: H.T, cap: L === 'B' ? 'stone_wall' : 'plaster_ext_ochre', surface: 'stone', noTop: L !== 'A' };
    // front façade (south): from west to east → right side faces south (+z)
    const frontWins: { o: any; opts: any }[] = [];
    const frontDoors: { o: any; frame?: string | null }[] = [];
    if (L === 'G') {
      for (const x of [-10.4, -5.6, 5.6, 10.4]) frontWins.push(win(x - WX0, 1.25, 'G', { shutters: rng.chance(0.5) ? 'open' : null, broken: x === -10.4 ? 0.45 : 0.15 }));
      for (const x of [-2.05, 2.05]) frontWins.push(win(x - WX0, 0.6, 'G', { style: 'single', muntins: true }));
      frontDoors.push({ o: { at: 0 - WX0, width: 1.5, bottom: G0 - y0, top: G0 + 2.75 - y0, kind: 'door' }, frame: 'painted_wood_brown' });
    }
    if (L === 'U') {
      for (const x of [-10.4, -5.6, 5.6, 10.4]) frontWins.push(win(x - WX0, 1.25, 'U', { shutters: x === 10.4 ? 'hanging' : rng.chance(0.4) ? 'closed' : 'open', broken: 0.12 }));
      frontDoors.push({ o: { at: 0 - WX0, width: 1.15, bottom: U0 - y0, top: U0 + 2.45 - y0, kind: 'door' }, frame: 'painted_wood_white' });
    }
    if (L === 'B') for (const x of [-10, -6, 6, 10]) frontWins.push(bwin(x - WX0));
    kit.wall({ ...common, a: [WX0, WZ1], b: [WX1, WZ1], left: extIn(L), right: outer, ext0: H.T / 2, ext1: H.T / 2, windows: frontWins, doors: frontDoors });

    // east façade: north→south? We need right side = +x (outside). Direction from south to north (−z): right = (−dz, dx) = (1,0) ✓
    const eastWins: { o: any; opts: any }[] = [];
    if (L === 'G') { eastWins.push(win(WZ1 - (-18.3), 1.15, 'G')); eastWins.push(win(WZ1 - (-24.0), 1.15, 'G')); eastWins.push(win(WZ1 - (-27.0), 1.15, 'G', { boarded: true })); }
    if (L === 'U') { eastWins.push(win(WZ1 - (-18.3), 1.15, 'U')); eastWins.push(win(WZ1 - (-25.5), 1.15, 'U', { shutters: 'closed' })); }
    if (L === 'B') { eastWins.push(bwin(WZ1 - (-18.3))); eastWins.push(bwin(WZ1 - (-25.0))); }
    kit.wall({ ...common, a: [WX1, WZ1], b: [WX1, WZ0], left: extIn(L), right: outer, ext0: H.T / 2, ext1: H.T / 2, windows: eastWins });

    // back façade (north): east→west, right = (−dz, dx) with d=(−1,0) → (0,−1) = north ✓
    const backWins: { o: any; opts: any }[] = [];
    const backDoors: { o: any; frame?: string | null }[] = [];
    if (L === 'G') {
      for (const x of [-10.4, -6.2]) backWins.push(win(WX1 - x, 1.2, 'G'));
      backWins.push(win(WX1 - 10.6, 1.15, 'G'));
      backWins.push(win(WX1 - 4.6, 0.6, 'G', { style: 'single' }));
      backDoors.push({ o: { at: WX1 - (-8.3), width: 1.5, bottom: G0 - y0, top: G0 + 2.7 - y0, kind: 'door' }, frame: 'painted_wood_white' });
      // stair window above the half landing
      backWins.push({ o: { at: WX1 - 0, width: 1.3, bottom: 3.05 - y0, top: 3.95 - y0, kind: 'window' as const }, opts: { style: 'kasten' as const, broken: 0.25 } });
      backDoors.push({ o: { at: WX1 - 8.3, width: 1.0, bottom: G0 - y0, top: G0 + 2.15 - y0, kind: 'door' }, frame: 'painted_wood_brown' });
    }
    if (L === 'U') {
      for (const x of [-10.4, -4.5, 0, 9.4]) backWins.push(win(WX1 - x, x === -4.5 ? 0.7 : 1.15, 'U', x === 0 ? { broken: 0.6 } : {}));
      backWins.push(win(WX1 - 4.6, 0.6, 'U', { style: 'single' }));
    }
    if (L === 'B') for (const x of [-10, -5, 8, 11]) backWins.push(bwin(WX1 - x));
    kit.wall({ ...common, a: [WX1, WZ0], b: [WX0, WZ0], left: extIn(L), right: outer, ext0: H.T / 2, ext1: H.T / 2, windows: backWins, doors: backDoors });

    // west façade: north→south (+z), right = (−1, 0) = west ✓
    const westWins: { o: any; opts: any }[] = [];
    const westDoors: { o: any; frame?: string | null }[] = [];
    if (L === 'G') { westWins.push(win(-18.6 - WZ0, 1.15, 'G')); westWins.push(win(-25.6 - WZ0, 1.15, 'G', { passable: true, broken: 1 })); }
    if (L === 'U') { westWins.push(win(-18.6 - WZ0, 1.15, 'U')); westWins.push(win(-25.6 - WZ0, 1.15, 'U')); }
    if (L === 'B') westDoors.push({ o: { at: -24.5 - WZ0, width: 1.1, bottom: 0, top: 2.0, kind: 'door' }, frame: 'rust_metal_int' });
    kit.wall({ ...common, a: [WX0, WZ0], b: [WX0, WZ1], left: extIn(L), right: outer, ext0: H.T / 2, ext1: H.T / 2, windows: westWins, doors: westDoors });
  }

  // ---- interior walls ------------------------------------------------------
  const iw = (a: [number, number], b: [number, number], L: 'B' | 'G' | 'U', t: number, doors: { at: number; w: number; h?: number; frame?: string | null }[] = [], extra: Partial<KitWall> = {}) => {
    const y0 = L === 'B' ? B0 : L === 'G' ? G0 : U0;
    const y1 = L === 'B' ? G0 - 0.3 : L === 'G' ? U0 - 0.3 : H.A0 - 0.3;
    const d = doors.map((x) => ({ o: { at: x.at, width: x.w, bottom: 0, top: x.h ?? 2.15, kind: 'door' as const }, frame: x.frame === undefined ? (L === 'B' ? null : 'painted_wood_white') : x.frame }));
    return kit.wall({ a, b, y0, y1, t, noTop: true, doors: d, cap: L === 'B' ? 'stone_wall_int' : 'plaster_int', surface: 'stone', ...extra });
  };

  // basement
  const bHallW = iw([-3, WZ1], [-3, WZ0], 'B', 0.3, [{ at: WZ1 - (-19.0), w: 0.95 }, { at: WZ1 - (-25.5), w: 0.95 }]);
  const bHallE = iw([3, WZ0], [3, WZ1], 'B', 0.3, [{ at: -18.5 - WZ0, w: 0.95 }, { at: -24.2 - WZ0, w: 0.95 }]);
  iw([IX0, -22.2], [-3.15, -22.2], 'B', 0.2);
  // the newer brick wall that sealed the room off – with a crawl hole knocked through from inside
  const sealed = kit.wall({ a: [-7.1, -22.3], b: [-7.1, IZ0], y0: B0, y1: G0 - 0.3, t: 0.22, noTop: true, left: 'brick_int', right: 'brick_int', cap: 'brick_int', openings: [{ at: 3.4, width: 0.82, bottom: 0, top: 0.78, kind: 'hole' }], surface: 'stone' });
  iw([3.15, -21.2], [IX1, -21.2], 'B', 0.25, [{ at: 1.9, w: 0.9 }]);
  iw([6.2, -21.325], [6.2, IZ0], 'B', 0.2, [{ at: 3.0, w: 0.9 }]);

  // ground floor
  const gHallW = iw([-3, WZ1], [-3, WZ0], 'G', 0.3, [{ at: WZ1 - (-19.6), w: 1.4, h: 2.5 }, { at: WZ1 - (-23.0), w: 1.0, h: 2.3 }]);
  const gHallE = iw([3, WZ0], [3, WZ1], 'G', 0.3, [{ at: -19.0 - WZ0, w: 0.95, h: 2.3 }, { at: -23.1 - WZ0, w: 0.95, h: 2.3 }]);
  const gVest = iw([-2.85, -18.2], [2.85, -18.2], 'G', 0.15, [{ at: 2.85, w: 1.6, h: 2.6 }]);
  const gSalonDining = iw([IX0, -22.2], [-3.15, -22.2], 'G', 0.2, [{ at: -7.6 - IX0, w: 1.3, h: 2.4 }]);
  const gStudyLib = iw([8, IZ1], [8, -21.075], 'G', 0.15, [{ at: IZ1 - (-18.3), w: 0.9 }]);
  iw([3.15, -21.2], [IX1, -21.2], 'G', 0.25);
  const gCorrKitchen = iw([6.2, -21.325], [6.2, IZ0], 'G', 0.2, [{ at: 1.8, w: 0.95 }]);
  const gCorrPantry = iw([3.15, -25.6], [6.1, -25.6], 'G', 0.15, [{ at: 1.45, w: 0.8 }]);

  // upper floor
  const uHallW = iw([-3, WZ1], [-3, WZ0], 'U', 0.3, [{ at: WZ1 - (-19.0), w: 0.95 }, { at: WZ1 - (-23.0), w: 0.85 }]);
  const uHallE = iw([3, WZ0], [3, WZ1], 'U', 0.3, [{ at: -19.0 - WZ0, w: 0.9 }, { at: -23.1 - WZ0, w: 0.9 }]);
  const uSew = iw([-2.85, -18.2], [2.85, -18.2], 'U', 0.15, [{ at: 2.85, w: 0.9 }]);
  const uMasterOma = iw([IX0, -22.2], [-3.15, -22.2], 'U', 0.2, [{ at: -9.0 - IX0, w: 0.85 }]);
  iw([-6.0, -22.3], [-6.0, IZ0], 'U', 0.15);
  const uMarieThomas = iw([8, IZ1], [8, -21.075], 'U', 0.15, [{ at: IZ1 - (-18.3), w: 0.85 }]);
  const uCross = iw([3.15, -21.2], [IX1, -21.2], 'U', 0.25, [{ at: 1.45, w: 0.85 }]);
  const uCorrGuest = iw([6.2, -21.325], [6.2, IZ0], 'U', 0.2, [{ at: 1.8, w: 0.9 }]);
  const uCorrStorage = iw([3.15, -25.6], [6.1, -25.6], 'U', 0.15, [{ at: 1.45, w: 0.8 }]);

  // ---- door leaves (interactive) -------------------------------------------
  const panel = (mat = 'painted_wood_white'): any => ({ style: 'panel4', mat, handle: 'lever' });
  // walls built with frames above; find frames by searching kit.frames
  const F = (w: unknown) => kit.frames.find((x) => x.frame === w)!.frame;
  const G = (f: any, at: number, w: number, h: number) => ({ at, width: w, bottom: 0, top: h, kind: 'door' as const });
  void F;
  // front double door (locked)
  const frontWall = kit.frames.find((x) => x.wall.y0 === G0 - 0.3 && x.wall.a[1] === WZ1 && x.wall.b[0] === WX1)!.frame;
  const fdO = { at: 0 - WX0, width: 1.5, bottom: G0 - (G0 - 0.3), top: G0 + 2.75 - (G0 - 0.3), kind: 'door' as const };
  kit.doorInWall('door:manor_front_l', frontWall, { ...fdO, at: fdO.at - 0.375, width: 0.78 }, { style: 'panel2', mat: 'painted_wood_brown_ext', handle: 'knob', handleMat: 'brass' }, -1, -1, { locked: true, key: 'key_manor_front', sound: 'wood' });
  kit.doorInWall('door:manor_front_r', frontWall, { ...fdO, at: fdO.at + 0.375, width: 0.78 }, { style: 'panel2', mat: 'painted_wood_brown_ext', handle: 'none' }, 1, -1, { locked: true, key: 'key_manor_front', sound: 'wood' });
  // terrace door (back, glazed double – one leaf ajar, unlocked)
  const backWall = kit.frames.find((x) => x.wall.y0 === G0 - 0.3 && x.wall.a[1] === WZ0 && x.wall.a[0] === WX1)!.frame;
  const tdO = { at: WX1 - (-8.3), width: 1.5, bottom: 0.3, top: 0.3 + 2.7, kind: 'door' as const };
  kit.doorInWall('door:manor_terrace_l', backWall, { ...tdO, at: tdO.at - 0.375, width: 0.78 }, { style: 'glazed', mat: 'painted_wood_white_ext', handle: 'lever' }, -1, -1, { open: 0.35 });
  kit.doorInWall('door:manor_terrace_r', backWall, { ...tdO, at: tdO.at + 0.375, width: 0.78 }, { style: 'glazed', mat: 'painted_wood_white_ext', handle: 'none' }, 1, -1, { locked: true, key: 'never' });
  // kitchen back door
  kit.doorInWall('door:manor_kitchen_back', backWall, { at: WX1 - 8.3, width: 1.0, bottom: 0.3, top: 0.3 + 2.15, kind: 'door' }, { style: 'ledged', mat: 'painted_wood_brown_ext', handle: 'lever', seed: 8 }, 1, -1, { locked: true, key: 'key_manor_kitchen', sound: 'wood' });
  // tunnel door (iron, basement west)
  const westB = kit.frames.find((x) => x.wall.y0 === B0 && x.wall.a[0] === WX0 && x.wall.a[1] === WZ0 && x.wall.b[1] === WZ1)!.frame;
  kit.doorInWall('door:manor_tunnel', westB, { at: -24.5 - WZ0, width: 1.1, bottom: 0, top: 2.0, kind: 'door' }, { style: 'flush', mat: 'rust_metal_int', handle: 'lever', handleMat: 'rust_metal_int' }, -1, 1, { sound: 'metal', open: 0.1 });

  const D = (id: string, f: any, at: number, w: number, h: number, hinge: 1 | -1, swing: 1 | -1, leaf = panel(), extra: any = {}) => kit.doorInWall(id, f, G(f, at, w, h), leaf, hinge, swing, extra);
  // ground floor
  D('door:manor_salon', gHallW, WZ1 - (-19.6) - 0.35, 0.7, 2.5, -1, -1, panel(), { open: 1.2 });
  D('door:manor_salon_b', gHallW, WZ1 - (-19.6) + 0.35, 0.7, 2.5, 1, -1, panel());
  D('door:manor_dining', gHallW, WZ1 - (-23.0), 1.0, 2.3, 1, -1, panel(), { open: 0.4 });
  D('door:manor_study', gHallE, -19.0 - WZ0, 0.95, 2.3, -1, -1, panel('painted_wood_brown'), { locked: true, key: 'key_study' });
  D('door:manor_corridor', gHallE, -23.1 - WZ0, 0.95, 2.3, 1, -1, panel(), { open: 1.5 });
  D('door:manor_vestibule_l', gVest, 2.85 - 0.4, 0.8, 2.6, -1, 1, { style: 'glazed', mat: 'painted_wood_white', handle: 'lever' }, { open: 0.9 });
  D('door:manor_vestibule_r', gVest, 2.85 + 0.4, 0.8, 2.6, 1, 1, { style: 'glazed', mat: 'painted_wood_white', handle: 'none' });
  D('door:manor_salon_dining_l', gSalonDining, -7.6 - IX0 - 0.325, 0.65, 2.4, -1, 1, panel());
  D('door:manor_salon_dining_r', gSalonDining, -7.6 - IX0 + 0.325, 0.65, 2.4, 1, 1, panel(), { open: 0.6 });
  D('door:manor_library', gStudyLib, IZ1 - (-18.3), 0.9, 2.15, 1, 1, panel('painted_wood_brown'));
  D('door:manor_kitchen', gCorrKitchen, 1.8, 0.95, 2.15, -1, 1, panel(), { open: 1.8 });
  D('door:manor_pantry', gCorrPantry, 1.45, 0.8, 2.15, 1, -1, { style: 'ledged', mat: 'painted_wood_white', handle: 'lever' });
  // basement
  D('door:manor_b_coal', bHallW, WZ1 - (-19.0), 0.95, 2.15, -1, -1, { style: 'plank', mat: 'rough_timber', handle: 'ring' }, { sound: 'wood' });
  D('door:manor_b_boiler', bHallW, WZ1 - (-25.5), 0.95, 2.15, 1, -1, { style: 'plank', mat: 'rough_timber', handle: 'ring' }, { open: 0.5 });
  D('door:manor_b_storage', bHallE, -18.5 - WZ0, 0.95, 2.15, 1, -1, { style: 'plank', mat: 'rough_timber', handle: 'ring' });
  D('door:manor_b_laundry', bHallE, -24.2 - WZ0, 0.95, 2.15, -1, -1, { style: 'plank', mat: 'rough_timber', handle: 'ring' }, { open: 1.2 });
  // upper floor
  D('door:manor_master', uHallW, WZ1 - (-19.0), 0.95, 2.15, -1, -1, panel(), { open: 0.25 });
  D('door:manor_bath', uHallW, WZ1 - (-23.0), 0.85, 2.15, 1, -1, panel());
  // Marie's room: the newer brass bolt is on the OUTSIDE of the door
  D('door:manor_marie', uHallE, -19.0 - WZ0, 0.9, 2.15, -1, -1, panel(), { locked: false });
  D('door:manor_corridor_u', uHallE, -23.1 - WZ0, 0.9, 2.15, 1, -1, panel(), { open: 1.4 });
  D('door:manor_sewing', uSew, 2.85, 0.9, 2.15, -1, 1, panel(), { open: 0.15 });
  D('door:manor_oma', uMasterOma, -9.0 - IX0, 0.85, 2.15, 1, 1, panel());
  D('door:manor_thomas', uMarieThomas, IZ1 - (-18.3), 0.85, 2.15, -1, 1, panel(), { open: 0.7 });
  D('door:manor_marie_corr', uCross, 1.45, 0.85, 2.15, 1, 1, panel(), { locked: true, key: 'never' });
  D('door:manor_guest', uCorrGuest, 1.8, 0.9, 2.15, 1, 1, panel());
  D('door:manor_storage', uCorrStorage, 1.45, 0.8, 2.15, -1, -1, { style: 'ledged', mat: 'painted_wood_white', handle: 'lever' });

  // ---- balcony door (front, upper) leaf
  const frontU = kit.frames.find((x) => x.wall.y0 === U0 - 0.3 && x.wall.a[1] === WZ1 && x.wall.b[0] === WX1)!.frame;
  kit.doorInWall('door:manor_balcony', frontU, { at: 0 - WX0, width: 1.15, bottom: 0.3, top: 0.3 + 2.45, kind: 'door' }, { style: 'glazed', mat: 'painted_wood_white_ext', handle: 'lever' }, -1, -1, { locked: true, key: 'never' });

  // ======================================================================= stairs
  // main staircase: first flight up the east side, half landing at the back wall, second flight
  // back along the west side onto the upper hall – no landing slab at head height in the hall
  const flight = (G0 + U0) / 2 - G0; // 1.825
  const SW = 1.25, SX = 2.85 - 0.06 - SW / 2;
  const stairCommon = { width: SW, steps: 11, run: 0.28, treadMat: 'furniture_oak', riserMat: 'painted_wood_white', stringerMat: 'furniture_wood', rail: 'left' as const, railMat: 'furniture_wood', surface: 'wood_old' };
  buildStairs(mb, { ...stairCommon, x: SX, z: STAIR_TOP, y: G0, dir: 0, rise: flight, closedBelow: true }, physics);
  buildSlab(mb, -2.85, IZ0, 2.85, LANDING, G0 + flight, 0.2, 'floor_boards', 'ceiling', physics, 'wood_old');
  mb.box('furniture_wood', 0, G0 + flight - 0.1, LANDING + 0.06, 5.7, 0.24, 0.12);
  buildStairs(mb, { ...stairCommon, x: -SX, z: LANDING, y: G0 + flight, dir: Math.PI, rise: U0 - (G0 + flight) }, physics);
  // under-stair cupboard below the landing (a place to hide)
  const cupboard = kit.wall({ a: [SX - SW / 2 - 0.03, LANDING + 0.05], b: [-2.85, LANDING + 0.05], y0: G0, y1: G0 + flight - 0.2, t: 0.08, left: 'wainscot', right: 'rough_timber', cap: 'painted_wood_white', surface: 'wood', doors: [{ o: { at: SX - SW / 2 - 0.03, width: 0.7, bottom: 0, top: 1.45, kind: 'door' }, frame: 'painted_wood_white' }] });
  kit.doorInWall('door:manor_understair', cupboard, { at: SX - SW / 2 - 0.03, width: 0.7, bottom: 0, top: 1.45, kind: 'door' }, { style: 'ledged', mat: 'painted_wood_white', handle: 'knob', seed: 3 }, 1, 1, { open: 0.12 });
  physics?.addBox({ cx: SX, cy: G0 + flight / 2 - 0.1, cz: (STAIR_TOP + LANDING) / 2 - 0.3, hx: SW / 2, hy: flight / 2 - 0.15, hz: (STAIR_TOP - LANDING) / 2 - 0.5, surface: 'wood' });
  // landing rail between the flights and the gallery rail round the open stairwell
  balustrade(mb, physics, [[SX - SW / 2 - 0.03, LANDING], [-SX + SW / 2 + 0.03, LANDING]], G0 + flight, 'furniture_wood');
  balustrade(mb, physics, [[-SX + SW / 2 + 0.03, STAIR_TOP], [2.85, STAIR_TOP]], U0, 'furniture_wood');
  mb.box('painted_wood_white', 0, U0 - 0.2, STAIR_TOP - 0.02, 5.7, 0.42, 0.04);

  // steep cellar stair along the kitchen's north wall (down to the potato cellar)
  buildStairs(mb, { x: 8.9, z: -27.9, y: B0, dir: -Math.PI / 2, width: 0.95, rise: G0 - B0, steps: 14, run: 0.243, treadMat: 'rough_timber', riserMat: 'rough_timber', rail: 'left', railMat: 'rough_timber', surface: 'wood' }, physics);
  balustrade(mb, physics, [[8.85, -27.35], [11.3, -27.35]], G0, 'painted_wood_white', 0.9);
  // attic ladder-stair in the upper storage room
  buildStairs(mb, { x: 3.3, z: -28.0, y: U0, dir: -Math.PI / 2, width: 0.8, rise: H.A0 - U0, steps: 15, run: 0.18, treadMat: 'rough_timber', riserMat: 'rough_timber', rail: 'left', railMat: 'rough_timber', surface: 'wood' }, physics);
  balustrade(mb, physics, [[3.2, -27.55], [5.0, -27.55]], H.A0, 'rough_timber', 0.9);

  // ======================================================================= exterior
  // band cornice between storeys, main eaves cornice, corner pilasters and window surrounds
  const band = (y: number, h: number, d: number, mat: string) => {
    mb.box(mat, 0, y, H.Z1 + d / 2, H.X1 - H.X0 + 2 * d, h, d, { skip: ['nz'] });
    mb.box(mat, 0, y, H.Z0 - d / 2, H.X1 - H.X0 + 2 * d, h, d, { skip: ['pz'] });
    mb.box(mat, H.X1 + d / 2, y, (H.Z0 + H.Z1) / 2, d, h, H.Z1 - H.Z0, { skip: ['nx'] });
    mb.box(mat, H.X0 - d / 2, y, (H.Z0 + H.Z1) / 2, d, h, H.Z1 - H.Z0, { skip: ['px'] });
  };
  band(G0 - 0.05, 0.12, 0.08, 'stone_slab');                   // socle cap
  band(U0 - 0.15, 0.22, 0.07, 'plaster_ext_grey');             // storey band
  band(H.EAVE - 0.25, 0.3, 0.12, 'plaster_ext_grey');          // eaves cornice
  band(H.EAVE - 0.08, 0.1, 0.2, 'plaster_ext_grey');
  for (const [x, z] of [[H.X0, H.Z0], [H.X1, H.Z0], [H.X0, H.Z1], [H.X1, H.Z1]]) {
    mb.box('plaster_ext_grey', x, (G0 + H.EAVE) / 2, z, 0.62, H.EAVE - G0, 0.62, { skip: ['ny'] });
  }
  // window surrounds (Faschen) on the façade
  for (const { wall, frame } of kit.frames) {
    if (wall.y0 < G0 - 0.4 || wall.right !== undefined && typeof wall.right === 'object' && (wall.right as any).mat === 'stone_wall') continue;
    const isExt = (wall.a[0] === WX0 || wall.a[0] === WX1 || wall.a[1] === WZ0 || wall.a[1] === WZ1) && Math.abs(wall.t - H.T) < 1e-3;
    if (!isExt) continue;
    for (const w of wall.windows ?? []) {
      const o = w.o;
      const out = H.T / 2 + 0.025;
      const P = (s: number, y: number) => [frame.ax + frame.dx * s + frame.rx * out, frame.y0 + y, frame.az + frame.dz * s + frame.rz * out];
      const ry = -Math.atan2(frame.dz, frame.dx);
      const fw = 0.16;
      const seg = (s0: number, s1: number, ya: number, yb: number) => {
        const c = P((s0 + s1) / 2, (ya + yb) / 2);
        mb.pushTRS(c[0], c[1], c[2], ry);
        mb.box('plaster_ext_grey', 0, 0, 0, s1 - s0, yb - ya, 0.05, { skip: ['nz'] });
        mb.pop();
      };
      seg(o.at - o.width / 2 - fw, o.at - o.width / 2, o.bottom - 0.05, o.top + fw);
      seg(o.at + o.width / 2, o.at + o.width / 2 + fw, o.bottom - 0.05, o.top + fw);
      seg(o.at - o.width / 2, o.at + o.width / 2, o.top, o.top + fw);
      // small keystone-like cornice over ground floor windows
      if (wall.y0 < U0 - 1) seg(o.at - o.width / 2 - fw - 0.08, o.at + o.width / 2 + fw + 0.08, o.top + fw, o.top + fw + 0.08);
    }
  }

  // entrance portico with balcony and steps
  for (const x of [-1.45, 1.45]) {
    mb.box('plaster_ext_grey', x, (0 + U0 - 0.25) / 2, -13.7, 0.45, U0 - 0.25, 0.45);
    mb.box('stone_slab', x, 0.35, -13.7, 0.6, 0.7, 0.6);
    physics?.addBox({ cx: x, cy: U0 / 2, cz: -13.7, hx: 0.23, hy: U0 / 2, hz: 0.23, surface: 'stone' });
  }
  buildSlab(mb, -2.0, -15.0, 2.0, -13.3, U0, 0.28, 'floor_tiles', 'plaster_ext_grey', physics, 'tile');
  mb.box('plaster_ext_grey', 0, U0 - 0.14, -13.3 - 0.02, 4.0, 0.3, 0.06);
  balustrade(mb, physics, [[-1.95, -15.0], [-1.95, -13.35], [1.95, -13.35], [1.95, -15.0]], U0, 'iron_black', 1.0, true);
  for (let i = 0; i < 4; i++) {
    const y = G0 - (i + 1) * 0.1875;
    const z0 = -15.0 + i * 0.32;
    buildSlab(mb, -2.4 - i * 0.15, z0, 2.4 + i * 0.15, z0 + 0.34, y + 0.1875, 0.1875 + 0.6, 'stone_slab', null, physics, 'stone');
    mb.box('stone_slab', 0, y + 0.1875 / 2 - 0.3, z0 + 0.34, 4.8 + i * 0.3, 0.1875 + 0.6, 0.02, { skip: ['nz'] });
  }

  // terrace at the back (garden side), in front of the dining-room French doors
  const TX = -8.3;
  buildSlab(mb, TX - 4.3, -32.2, TX + 4.3, -29.0, G0 - 0.45, 0.3, 'stone_slab', null, physics, 'stone');
  mb.box('stone_slab', TX, (G0 - 0.45) / 2 - 0.15, -32.2, 8.6, G0 - 0.15, 0.04);
  mb.box('stone_slab', TX - 4.3, (G0 - 0.45) / 2 - 0.15, -30.6, 0.04, G0 - 0.15, 3.2);
  mb.box('stone_slab', TX + 4.3, (G0 - 0.45) / 2 - 0.15, -30.6, 0.04, G0 - 0.15, 3.2);
  // step up from terrace to the door sill
  buildSlab(mb, TX - 0.9, -29.4, TX + 0.9, -29.0, G0 - 0.22, 0.25, 'stone_slab', null, physics, 'stone');
  for (let i = 0; i < 2; i++) buildSlab(mb, TX - 1.4, -32.2 - (i + 1) * 0.32, TX + 1.4, -32.2 - i * 0.32, G0 - 0.45 - (i + 1) * 0.15, 0.6, 'stone_slab', null, physics, 'stone');

  // roof (hipped, Biberschwanz tiles) and chimneys
  const roof = buildRoof(mb, { type: 'hip', x0: H.X0, z0: H.Z0, x1: H.X1, z1: H.Z1, eaveY: H.EAVE, pitch: (47 * Math.PI) / 180, overhang: 0.75, thickness: 0.24, innerMat: 'rough_timber', rafters: { mat: 'rough_timber', spacing: 0.95, size: 0.16 }, gutterMat: 'rust_metal' }, physics);
  // chimney stacks rise ~1.1 m above the tiles where they pierce the roof
  const chimTop = (x: number, z: number) => roof.innerHeight(x, z) + 0.24 + 1.1;
  buildChimney(mb, -6.2, -22.2, Bc, chimTop(-6.2, -22.2), 0.7, 0.55);
  buildChimney(mb, 6.6, -24.5, Bc, chimTop(6.6, -24.5), 0.65, 0.55);
  if (physics) {
    physics.addBox({ cx: -6.2, cy: (Bc + chimTop(-6.2, -22.2)) / 2, cz: -22.2, hx: 0.35, hy: (chimTop(-6.2, -22.2) - Bc) / 2, hz: 0.28, surface: 'stone' });
    physics.addBox({ cx: 6.6, cy: (Bc + chimTop(6.6, -24.5)) / 2, cz: -24.5, hx: 0.33, hy: (chimTop(6.6, -24.5) - Bc) / 2, hz: 0.28, surface: 'stone' });
  }
  // downpipes at the corners
  for (const [x, z] of [[H.X0 - 0.75, H.Z0 - 0.75], [H.X1 + 0.75, H.Z0 - 0.75], [H.X0 - 0.75, H.Z1 + 0.75], [H.X1 + 0.75, H.Z1 + 0.75]]) {
    const top = H.EAVE - 0.75 * Math.tan((47 * Math.PI) / 180) - 0.3;
    const px = x + Math.sign(-x) * 0.6, pz = z + Math.sign(-(z + 22)) * 0.6;
    mb.rod('rust_metal', new THREE.Vector3(x + Math.sign(-x) * 0.12, top, z + Math.sign(-(z + 22)) * 0.12), new THREE.Vector3(px, top - 0.4, pz), 0.045);
    mb.rod('rust_metal', new THREE.Vector3(px, top - 0.4, pz), new THREE.Vector3(px, 0.25, pz), 0.045);
    mb.rod('rust_metal', new THREE.Vector3(px, 0.25, pz), new THREE.Vector3(px + Math.sign(-x) * -0.2, 0.05, pz), 0.045);
  }

  // ======================================================================= lights & spans
  kit.light({ id: 'light:manor_hall', position: new THREE.Vector3(0, Gc - 0.9, -22.8), kind: 'pendant', working: false, flicker: 0, room: 'g_hall' });
  kit.light({ id: 'light:manor_kitchen', position: new THREE.Vector3(9.4, Gc - 0.6, -24.9), kind: 'bulb', working: true, flicker: 0.35, color: 0xffc98a, intensity: 6, room: 'g_kitchen' });
  kit.light({ id: 'light:manor_b_corridor', position: new THREE.Vector3(0, Bc - 0.25, -21.0), kind: 'bulb', working: true, flicker: 0.6, color: 0xffb870, intensity: 4, room: 'b_corridor' });
  kit.light({ id: 'light:manor_sealed', position: new THREE.Vector3(-9.8, Bc - 0.3, -25.4), kind: 'bulb', working: true, flicker: 0.1, color: 0xffa860, intensity: 2.2, room: 'b_sealed' });
  kit.light({ id: 'light:manor_salon', position: new THREE.Vector3(-7.8, Gc - 0.8, -18.8), kind: 'pendant', working: false, flicker: 0, room: 'g_salon' });
  kit.light({ id: 'light:manor_marie', position: new THREE.Vector3(5.5, Uc - 0.4, -18.3), kind: 'bulb', working: false, flicker: 0, room: 'u_marie' });

  kit.span({ x0: H.X0 + 0.3, z0: H.Z0 + 0.3, x1: H.X1 - 0.3, z1: H.Z1 - 0.3, floorY: B0 - 0.05, ceil: (x, z) => roof.innerHeight(x, z) });
  kit.span({ x0: -2.0, z0: -15.0, x1: 2.0, z1: -13.3, floorY: G0 - 0.1, ceil: U0 - 0.28 }); // under the portico
  kit.span({ x0: -2.5, z0: -14.8, x1: 2.5, z1: -13.1, floorY: -0.2, ceil: U0 - 0.28 });

  // story anchors (props & documents are placed against these)
  kit.anchor('hall_table', -2.2, G0, -16.5, Math.PI / 2, 'g_vestibule');
  kit.anchor('kitchen_doorframe', 6.2, G0, -22.65, Math.PI / 2, 'g_kitchen');

  void materials; void sealed; void buildCornice; void plaster; void uSew;
  const group = mb.build(materials, { name: 'manor' });
  return kit.output(group);
}

/** Simple post-and-rail balustrade along a polyline (iron or timber). */
export function balustrade(mb: import('../architecture/MeshBuilder').MeshBuilder, physics: Physics | undefined, pts: [number, number][], y: number, mat: string, h = 0.95, iron = false): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const a = new THREE.Vector3(ax, y + h, az), b = new THREE.Vector3(bx, y + h, bz);
    mb.beam(mat, a, b, iron ? 0.04 : 0.07, iron ? 0.03 : 0.06);
    mb.beam(mat, new THREE.Vector3(ax, y + 0.1, az), new THREE.Vector3(bx, y + 0.1, bz), iron ? 0.03 : 0.05, 0.04);
    const n = Math.max(1, Math.round(len / (iron ? 0.12 : 0.14)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const post = k === 0 || k === n;
      if (iron) mb.box(mat, x, y + h / 2, z, post ? 0.05 : 0.016, h, post ? 0.05 : 0.016);
      else mb.box(mat, x, y + h / 2, z, post ? 0.09 : 0.03, h, post ? 0.09 : 0.03);
    }
    physics?.addBox({ cx: (ax + bx) / 2, cy: y + h / 2, cz: (az + bz) / 2, hx: len / 2, hy: h / 2, hz: 0.04, ry: -Math.atan2(bz - az, bx - ax), surface: iron ? 'metal' : 'wood' });
  }
}
