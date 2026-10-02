import type { PropPlacement } from './ManorProps';
import type { PropPlacer, PropOptions } from './PropPlacer';
import { WORKSHOP, WORKSHOP_BENCH, BARN, BARN_RACK, PUMPHOUSE, PUMPHOUSE_FIT } from '../buildings/Outbuildings';
import { TUNNEL, TUNNEL_GEOMETRY } from '../buildings/Tunnels';

/**
 * CC0 photoscans for the workshop, barn, pump house and tunnels (see public/assets/manifest.json;
 * dimensions there are [width x, depth z, height y], front = +Z at ry = 0).
 *
 * Integration (Game.load): preload OUTBUILDING_PROP_IDS together with MANOR_PROP_IDS and call
 * placeOutbuildingProps(this.props) right after placeManorProps(this.props).
 *
 * Story traces only, never a person: the covered car nobody drove since 1987, Josef's bench, the
 * hatchet missing from the pegboard (it lies on the chopping block in the barn), fourteen diesel
 * cans in a rack (decal numbers at anchor 'barn_diesel_cans'), the stopped generator with fuel
 * beside it, a lantern left by the candles at the bricked-up end of the coal gallery.
 */
const PI = Math.PI, H = PI / 2;
const none: PropOptions = { collider: 'none' };
const wall: PropOptions = { anchor: 'back', collider: 'none' };
const hang: PropOptions = { anchor: 'top', collider: 'none' };
/** old_tyre lying flat: the tilted model's centre sits 0.30 m along its local +Z from the anchor. */
const flatTyre = (x: number, y: number, z: number): PropPlacement => ['old_tyre', x, y + 0.0825, z - 0.3, 0, { tiltX: H }];

const WF = WORKSHOP.FLOOR, WE = WORKSHOP.EAVE;
const WIX0 = WORKSHOP.X0 + WORKSHOP.T, WIX1 = WORKSHOP.X1 - WORKSHOP.T, WIZ0 = WORKSHOP.Z0 + WORKSHOP.T, WIZ1 = WORKSHOP.Z1 - WORKSHOP.T;
const BF = BARN.FLOOR;
const BIX1 = BARN.X1 + 0.03 - 0.5, BIZ0 = BARN.Z0 - 0.03 + 0.5, BIZ1 = BARN.Z1 + 0.03 - 0.5;
const PB = PUMPHOUSE.B, PF = PUMPHOUSE.FLOOR;
const PIX0 = PUMPHOUSE.X0 + PUMPHOUSE.T, PIZ0 = PUMPHOUSE.Z0 + PUMPHOUSE.T;
const GEN = PUMPHOUSE_FIT.generator;
const TF = TUNNEL.F;
const { G } = TUNNEL_GEOMETRY;

