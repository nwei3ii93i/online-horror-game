import type { DocPlacement } from './DocumentProps';
import { SacredDatum, onSacredLevels, sacredPoint, sacredYaw } from '../buildings/Sacred';

/**
 * Documents in the greenhouse, the chapel and the hunting stand. Heights follow the floors the
 * builders in buildings/Sacred.ts derive from the terrain, so SACRED_DOCS is refreshed whenever
 * one of them has run (read it after World.build()).
 */
const SPECS: { id: string; d: SacredDatum; x: number; y: number; z: number; rot: number }[] = [
  // on the potting bench by the raised bed, between the seed trays and the soil heap
  { id: 'greenhouse_seed_packet', d: 'gh', x: 33.18, y: 0.861, z: -42.35, rot: 0.42 },
  // on the altar step beside the candle stubs
  { id: 'drawing_chapel_undated', d: 'chapel', x: 50.02, y: 0.161, z: -110.0, rot: -0.3 },
  // on the gun rest under the shooting window of the hunting stand (stand-local frame)
  { id: 'search_card_1987', d: 'stand', x: -0.22, y: 0.916, z: 0.6, rot: 0.25 },
];

export const SACRED_DOCS: DocPlacement[] = [];

export function resolveSacredDocs(): DocPlacement[] {
  SACRED_DOCS.length = 0;
  for (const s of SPECS) {
    const [x, y, z] = sacredPoint(s.d, s.x, s.y, s.z);
    SACRED_DOCS.push({ id: s.id, x, y, z, rot: s.rot + sacredYaw(s.d) });
  }
  return SACRED_DOCS;
}
onSacredLevels(resolveSacredDocs);
