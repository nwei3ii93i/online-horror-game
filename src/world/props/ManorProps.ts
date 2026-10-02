import { MANOR } from '../buildings/Manor';
import type { PropPlacer, PropOptions } from './PropPlacer';

/**
 * Furnishing of the manor with CC0 photoscans. Front of every model = +Z at ry = 0.
 * Rooms are dressed for the story (see story/README.md): an orderly house frozen in the
 * late 1980s, a wheelchair at the top of the stairs, a child's room nobody cleared, and a
 * sealed coal cellar that was lived in.
 */
export type PropPlacement = P;
type P = [id: string, x: number, y: number, z: number, ry?: number, o?: PropOptions];

const { B0, G0, U0, A0 } = MANOR;
const Gc = U0 - 0.35;
const PI = Math.PI, H = PI / 2;
const none: PropOptions = { collider: 'none' };
const wall: PropOptions = { anchor: 'back', collider: 'none' };

export const MANOR_PROPS: P[] = [
  // ---------------------------------------------------------------- ground floor
  // vestibule
  ['painted_wooden_nightstand', -2.58, G0, -16.9, H],
  ['wall_clock', -2.85, G0 + 1.95, -17.2, H, wall],
  ['rubber_boots', 2.3, G0, -17.5, -H + 0.3, none],
  // hall
  ['vintage_grandfather_clock_01', -2.43, G0, -21.4, H],
  ['GothicCommode_01', 2.55, G0, -21.0, -H],
  ['ornate_mirror_01', 2.85, G0 + 1.98, -21.0, -H, wall],
  ['mantel_clock_01', 2.6, G0 + 1.21, -21.25, -H, none],
  // salon
  ['Sofa_01', -9.6, G0, -17.25, PI],
  ['WoodenTable_01', -9.6, G0, -18.6, 0.04],
  ['ArmChair_01', -11.4, G0, -19.4, H + 0.6],
  ['ArmChair_01', -7.7, G0, -19.3, -H - 0.5],
  ['painted_wooden_nightstand', -9.8, G0, -21.78, 0],
  ['Television_01', -9.8, G0 + 0.62, -21.8, 0.1, none],
  ['Rockingchair_01', -5.0, G0, -16.6, PI + 0.5],
  ['wooden_bookshelf_worn', -12.15, G0, -21.0, H],
  ['book_encyclopedia_set_01', -11.55, G0, -21.75, 0.3, none],
  ['hanging_picture_frame_02', -5.0, G0 + 1.85, -22.1, 0, wall],
  ['fancy_picture_frame_01', -3.15, G0 + 1.75, -16.9, -H, wall],
  ['standing_picture_frame_01', -9.2, G0 + 0.55, -18.55, PI - 0.4, none],
  // dining room (entered from the terrace)
  ['dining_table', -7.8, G0, -25.3, 0],
  ['dining_chair_02', -8.4, G0, -26.22, 0.05],
  ['dining_chair_02', -7.15, G0, -26.3, -0.12],
  ['dining_chair_02', -8.45, G0, -24.35, PI + 0.06],
  ['dining_chair_02', -7.1, G0, -24.1, PI - 0.35],
  ['dining_chair_02', -9.25, G0, -25.3, H],
  ['dining_chair_02', -5.6, G0 + 0.22, -24.1, 0.7, { tiltZ: H }],          // knocked over
  ['Chandelier_01', -7.8, Gc, -25.3, 0.2, { anchor: 'top', collider: 'none' }],
  ['vintage_cabinet_01', -10.8, G0, -22.66, PI],
  ['tea_set_01', -8.2, G0 + 0.88, -25.45, 0.2, none],
  ['wine_bottles_01', -7.2, G0 + 0.88, -25.0, -0.3, none],
  ['drawer_cabinet', -3.42, G0, -26.6, -H],
  // study (locked)
  ['WoodenTable_03', 5.6, G0, -16.2, PI],
  ['painted_wooden_chair_01', 5.75, G0, -16.95, 0.25],
  ['vintage_oil_lamp', 5.05, G0 + 0.83, -16.25, 0, none],
  ['standing_picture_frame_01', 6.05, G0 + 0.83, -16.05, PI + 0.3, none],
  ['drawer_cabinet', 3.42, G0, -16.6, H],
  ['wooden_bookshelf_worn', 5.0, G0, -20.77, 0],
  ['Shelf_01', 6.95, G0, -20.92, 0],
  ['ArmChair_01', 7.1, G0, -19.6, -H - 0.5],
  // library
  ['wooden_bookshelf_worn', 9.0, G0, -20.77, 0],
  ['wooden_bookshelf_worn', 10.62, G0, -20.77, 0],
  ['Shelf_01', 12.3, G0, -19.6, -H],
  ['ArmChair_01', 11.4, G0, -16.6, PI + 0.6],
  ['book_encyclopedia_set_01', 8.9, G0, -19.6, 1.2, none],
  ['book_encyclopedia_set_01', 9.7, G0, -16.3, 0.4, none],
  ['WoodenTable_01', 10.1, G0, -18.2, H + 0.1],
  ['Lantern_01', 10.0, G0 + 0.55, -18.0, 0.5, none],
  // ground corridor & pantry
  ['vintage_telephone_wall_clock', 3.15, G0 + 1.55, -24.6, H, wall],
  ['wooden_broom', 5.9, G0, -24.9, -H, { tiltX: -0.12, collider: 'none' }],
  ['rubber_boots', 5.65, G0, -21.8, -H, none],
  ['steel_frame_shelves_01', 4.0, G0, -28.17, 0],
  ['steel_frame_shelves_01', 3.42, G0, -26.9, H],
  ['wicker_basket_01', 5.5, G0, -26.5, 0.4, none],
  ['can_rusted', 5.2, G0, -27.9, 0, none],
  ['can_rusted', 5.35, G0, -27.75, 1.1, none],
  ['russian_food_cans_01', 5.6, G0, -28.0, 0.2, none],
  // kitchen
  ['painted_wooden_table', 9.6, G0, -24.6, 0],
  ['painted_wooden_chair_01', 9.0, G0, -25.55, 0.15],
  ['painted_wooden_chair_01', 10.3, G0, -23.6, PI - 0.2],
  ['painted_wooden_chair_01', 7.75, G0, -24.4, H + 0.3],
  ['pot_enamel_01', 9.2, G0 + 0.96, -24.5, 0.3, none],
  ['russian_food_cans_01', 10.2, G0 + 0.96, -24.8, 0, none],
  ['russian_food_cans_01', 10.36, G0 + 0.96, -24.68, 0.8, none],
  ['painted_wooden_cabinet', 10.8, G0, -21.66, PI],
  ['wall_clock', 6.3, G0 + 2.0, -26.0, H, wall],
  ['wooden_bucket_01', 7.3, G0, -27.9, 0.5, none],

  // ---------------------------------------------------------------- upper floor
  // gallery: an empty wheelchair at the top of the stairs
  ['wheelchair_01', -0.6, U0, -22.9, PI + 0.25],
  // sewing room
  ['spinning_wheel_01', -1.9, U0, -16.6, H + 0.3],
  ['wicker_basket_01', -1.15, U0, -17.6, 0.2, none],
  ['ArmChair_01', 1.9, U0, -16.5, -H - 0.4],
  // master bedroom
  ['GothicBed_01', -6.6, U0, -21.06, 0],
  ['ClassicNightstand_01', -7.75, U0, -21.85, 0],
  ['ClassicNightstand_01', -5.45, U0, -21.85, 0],
  ['vintage_oil_lamp', -7.75, U0 + 0.7, -21.85, 0, none],
  ['GothicCabinet_01', -11.88, U0, -20.8, H],
  ['ornate_mirror_01', -3.15, U0 + 1.5, -21.0, -H, wall],
  ['vintage_suitcase', -9.5, U0, -17.0, 0.3, none],
  // grandmother's room
  ['old_bed_frame', -11.43, U0, -23.6, H],
  ['painted_wooden_nightstand', -11.6, U0, -22.75, PI],
  ['standing_picture_frame_01', -11.6, U0 + 0.62, -22.75, PI + 0.2, none],
  ['Rockingchair_01', -10.4, U0, -27.5, 0.4],
  ['vintage_crutches_01', -12.25, U0, -25.0, H, none],
  ['drawer_cabinet', -6.4, U0, -26.5, -H],
  // bathroom
  ['rubber_duck_toy', -4.2, U0, -27.6, 0.6, none],
  // Marie's room (left exactly as it was in November 1987)
  ['old_bed_frame', 6.9, U0, -20.05, 0],
  ['ClassicNightstand_01', 5.95, U0, -20.8, 0],
  ['Shelf_01', 3.3, U0, -16.6, H],
  ['WoodenTable_03', 5.6, U0, -15.85, PI],
  ['painted_wooden_chair_01', 5.6, U0, -16.55, 0],
  ['standing_picture_frame_01', 5.2, U0 + 0.83, -15.8, PI + 0.2, none],
  // Thomas' room
  ['vintage_day_bed', 10.2, U0, -20.62, 0],
  ['painted_wooden_nightstand', 11.9, U0, -16.4, -H - 0.4],
  ['Television_01', 11.9, U0 + 0.62, -16.4, -H - 0.4, none],
  ['wooden_crate_01', 8.7, U0, -16.2, 0.2],
  ['hanging_picture_frame_02', 8.075, U0 + 1.6, -20.0, H, wall],
  // upper corridor, storage, guest room
  ['cardboard_box_01', 5.6, U0, -22.0, 0.3],
  ['cardboard_box_01', 5.55, U0, -26.4, -0.2],
  ['vintage_suitcase', 4.8, U0, -26.2, 1.2, none],
  ['old_bed_frame', 10.0, U0, -27.42, 0],
  ['painted_wooden_cabinet', 7.0, U0, -27.9, 0],
  ['wooden_ladder', 12.1, U0, -23.5, -H, { tiltX: -0.25 }],

  // ---------------------------------------------------------------- basement
  ['power_box_01', -2.85, B0 + 1.55, -21.6, H, wall],
  ['metal_jerrycan', 2.4, B0, -16.4, -0.4, none],
  // coal cellar
  ['Barrel_01', -11.6, B0, -16.4, 0],
  ['Barrel_01', -10.9, B0, -16.3, 1.0],
  ['old_tyre', -4.2, B0 + 0.3, -16.3, 0, { tiltX: H, collider: 'none' }],
  ['wooden_crate_02', -6.0, B0, -16.2, 0.1],
  // boiler cellar: the jar shelf lies on THIS side of the sealed wall – pushed from within
  ['steel_frame_shelves_01', -5.9, B0 + 0.27, -27.15, H + 0.35, { tiltX: -H }],
  ['Lantern_01', -4.0, B0, -23.0, 0.7, none],
  // sealed room
  ['treasure_chest', -11.75, B0, -23.0, H],
  ['wicker_basket_01', -8.0, B0, -27.9, 0.3, none],
  ['wooden_bucket_01', -7.8, B0, -23.0, 0, none],
  ['pot_enamel_01', -9.6, B0, -27.9, 0.6, none],
  ['russian_food_cans_01', -10.4, B0, -28.05, 0, none],
  ['russian_food_cans_01', -10.25, B0, -27.95, 1.4, none],
  ['can_rusted', -10.6, B0, -27.8, 0.2, none],
  ['vintage_oil_lamp', -12.1, B0, -26.0, 0.3, none],
  ['standing_picture_frame_01', -11.8, B0 + 0.62, -23.1, H - 0.3, none],
  // storage cellar
  ['worn_metal_rack', 4.0, B0, -20.75, 0],
  ['steel_frame_shelves_01', 5.4, B0, -20.8, 0],
  ['wooden_crate_01', 7.5, B0, -16.1, 0.2],
  ['wooden_crate_02', 8.9, B0, -16.15, -0.1],
  ['cardboard_box_01', 10.5, B0, -16.0, 0.4],
  ['cardboard_box_01', 10.6, B0 + 0.52, -16.05, 0.1],
  ['metal_tool_chest', 11.9, B0, -18.5, -H],
  ['old_tyre', 11.8, B0, -20.4, 0, none],
  ['propane_tank', 7.0, B0, -20.7, 0],
  ['sledgehammer_01', 3.45, B0, -16.0, H, { tiltX: -0.3, collider: 'none' }],
  ['rusted_spade_01', 3.45, B0, -16.6, H, { tiltX: -0.25, collider: 'none' }],
  ['Barrel_01', 11.9, B0, -16.1, 0],
  // laundry & potato cellar
  ['wooden_bucket_01', 4.0, B0, -27.8, 0, none],
  ['wicker_basket_01', 5.4, B0, -27.9, 0.6, none],
  ['wooden_crate_01', 7.2, B0, -27.9, 0],
  ['wooden_crate_01', 7.3, B0 + 0.41, -27.85, 0.15],
  ['Barrel_01', 8.2, B0, -22.0, 0],

  // ---------------------------------------------------------------- attic
  ['cardboard_box_01', 1.6, A0, -22.2, 0.5],                 // "Kleider 128–134" – empty
  ['vintage_suitcase', -1.6, A0, -21.0, -0.4, none],
  ['wooden_crate_02', -4.5, A0, -22.0, 0.2],
  ['wooden_crate_01', -4.4, A0 + 0.41, -22.05, -0.3],
  ['spinning_wheel_01', 6.0, A0, -21.5, 2.0],
  ['GothicCommode_01', -8.0, A0, -22.0, 0.15],
  ['Rockingchair_01', 3.8, A0, -24.0, 2.6],
  ['wicker_basket_01', -2.4, A0, -24.2, 0.1, none],
];

