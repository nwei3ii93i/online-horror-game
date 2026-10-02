/**
 * Waldegg audio: procedural, spatial, environment-aware sound for the estate.
 * See INTEGRATION.md for how the game drives it.
 */
export { AudioEngine, SILENT_HANDLE } from './AudioEngine';
export type { AudioEngineOptions, BusName, OcclusionProvider, PlayOptions, SoundHandle } from './AudioEngine';
export { AmbienceDirector } from './AmbienceDirector';
export type { AmbienceContext } from './AmbienceDirector';
export { footstepSound, playFootstep, playLanding } from './Footsteps';
export type { Stance } from './Footsteps';
export { SOUND_DEFS, SOUND_IDS, SoundBank } from './SoundBank';
export type { BankStats, SoundDef, SoundId } from './SoundBank';
export { ENVIRONMENTS, ENV_PRESETS, normalizeEnvironment } from './Environments';
export type { EnvironmentId, EnvPreset } from './Environments';
