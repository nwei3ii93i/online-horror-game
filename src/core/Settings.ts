export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type BackendPreference = 'auto' | 'webgpu' | 'webgl';

export interface QualityProfile {
  /** Internal render resolution multiplier (relative to CSS pixels × DPR clamp). */
  renderScale: number;
  maxPixelRatio: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowFar: number;
  flashlightShadowSize: number;
  ao: boolean;
  volumetrics: boolean;
  volumetricSteps: number;
  volumetricScale: number;
  bloom: boolean;
  temporalAA: boolean;
  textureSize: number;
  /** Multiplier on vegetation instance counts. */
  vegetationDensity: number;
  /** Radius in which full-detail vegetation cells are built. */
  detailRadius: number;
  /** Max distance where anything vegetation-related is drawn. */
  viewDistance: number;
  grassRadius: number;
  anisotropy: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    renderScale: 0.7, maxPixelRatio: 1, shadowMapSize: 1024, shadowCascades: 2, shadowFar: 45,
    flashlightShadowSize: 512, ao: false, volumetrics: false, volumetricSteps: 6, volumetricScale: 0.25,
    bloom: false, temporalAA: false, textureSize: 512, vegetationDensity: 0.5, detailRadius: 60,
    viewDistance: 140, grassRadius: 18, anisotropy: 2,
  },
  medium: {
    renderScale: 0.85, maxPixelRatio: 1.25, shadowMapSize: 2048, shadowCascades: 3, shadowFar: 60,
    flashlightShadowSize: 1024, ao: true, volumetrics: true, volumetricSteps: 8, volumetricScale: 0.25,
    bloom: true, temporalAA: true, textureSize: 1024, vegetationDensity: 0.75, detailRadius: 80,
    viewDistance: 170, grassRadius: 26, anisotropy: 4,
  },
  high: {
    renderScale: 1, maxPixelRatio: 1.5, shadowMapSize: 2048, shadowCascades: 3, shadowFar: 80,
    flashlightShadowSize: 1024, ao: true, volumetrics: true, volumetricSteps: 12, volumetricScale: 0.33,
    bloom: true, temporalAA: true, textureSize: 1024, vegetationDensity: 1, detailRadius: 100,
    viewDistance: 200, grassRadius: 34, anisotropy: 8,
  },
  ultra: {
    renderScale: 1, maxPixelRatio: 2, shadowMapSize: 4096, shadowCascades: 4, shadowFar: 110,
    flashlightShadowSize: 2048, ao: true, volumetrics: true, volumetricSteps: 16, volumetricScale: 0.5,
    bloom: true, temporalAA: true, textureSize: 2048, vegetationDensity: 1.25, detailRadius: 130,
    viewDistance: 240, grassRadius: 44, anisotropy: 16,
  },
};

export interface UserSettings {
  quality: QualityLevel;
  backend: BackendPreference;
  brightness: number;      // exposure multiplier, 0.5 .. 2
  fov: number;             // vertical degrees
  mouseSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  headBob: boolean;
  filmGrain: boolean;
  playerName: string;
}

const DEFAULTS: UserSettings = {
  quality: 'high',
  backend: 'auto',
  brightness: 1,
  fov: 68,
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.9,
  musicVolume: 0.6,
  headBob: true,
  filmGrain: true,
  playerName: '',
};

const KEY = 'waldegg.settings.v1';

export class Settings {
  readonly values: UserSettings;
  private listeners = new Set<(s: UserSettings) => void>();

  constructor() {
    let stored: Partial<UserSettings> = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable */ }
    this.values = { ...DEFAULTS, ...stored };
    const q = new URLSearchParams(location.search);
    const ql = q.get('quality');
    if (ql && ql in QUALITY_PROFILES) this.values.quality = ql as QualityLevel;
    if (q.has('webgl')) this.values.backend = 'webgl';
    if (q.has('webgpu')) this.values.backend = 'webgpu';
  }

  get profile(): QualityProfile {
    const p = { ...QUALITY_PROFILES[this.values.quality] };
    // URL overrides for testing: ?ao=0&vol=0&taa=0&bloom=0
    const q = new URLSearchParams(location.search);
    const flag = (k: string) => (q.has(k) ? q.get(k) !== '0' : undefined);
    p.ao = flag('ao') ?? p.ao;
    p.volumetrics = flag('vol') ?? p.volumetrics;
    p.temporalAA = flag('taa') ?? p.temporalAA;
    p.bloom = flag('bloom') ?? p.bloom;
    return p;
  }

  set<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(this.values);
  }

  onChange(fn: (s: UserSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