export const OUTBUILDING_PROPS: PropPlacement[] = [
  // ---------------------------------------------------------------- workshop / garage
  ['covered_car', -26.6, WF, 1.55, H],                                         // nose toward the gate
  ['steel_frame_shelves_01', -32.0, WF, WIZ1 - 0.26, PI],
  ['steel_frame_shelves_01', -30.85, WF, WIZ1 - 0.26, PI],
  ['Barrel_01', -29.6, WF, WIZ1 - 0.38, 0.4],                                   // oil drum
  ['metal_jerrycan', -28.9, WF, WIZ1 - 0.18, 0.15, none],
  ['worn_metal_rack', -27.7, WF, WIZ0 + 0.31, 0],
  ['metal_tool_chest', -30.2, WF, WIZ0 + 0.21, 0],
  ['old_drill_press', -31.2, WF, WIZ0 + 0.33, 0.1],
  ['bench_vice_01', WORKSHOP_BENCH.x1 - 0.12, WORKSHOP_BENCH.top, -2.7, H, none],
  ['wooden_crate_02', -32.0, WF, 1.6, H],
  ['cardboard_box_01', -32.35, WF, 2.62, 0.3],
  ['sledgehammer_01', WIX0 + 0.3, WF, 0.85, H, { tiltX: -0.25, collider: 'none' }],
  ['rusted_spade_01', WIX0 + 0.28, WF, 1.15, H, { tiltX: -0.22, collider: 'none' }],
  flatTyre(-23.0, WF, 3.25),
  flatTyre(-23.0, WF + 0.165, 3.27),
  ['old_tyre', -23.95, WF, WIZ1 - 0.1, 0.05],
  ['propane_tank', -24.75, WF, WIZ1 - 0.22, 0],
  ['watering_can_metal_01', WIX1 - 0.27, WF, WIZ0 + 0.3, 0.5, none],
  ['power_box_01', -24.6, WF + 1.2, WIZ0, 0, wall],                              // fuses; the conduit leaves its top
  ['caged_hanging_light', -31.0, WE - 0.2, -1.6, 0.3, hang],                    // inspection lamp hung on the tie beam
  ['pull_chain_light_socket', -26.0, WE - 0.2, 1.55, 0, hang],

  // ---------------------------------------------------------------- barn
  // the fourteen diesel cans (Josef, log 1993: "cans to the barn, not into the house")
  ...BARN_RACK.cans.map((x, i): PropPlacement => ['metal_jerrycan', x, BF + BARN_RACK.lower, BARN_RACK.z, (i % 3 - 1) * 0.04, none]),
  ...BARN_RACK.cans.map((x, i): PropPlacement => ['metal_jerrycan', x, BF + BARN_RACK.upper, BARN_RACK.z, (i % 2) * 0.05 - 0.02, none]),
  ['hatchet', -33.05, BF + 0.5 + 0.013, -41.2, 0.2, { tiltZ: H, collider: 'none' }],   // on the chopping block – its place on the pegboard is empty
  ['wooden_barrels_01', -52.0, BF, BIZ1 - 2.05, 0],
  ['Barrel_01', -49.15, BF, BIZ1 - 0.75, 0.3],
  ['wooden_ladder', -50.6, BF, BIZ0 + 0.36, 0],                                  // A-frame step ladder, stands on its own
  ['wooden_crate_02', -32.4, BF, -44.5, H],
  ['wooden_crate_01', -32.35, BF + 0.464, -44.5, H + 0.15],
  ['old_tyre', -32.25, BF, BIZ1 - 0.2, 0.35],
  ['rusted_spade_01', BIX1 - 0.25, BF, -39.0, -H, { tiltX: -0.2, collider: 'none' }],
  ['sledgehammer_01', BIX1 - 0.25, BF, -39.45, -H, { tiltX: -0.22, collider: 'none' }],
  ['watering_can_metal_01', -34.3, BF, BIZ1 - 0.35, 1.0, none],
  ['wooden_bucket_01', -36.4, BF, BIZ1 - 0.6, 0.2, none],
  ['Lantern_01', -35.0, BF + 1.7, -42.5 + 0.11, 0, wall],                        // on a nail on the bay post

  // ---------------------------------------------------------------- pump house
  ['portable_generator', GEN.x, PB + GEN.pallet, GEN.z, H],                     // stopped – still warm
  ['metal_jerrycan', -28.55, PB, -50.36, H, none],
  ['metal_jerrycan', -28.55, PB, -49.96, H + 0.1, none],
  ['wooden_crate_01', PUMPHOUSE_FIT.crate.x, PB, PUMPHOUSE_FIT.crate.z, 0],    // log_1993 lies on it
  ['power_box_01', PIX0, PB + PUMPHOUSE_FIT.switchBoxY + 0.25, PUMPHOUSE_FIT.switchBoxZ, H, wall],
  ['wooden_bucket_01', -26.45, PB, -51.0, 0.3, none],
  ['Lantern_01', -28.95, PF + 0.78, PIZ0 + 0.25, 0.4, none],                    // on the ground-floor table

  // ---------------------------------------------------------------- tunnels
  ['Lantern_01', G.x0 + 0.7, TF, G.zc + 0.02, 0.5, none],                       // by the candles at the bricked-up end
  ['can_rusted', -28.0, TF, -31.25, 0.4, none],
  ['wooden_bucket_01', -27.95, TF, -46.9, 0, none],
];

/** Ids to preload. */
export const OUTBUILDING_PROP_IDS = [...new Set(OUTBUILDING_PROPS.map((p) => p[0]))];

export function placeOutbuildingProps(placer: PropPlacer): void {
  for (const [id, x, y, z, ry = 0, o = {}] of OUTBUILDING_PROPS) placer.place(id, x, y, z, ry, o);
}
