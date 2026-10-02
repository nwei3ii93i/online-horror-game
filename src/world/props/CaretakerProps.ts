import type { PropPlacement } from './ManorProps';
import type { PropPlacer, PropOptions } from './PropPlacer';
import { CARETAKER, CARETAKER_SPOTS, GATE_FRAME, SHED_FRAME, Frame2, frameToWorld, chopBlockTop } from '../buildings/Caretaker';

/**
 * Furnishing of the caretaker's house, the woodshed and the gate with CC0 photoscans
 * (public/assets/manifest.json; front of every model = +Z at ry = 0).
 *
 * Josef's house is sparse and orderly – a carpenter's things, a few holy pictures – and it is
 * still used: the kitchen is the warm room, the bed is made, the water bucket is full, the spade
 * leans in the woodshed "where the shovel stands" (log 2001–03).
 *
 * Interior heights are fixed (house floors). Outdoor props stand on the terrain: use
 * caretakerProps(heightAt) for exact heights with any seed; CARETAKER_PROPS has them baked for
 * the default seed 1987.
 */
const { C0, G0, A0, PORCH, CRAWL } = CARETAKER;
const S = CARETAKER_SPOTS;
const PI = Math.PI, H = PI / 2;
const none: PropOptions = { collider: 'none' };
const wall: PropOptions = { anchor: 'back', collider: 'none' };

const INTERIOR: PropPlacement[] = [
  // ---------------------------------------------------------------- kitchen (Wohnküche)
  // (the table's west end stays free: that is the way to the foot of the attic ladder)
  ['painted_wooden_chair_01', S.kitchenTable.x - 0.27, G0, S.kitchenTable.z + 0.7, PI - 0.06],
  ['painted_wooden_chair_01', S.kitchenTable.x + 0.3, G0, S.kitchenTable.z + 0.74, PI + 0.12],
  ['painted_wooden_cabinet', 31.665, G0, 3.4, -H],                                    // Kredenz on the east wall
  ['wall_clock', 31.975, G0 + 1.98, 3.4, -H, wall],
  ['wicker_basket_01', 31.68, G0 + 1.18, 3.05, -H + 0.2, none],                      // on the Kredenz
  ['pot_enamel_01', S.stove.x + 0.12, S.stove.top, S.stove.z - 0.02, 0.4, none],      // on the hot plate (east ring)
  ['wooden_bucket_01', 31.74, G0, 1.78, 0.4, none],                                  // water, full
  ['Lantern_01', S.kitchenTable.x - 0.42, S.kitchenTable.top, S.kitchenTable.z - 0.18, 0.3, none],
  ['wooden_broom', 31.86, G0, 4.16, -H, { tiltX: -0.1, collider: 'none' }],

  // ---------------------------------------------------------------- larder (Speis)
  ['steel_frame_shelves_01', 32.98, G0, 4.02, PI],
  ['russian_food_cans_01', S.larderShelf.x0 + 0.15, G0 + S.larderShelf.boards[0] + 0.0125, 2.9, H, none],
  ['russian_food_cans_01', S.larderShelf.x0 + 0.15, G0 + S.larderShelf.boards[0] + 0.0125, 3.08, H + 0.3, none],
  ['can_rusted', S.larderShelf.x0 + 0.16, G0 + S.larderShelf.boards[0] + 0.0125, 3.62, 0, none],
  ['can_rusted', S.larderShelf.x0 + 0.14, G0 + S.larderShelf.boards[3] + 0.0125, 3.3, 0.5, none],
  ['wicker_basket_01', 32.64, G0, 3.55, H, none],

  // ---------------------------------------------------------------- living room (Stube)
  ['Rockingchair_01', 28.36, G0, 5.2, H + 0.15],                                     // by the shelf, facing the tiled stove
  ['Shelf_01', 27.63, G0, 5.05, H],
  ['hanging_picture_frame_02', 28.35, G0 + 1.95, 4.525, 0, wall],
  ['wicker_basket_01', 28.5, G0, 5.84, 0.6, none],                                   // knitting basket

  // ---------------------------------------------------------------- bedroom
  ['old_bed_frame', 34.03, G0, 5.55, 0],                                             // headboard against the spine wall
  ['ClassicNightstand_01', 33.25, G0, 4.76, 0],
  ['drawer_cabinet', 32.37, G0, 6.87, H],
  ['WoodenTable_03', 33.75, G0, 7.21, PI],                                           // desk under the window (no chair: the path to it stays free)

  // ---------------------------------------------------------------- porch (Vorbau)
  ['rubber_boots', 30.31, PORCH.y, 8.47, H + 0.06, none],                            // along the west wall, clear of both door leaves
  ['wooden_broom', 32.5, PORCH.y, 9.58, PI, { tiltX: -0.12, collider: 'none' }],
  ['planter_pot_clay', 30.34, PORCH.y + 0.45, 9.45, 0.4, none],                      // on the porch bench
  ['power_box_01', 32.25, PORCH.y + 1.72, PORCH.z0, 0, { anchor: 'back' }],         // fuse box (generator circuit), above head height

  // ---------------------------------------------------------------- cellar
  ['Barrel_01', 32.9, C0, 6.9, 0.4],                                                 // sauerkraut
  ['wooden_crate_01', 32.1, C0, 1.76, 0],                                            // potatoes
  ['wooden_crate_01', 32.12, C0 + 0.35, 1.77, 0.08],
  ['wooden_crate_01', 30.6, C0, 3.95, 0.05],
  ['Lantern_01', 31.05, C0 + S.jarShelf.boards[1] + 0.0125, 1.68, 0.4, none],       // next to the logbook
  ['Lantern_01', 32.3, CRAWL.y0, 8.5, 0.9, none],                                    // crawl space

  // ---------------------------------------------------------------- attic
  ['cardboard_box_01', 33.6, A0, 2.25, 0.3],
  ['cardboard_box_01', 33.62, A0 + 0.342, 2.3, 0.12],
  ['vintage_suitcase', 31.1, A0, 6.55, PI + 0.2, none],
  ['wooden_crate_02', 29.4, A0, 6.7, 0.1],
  ['spinning_wheel_01', 33.3, A0, 6.2, -0.6],
  ['treasure_chest', 31.4, A0, 2.05, 0.05],                                          // Josef's tool chest
];

