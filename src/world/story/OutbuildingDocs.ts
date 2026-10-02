import type { DocPlacement } from './DocumentProps';
import { WORKSHOP_BENCH, PUMPHOUSE, PUMPHOUSE_FIT } from '../buildings/Outbuildings';
import { TUNNEL, TUNNEL_GEOMETRY } from '../buildings/Tunnels';

/**
 * Documents in the workshop, pump house and tunnels (see story/README.md, discovery order 3–4).
 * y = top of the surface the paper lies on; wall-pinned papers use `wall` = wall normal.
 *
 * Integration (Game.load): placeDocuments([...MANOR_DOCS, ...OUTBUILDING_DOCS], ...).
 */
const B = WORKSHOP_BENCH;
const { G } = TUNNEL_GEOMETRY;
/** Height of the wooden_crate_01 photoscan (manifest) – log_1993 lies on its lid. */
const CRATE_H = 0.3496;

export const OUTBUILDING_DOCS: DocPlacement[] = [
  // workshop: Josef's bench – the November 1987 logbook and the clothes-peg bundle of Freistadt receipts
  { id: 'log_1987_11', x: (B.x0 + B.x1) / 2 - 0.06, y: B.top, z: -1.35, rot: 0.25 },
  { id: 'receipts_freistadt', x: (B.x0 + B.x1) / 2 + 0.04, y: B.top, z: -0.72, rot: -0.5 },
  // pump house basement: on the crate beside the stopped generator
  { id: 'log_1993', x: PUMPHOUSE_FIT.crate.x + 0.15, y: PUMPHOUSE.B + CRATE_H, z: PUMPHOUSE_FIT.crate.z + 0.02, rot: 0.35 },
  // service tunnel: on the candle shelf north of the coal gallery ("candles until then")
  { id: 'log_1988_q1', x: TUNNEL_GEOMETRY.L2.x0 + 0.16, y: TUNNEL.F + 1.18, z: -36.52, rot: Math.PI / 2 - 0.1 },
  // coal gallery: pinned to the bricked-up end, above the candle stubs
  { id: 'drawing_2001', x: G.x0 + 0.003, y: TUNNEL.F + 1.2, z: G.zc + 0.25, rot: 0.04, wall: [1, 0] },
];