/** Board heights (top surfaces) of wooden_bookshelf_worn, measured from the scan. */
const BOOKSHELF_BOARDS = [0.1, 0.4, 0.68, 0.96, 1.28, 1.66];

/** Fill a wooden_bookshelf_worn at (x, y, z, ry) with encyclopedia sets, leaving gaps. */
function shelfBooks(x: number, y: number, z: number, ry: number, seed: number, fill = 0.7): P[] {
  const out: P[] = [];
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const by of BOOKSHELF_BOARDS) {
    for (const lx of [-0.33, 0.3]) {
      if (rnd() > fill) continue;
      const ox = lx + (rnd() - 0.5) * 0.06, oz = 0.02;
      out.push(['book_encyclopedia_set_01', x + ox * c + oz * s, y + by + 0.003, z - ox * s + oz * c, ry + (rnd() - 0.5) * 0.06, { collider: 'none', castShadow: false }]);
    }
  }
  return out;
}

MANOR_PROPS.push(
  ...shelfBooks(9.0, G0, -20.77, 0, 11),
  ...shelfBooks(10.62, G0, -20.77, 0, 23, 0.6),
  ...shelfBooks(5.0, G0, -20.77, 0, 37, 0.55),
  ...shelfBooks(-12.15, G0, -21.0, H, 51, 0.5),
);

/** Ids to preload. */
export const MANOR_PROP_IDS = [...new Set(MANOR_PROPS.map((p) => p[0]))];

export function placeManorProps(placer: PropPlacer): void {
  for (const [id, x, y, z, ry = 0, o = {}] of MANOR_PROPS) placer.place(id, x, y, z, ry, o);
}
