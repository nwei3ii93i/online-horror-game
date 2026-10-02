import type * as THREE from 'three/webgpu';
import type { AudioEngine, SoundHandle } from './AudioEngine';
import type { SoundId } from './SoundBank';

export type Stance = 'stand' | 'crouch' | 'crawl';

const TERRAIN = new Map<string, SoundId>([
  ['forest', 'step_leaves'],
  ['meadow', 'step_grass'],
  ['mud', 'step_mud'],
  ['gravel', 'step_gravel'],
  ['asphalt', 'step_concrete'],
  ['rock', 'step_stone'],
  ['moss', 'step_grass'],
]);

const SURFACES = new Map<string, SoundId>([
  ['wood', 'step_wood'],
  ['wood_old', 'step_wood_creak'],
  ['stone', 'step_stone'],
  ['tile', 'step_tile'],
  ['concrete', 'step_concrete'],
  ['metal', 'step_metal'],
  ['carpet', 'step_carpet'],
  ['hay', 'step_hay'],
  ['glass', 'glass_crunch'],
  ['water', 'step_water'],
  ['grass', 'step_grass'],
  ['leaves', 'step_leaves'],
  ['gravel', 'step_gravel'],
  ['mud', 'step_mud'],
  ['asphalt', 'step_concrete'],
  ['rock', 'step_stone'],
]);

/** Split "terrain:forest" / "terrain_forest" / "terrain/forest" / "forest" into a layer name. */
function terrainLayer(surface: string): string | null {
  const s = surface.toLowerCase();
  if (TERRAIN.has(s)) return s;
  const m = /^terrain[:_\-/. ]?(.*)$/.exec(s);
  if (!m) return null;
  return m[1] || 'forest';
}

/**
 * Map a gameplay surface tag to a footstep sound. `wet` turns soft ground muddy
 * (forest floor / moss / meadow after rain); hard surfaces stay as they are (a splash layer is
 * added by playFootstep instead).
 */
export function footstepSound(surface: string, wet: boolean): SoundId {
  const layer = terrainLayer(surface ?? '');
  if (layer !== null) {
    if (wet && (layer === 'moss' || layer === 'mud')) return 'step_mud';
    return TERRAIN.get(layer) ?? 'step_leaves';
  }
  return SURFACES.get((surface ?? '').toLowerCase()) ?? 'step_stone';
}

const STANCE_GAIN: Record<Stance, number> = { stand: 1, crouch: 0.42, crawl: 0.28 };
const STANCE_LP: Record<Stance, number> = { stand: 22050, crouch: 5200, crawl: 2600 };
const HARD = new Set<SoundId>(['step_stone', 'step_tile', 'step_concrete', 'step_wood', 'step_wood_creak', 'step_metal']);

/**
 * Play a footstep with volume / pitch / brightness shaped by gait intensity (0 = creeping,
 * 1 = sprinting) and stance. Crouching and crawling are quieter, softer and darker. On wet
 * ground, soft surfaces squelch and hard surfaces occasionally splash through puddles.
 */
export function playFootstep(
  engine: AudioEngine,
  surface: string,
  position: THREE.Vector3,
  intensity: number,
  stance: Stance,
  wet: boolean,
): SoundHandle {
  const k = Math.min(1, Math.max(0, intensity));
  const id = footstepSound(surface, wet);
  const volume = STANCE_GAIN[stance] * (0.32 + 0.68 * k) * (0.9 + 0.2 * Math.random());
  // heavier, faster gait: slightly higher pitched impacts and brighter contact
  const pitch = 0.96 + 0.08 * k;
  const lowpass = Math.min(STANCE_LP[stance], 3000 + 19000 * Math.sqrt(k));
  const h = engine.play(id, { position, volume, pitch, lowpass });
  if (wet) {
    const layer = terrainLayer(surface ?? '');
    if (HARD.has(id) && Math.random() < 0.3) {
      engine.play('step_water', { position, volume: volume * 0.35, pitch, lowpass });
    } else if ((layer === 'forest' || layer === 'meadow') && Math.random() < 0.45) {
      engine.play('step_mud', { position, volume: volume * 0.3, pitch: pitch * 1.05, lowpass });
    }
  }
  return h;
}

/** Landing after a fall: soft ground → land_soft, otherwise land_hard (plus the surface step). */
export function playLanding(engine: AudioEngine, surface: string, position: THREE.Vector3, fallSpeed: number, wet = false): SoundHandle {
  const id = footstepSound(surface, wet);
  const soft = id === 'step_grass' || id === 'step_leaves' || id === 'step_mud' || id === 'step_hay' || id === 'step_carpet';
  const k = Math.min(1, Math.max(0, (fallSpeed - 2) / 6));
  engine.play(id, { position, volume: 0.6 + 0.4 * k });
  return engine.play(soft ? 'land_soft' : 'land_hard', { position, volume: 0.45 + 0.55 * k });
}