/** Outdoor prop on the terrain, given in a ground frame (gate / woodshed). `dy` is added to the ground height. */
interface Outdoor { id: string; f: Frame2; lx: number; lz: number; dy: number; ry: number; o?: PropOptions; on?: 'block' }

const SY = SHED_FRAME.yaw, GY = GATE_FRAME.yaw;
const OUTDOOR: Outdoor[] = [
  // woodshed: the hatchet stuck in the chopping block, spade and sledgehammer leaning on the side wall
  { id: 'hatchet', f: SHED_FRAME, lx: 0.76, lz: 2.04, dy: -0.035, ry: SY + 0.6, o: { tiltZ: 0.25, collider: 'none' }, on: 'block' },
  { id: 'rusted_spade_01', f: SHED_FRAME, lx: 1.83, lz: 0.62, dy: 0, ry: SY + H, o: { tiltX: 0.2, collider: 'none' } },
  { id: 'sledgehammer_01', f: SHED_FRAME, lx: 1.88, lz: 0.25, dy: 0, ry: SY + H, o: { tiltX: 0.16, collider: 'none' } },
  { id: 'handsaw_wood', f: SHED_FRAME, lx: -2.08, lz: 0.45, dy: 1.35, ry: SY, o: none },
  { id: 'metal_jerrycan', f: SHED_FRAME, lx: -1.55, lz: 0.55, dy: 0, ry: SY + 0.3, o: none },
  { id: 'dry_branches_medium_01', f: SHED_FRAME, lx: -3.4, lz: -0.6, dy: 0, ry: SY + 0.4, o: none },
  { id: 'tree_stump_02', f: SHED_FRAME, lx: 3.4, lz: 2.1, dy: -0.05, ry: 1.3 },
  // the boundary wall runs out into the forest: boulders, a fallen trunk, ferns at its ends
  { id: 'boulder_01', f: GATE_FRAME, lx: 15.7, lz: -2.0, dy: -0.25, ry: 0.7 },
  { id: 'boulder_01', f: GATE_FRAME, lx: -15.6, lz: -1.9, dy: -0.3, ry: 2.1 },
  { id: 'dead_tree_trunk', f: GATE_FRAME, lx: -12.6, lz: -2.7, dy: -0.06, ry: GY + 0.18, o: { collider: 'none' } },
  { id: 'fern_02', f: GATE_FRAME, lx: 13.4, lz: -2.9, dy: 0, ry: 0.4, o: none },
  { id: 'fern_02', f: GATE_FRAME, lx: -11.2, lz: 1.4, dy: 0, ry: 2.6, o: none },
  { id: 'moss_01', f: GATE_FRAME, lx: 6.9, lz: 0.5, dy: 0, ry: GY, o: none },        // in the breach rubble
];

function resolve(p: Outdoor, base: number): PropPlacement {
  const [x, z] = frameToWorld(p.f, p.lx, p.lz);
  return [p.id, x, base + p.dy, z, p.ry, p.o ?? {}];
}

/** Ground (or chopping-block top) height under each OUTDOOR entry for the default seed 1987. */
const BAKED_1987 = [0.5095, 0.1012, 0.1109, 0.0577, 0.0600, 0.0501, 0.1071, 0.3280, 1.2417, 1.0891, 0.4320, 1.2674, 0.6951];

/** All caretaker props with exact outdoor heights for the given terrain (any seed). */
export function caretakerProps(heightAt: (x: number, z: number) => number): PropPlacement[] {
  return [...INTERIOR, ...OUTDOOR.map((p) => {
    const [x, z] = frameToWorld(p.f, p.lx, p.lz);
    return resolve(p, p.on === 'block' ? chopBlockTop(heightAt) : heightAt(x, z));
  })];
}

/** Same list with outdoor heights baked for the default seed (1987). */
export const CARETAKER_PROPS: PropPlacement[] = [...INTERIOR, ...OUTDOOR.map((p, i) => resolve(p, BAKED_1987[i] ?? 0))];

/** Ids to preload. */
export const CARETAKER_PROP_IDS = [...new Set(CARETAKER_PROPS.map((p) => p[0]))];

export function placeCaretakerProps(placer: PropPlacer, heightAt?: (x: number, z: number) => number): void {
  for (const [id, x, y, z, ry = 0, o = {}] of heightAt ? caretakerProps(heightAt) : CARETAKER_PROPS) placer.place(id, x, y, z, ry, o);
}

/** Exposed for tooling: the outdoor entries' ground sample points (to re-bake BAKED_1987). */
export function caretakerOutdoorSamples(heightAt: (x: number, z: number) => number): number[] {
  return OUTDOOR.map((p) => {
    const [x, z] = frameToWorld(p.f, p.lx, p.lz);
    return p.on === 'block' ? chopBlockTop(heightAt) : heightAt(x, z);
  });
}
