import type { PropPlacement } from './ManorProps';
import type { PropOptions, PropPlacer } from './PropPlacer';
import {
  GREENHOUSE_POTS, GREENHOUSE_POTTING_BENCH, GREENHOUSE_TRAYS, NAMELESS_CROSS, SacredDatum, onSacredLevels, sacredPoint, sacredYaw,
} from '../buildings/Sacred';

/**
 * Photoscan dressing for the greenhouse, chapel + crypt, cemetery and hunting stand
 * (front of every model = +Z at ry = 0). Positions are authored relative to a datum because
 * the chapel, the cemetery and the hunting stand follow the terrain:
 *   'gh'          greenhouse floor            'chapel'  chapel (nave) floor
 *   'crypt'       crypt floor                 'ground'  terrain at (x, z)
 *   'stand'       hunting stand local frame (x, z), y above the cabin floor
 *   'standGround' hunting stand local frame (x, z), y above the terrain there
 * SACRED_PROPS holds the resolved absolute placements and is refreshed whenever one of the
 * builders in buildings/Sacred.ts has run.
 */
type Spec = [id: string, datum: SacredDatum, x: number, y: number, z: number, ry?: number, o?: PropOptions];

const PI = Math.PI, H = PI / 2;
const none: PropOptions = { collider: 'none' };
const PB = GREENHOUSE_POTTING_BENCH;

const SPECS: Spec[] = [
  // ---------------------------------------------------------------- greenhouse
  ...GREENHOUSE_POTS.map((p): Spec => ['planter_pot_clay', 'gh', p.x, p.y, p.z, p.ry, p.state === 'fallen' ? { tiltZ: H, collider: 'none' } : none]),
  ...GREENHOUSE_TRAYS.map((t): Spec => ['seeding_tray_01', 'gh', t.x, t.y, t.z, t.ry, none]),
  ['watering_can_metal_01', 'gh', 30.75, 0, -40.35, 0.35, none],             // beside the raised bed, still wet
  ['wooden_bucket_01', 'gh', 19.62, 0, -40.85, 0.4, none],                  // just inside the door
  ['wicker_basket_01', 'gh', 30.65, 0, -39.75, -0.2, none],
  ['wooden_stool_01', 'gh', 32.45, 0, -42.25, 0.6],
  ['Lantern_01', 'gh', PB.x1 - 0.12, PB.shelf, PB.z0 + 0.45, 2.2, none],   // on the shelf above the potting bench
  ['rusted_spade_01', 'gh', 19.42, 0, -43.9, H, { tiltX: -0.22, collider: 'none' }],
  ['wooden_crate_01', 'gh', 21.4, 0, -44.3, 0.05],                            // under the north bench
  ['wooden_crate_01', 'gh', 26.9, 0, -44.32, -0.08],
  ['planter_pot_clay', 'gh', 24.2, 0, -44.4, 0.3, none],                      // stacks under the benches
  ['planter_pot_clay', 'gh', 24.2, 0.2, -44.4, 1.1, none],
  ['planter_pot_clay', 'gh', 24.55, 0, -44.38, 2.0, none],
  ['planter_pot_clay', 'gh', 29.3, 0, -39.62, 0.9, none],
  ['planter_pot_clay', 'gh', 29.3, 0.2, -39.62, 2.4, none],
  ['Barrel_01', 'ground', 34.45, 0, -45.45, 0.4],                             // rain barrel under the downpipe
  ['nettle_plant', 'ground', 34.6, 0, -43.0, 1.4, none],
  ['nettle_plant', 'ground', 22.0, 0, -45.55, 0.2, none],

  // ---------------------------------------------------------------- chapel & crypt
  ['wicker_basket_01', 'chapel', 53.05, 0, -109.55, H + 0.3, none],          // spare candles under the votive picture
  ['Lantern_01', 'crypt', 53.05, 0, -109.6, 0.8, none],                       // at the foot of the crypt stair
  ['Lantern_01', 'crypt', 50.35, 1.05, -109.86, 0.2, none],                   // on the shrine shelf
  ['wooden_crate_01', 'crypt', 50.75, 0, -104.95, 0.1],
  ['wooden_bucket_01', 'crypt', 51.55, 0, -105.55, 0.6, none],

  // ---------------------------------------------------------------- cemetery
  ['wooden_bucket_01', 'ground', 45.75, 0, -97.35, 0.3, none],               // by the water trough
  ['watering_can_metal_01', 'ground', 44.45, 0, -97.4, -0.6, none],
  ['dry_branches_medium_01', 'ground', 42.3, 0.12, -112.85, 0.4, none],      // on the compost heap
  ['nettle_plant', 'ground', 41.9, 0, -111.8, 0.8, none],
  ['nettle_plant', 'ground', 44.35, 0, -113.3, 0, none],
  ['fern_02', 'ground', 46.9, 0, -112.6, 0.2, none],
  ['fern_02', 'ground', 59.9, 0, -97.4, 1.9, none],
  ['moss_01', 'ground', 41.65, 0, -104.0, H, none],
  ['moss_01', 'ground', 55.1, 0, -113.35, 0.1, none],
  ['tree_stump_01', 'ground', 64.4, 0, -100.8, 0.7],
  ['boulder_01', 'ground', 39.2, 0, -108.6, 0.4],
  ['boulder_01', 'ground', 38.6, 0, -101.2, 2.3],
  // where the shovel stands: against the outside of the east wall, near the nameless cross
  ['rusted_spade_01', 'ground', 61.25, 0, NAMELESS_CROSS.z + 1.6, -H, { tiltX: 0.22, collider: 'none' }],
  ['fern_02', 'ground', NAMELESS_CROSS.x + 1.4, 0, NAMELESS_CROSS.z - 1.5, 0.6, none],
  ['moss_01', 'ground', NAMELESS_CROSS.x - 0.9, 0, NAMELESS_CROSS.z + 2.3, 2.0, none],

  // ---------------------------------------------------------------- hunting stand (local frame, +z faces the pasture)
  ['Lantern_01', 'stand', -0.2, 0.47, -0.55, 0.3, none],                     // on the bench
  ['can_rusted', 'stand', -0.2, 0.0, 0.1, 1.0, none],
  ['tree_stump_01', 'standGround', -2.6, 0, -3.4, 0.9],
  ['dry_branches_medium_01', 'standGround', 2.2, 0, -1.6, 2.1, none],
  ['fern_02', 'standGround', -2.4, 0, -0.6, 0.4, none],
  ['fern_02', 'standGround', 1.8, 0, -4.2, 2.6, none],
  ['boulder_01', 'standGround', 3.4, 0, -3.8, 1.3],
  ['dead_tree_trunk', 'standGround', -3.6, 0.12, 1.4, 0.35],
  ['nettle_plant', 'standGround', 0.9, 0, -5.0, 0.5, none],
];

/** Model ids to preload. */
export const SACRED_PROP_IDS = [...new Set(SPECS.map((s) => s[0]))];

/** Absolute placements (same tuple format as MANOR_PROPS). Valid after World.build(). */
export const SACRED_PROPS: PropPlacement[] = [];

/** Recompute SACRED_PROPS from the current SACRED_LEVELS. */
export function resolveSacredProps(): PropPlacement[] {
  SACRED_PROPS.length = 0;
  for (const [id, d, x, y, z, ry = 0, o = {}] of SPECS) {
    const [wx, wy, wz] = sacredPoint(d, x, y, z);
    SACRED_PROPS.push([id, wx, wy, wz, ry + sacredYaw(d), o]);
  }
  return SACRED_PROPS;
}
onSacredLevels(resolveSacredProps);

/** Place every sacred prop (use a PropPlacer that is not culled to the manor). */
export function placeSacredProps(placer: PropPlacer): void {
  for (const [id, x, y, z, ry = 0, o = {}] of resolveSacredProps()) placer.place(id, x, y, z, ry, o);
}
