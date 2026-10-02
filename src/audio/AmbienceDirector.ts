import * as THREE from 'three/webgpu';
import type { AudioEngine, SoundHandle } from './AudioEngine';
import type { SoundId } from './SoundBank';
import { normalizeEnvironment, type EnvironmentId } from './Environments';

export interface AmbienceContext {
  /** Listener (camera) world position. */
  listener: THREE.Vector3;
  /** 0 = fully outside, 1 = fully inside a building / underground. */
  indoor: number;
  /** Acoustic environment name (EnvironmentId or a loose name like "cellar"). */
  environment: string;
  /** 0..1 */
  rain: number;
  /** 0..1 */
  wind: number;
  /** Game time in seconds. */
  time: number;
  isNearTrees?: boolean;
  /** Optional 0..1: drives a heartbeat (fear / low health). */
  stress?: number;
  /** Optional 0..1: drives laboured breathing (low stamina after sprinting). */
  exertion?: number;
}

type StingerKind = 'subtle' | 'near';

interface Ctx {
  indoor: number;
  outdoor: number;
  env: EnvironmentId;
  rain: number;
  wind: number;
  trees: boolean;
  underground: number;
  houseLike: number;
}

interface EventDef {
  id: SoundId;
  place: 'outdoor' | 'indoor' | 'any';
  /** Mean interval (s) at a neutral tension. */
  mean: number;
  /** Minimum seconds between two of these. */
  minGap: number;
  dist: readonly [number, number];
  height: readonly [number, number];
  volume: readonly [number, number];
  cond?: (c: Ctx) => number;
  /** 'main' events respect a global gap; 'drip' runs independently. */
  channel?: 'main' | 'drip';
  variations?: readonly number[];
  spot?: 'owl' | 'dog' | 'drip';
  /** Tension phases needed (e.g. whisper only when uneasy). */
  needsTension?: number;
}

interface Bed {
  id: SoundId;
  handle: SoundHandle | null;
  level: number;
  target: number;
  sent: number;
  quiet: number;
  pitch: number;
  sentPitch: number;
}

interface Phase {
  name: 'still' | 'calm' | 'active' | 'uneasy';
  mult: number;
  dur: readonly [number, number];
  next: ReadonlyArray<readonly [Phase['name'], number]>;
}

const PHASES: Record<Phase['name'], Phase> = {
  still: { name: 'still', mult: 0.12, dur: [50, 140], next: [['calm', 0.7], ['active', 0.3]] },
  calm: { name: 'calm', mult: 0.55, dur: [40, 120], next: [['still', 0.35], ['active', 0.5], ['uneasy', 0.15]] },
  active: { name: 'active', mult: 1, dur: [30, 90], next: [['calm', 0.5], ['still', 0.3], ['uneasy', 0.2]] },
  uneasy: { name: 'uneasy', mult: 1.5, dur: [20, 50], next: [['still', 0.7], ['calm', 0.3]] },
};

const HOUSE_ENVS: ReadonlySet<EnvironmentId> = new Set(['room_small', 'room_large', 'hall', 'attic']);

const EVENTS: readonly EventDef[] = [
  // ---- outdoors
  { id: 'tree_creak', place: 'outdoor', mean: 40, minGap: 12, dist: [15, 60], height: [2, 10], volume: [0.5, 1],
    cond: (c) => (c.trees ? 0.35 + 1.3 * c.wind : 0.12 + 0.3 * c.wind) },
  { id: 'branch_snap_distant', place: 'outdoor', mean: 110, minGap: 30, dist: [20, 80], height: [0, 3], volume: [0.4, 1],
    cond: (c) => (c.trees ? 1 : 0.3) * (1 + c.wind) },
  { id: 'owl_hoot', place: 'outdoor', mean: 120, minGap: 40, dist: [35, 110], height: [6, 15], volume: [0.5, 0.9],
    cond: (c) => (1 - 0.85 * c.rain) * (1 - 0.6 * c.wind), variations: [0, 0, 1, 2], spot: 'owl' },
  { id: 'crow_caw_distant', place: 'outdoor', mean: 600, minGap: 200, dist: [80, 250], height: [5, 20], volume: [0.4, 0.8],
    cond: (c) => 1 - c.rain },
  { id: 'dog_bark_distant', place: 'any', mean: 1200, minGap: 500, dist: [350, 700], height: [-30, 10], volume: [0.5, 1],
    cond: (c) => (1 - 0.5 * c.rain) * (1 - 0.6 * c.underground), spot: 'dog' },
  { id: 'leaves_rustle_gust', place: 'outdoor', mean: 45, minGap: 10, dist: [10, 35], height: [2, 10], volume: [0.5, 1],
    cond: (c) => (c.trees ? 2 * Math.pow(c.wind, 1.5) : 0.2 * c.wind) },
  { id: 'metal_groan', place: 'outdoor', mean: 180, minGap: 60, dist: [25, 70], height: [2, 8], volume: [0.5, 0.9],
    cond: (c) => (c.wind > 0.35 ? c.wind : 0) },
  { id: 'shutter_bang', place: 'any', mean: 240, minGap: 60, dist: [15, 60], height: [2, 6], volume: [0.5, 1],
    cond: (c) => (c.wind > 0.45 ? c.wind * (1 - c.underground) : 0) },
  { id: 'thunder_distant', place: 'any', mean: 110, minGap: 40, dist: [1500, 4000], height: [200, 600], volume: [0.5, 1],
    cond: (c) => (c.rain > 0.6 ? ((c.rain - 0.6) / 0.4) * 1.5 * (1 - 0.6 * c.underground) : 0) },
  // ---- indoors
  { id: 'house_settle', place: 'indoor', mean: 45, minGap: 10, dist: [4, 15], height: [-1, 4], volume: [0.5, 1],
    cond: (c) => (c.houseLike + (c.env === 'barn' ? 0.6 : c.env === 'basement' ? 0.4 : 0)) * (1 + 0.6 * c.wind + 0.3 * c.rain) },
  { id: 'floor_creak', place: 'indoor', mean: 90, minGap: 25, dist: [4, 14], height: [-0.5, 3.5], volume: [0.5, 1],
    cond: (c) => c.houseLike + (c.env === 'barn' ? 0.3 : 0) },
  { id: 'metal_groan', place: 'indoor', mean: 150, minGap: 50, dist: [6, 20], height: [3, 7], volume: [0.4, 0.8],
    cond: (c) => (c.env === 'barn' ? 0.3 + c.wind : 0) },
  { id: 'drip', place: 'indoor', mean: 7, minGap: 1.2, dist: [2, 12], height: [0, 3], volume: [0.4, 1], channel: 'drip', spot: 'drip',
    cond: (c) => (c.env === 'tunnel' ? 1.2 : c.env === 'basement' ? 0.9 : c.rain > 0.4 ? 0.12 * c.houseLike : 0) },
  { id: 'whisper_wind', place: 'indoor', mean: 300, minGap: 120, dist: [2, 6], height: [0.5, 2], volume: [0.6, 1], needsTension: 1,
    cond: (c) => (c.wind > 0.3 ? c.wind * (1 - c.underground) : 0) },
];

const tmpV = new THREE.Vector3();

/**
 * Drives the ambience: crossfades bed loops from context (indoor factor, rain, wind,
 * environment) and schedules sparse, plausibly placed one-shots. A slow tension state
 * machine produces long quiet stretches between busier (but never busy) periods.
 */
export class AmbienceDirector {
  enabled = true;
  /** Global multiplier on one-shot frequency (1 = default). */
  intensity = 1;
  /** Forward the context environment to engine.setEnvironment(). */
  manageEnvironment = true;

  private readonly beds = new Map<SoundId, Bed>();
  private readonly last = new Map<string, number>();
  private clock = 0;
  private lastMain = -1e9;
  private phase: Phase = PHASES.calm;
  private phaseLeft = 60;
  private mult = 0.5;
  private stingerAt = -1e9;
  private readonly spots: Record<'owl' | 'dog', THREE.Vector3 | null> = { owl: null, dog: null };
  private spotTime: Record<'owl' | 'dog', number> = { owl: -1e9, dog: -1e9 };
  private dripSpots: THREE.Vector3[] = [];
  private readonly listener = new THREE.Vector3();
  private ctx: Ctx = { indoor: 0, outdoor: 1, env: 'outdoor', rain: 0, wind: 0, trees: true, underground: 0, houseLike: 0 };
  private heartT = 0;
  private breathT = 0;
  private envName = '';
  private pendingFemale = -1;

  constructor(private readonly engine: AudioEngine) {
    const dogBearing = Math.random() * Math.PI * 2;
    this.dogDir = new THREE.Vector3(Math.cos(dogBearing), 0, Math.sin(dogBearing));
  }

  private readonly dogDir: THREE.Vector3;

  /** Current tension multiplier on event rates (≈0.1 quiet … 1.5 uneasy). */
  get tension(): number {
    return this.mult;
  }

  get phaseName(): string {
    return this.phase.name;
  }

  update(dt: number, c: AmbienceContext): void {
    if (!this.enabled || !(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    this.clock += dt;
    this.listener.copy(c.listener);
    const env = normalizeEnvironment(c.environment);
    if (this.manageEnvironment && c.environment !== this.envName) {
      this.envName = c.environment;
      this.engine.setEnvironment(env);
    }
    const indoor = clamp01(c.indoor);
    const underground = env === 'tunnel' ? 1 : env === 'basement' ? 0.85 : 0;
    this.ctx = {
      indoor,
      outdoor: 1 - indoor,
      env,
      rain: clamp01(c.rain),
      wind: clamp01(c.wind),
      trees: c.isNearTrees ?? true,
      underground: underground * indoor,
      houseLike: HOUSE_ENVS.has(env) ? 1 : 0,
    };
    if (!this.engine.ready) return;
    this.updateBeds(dt);
    this.updateTension(dt, c.time);
    this.updateEvents(dt);
    this.updateBody(dt, c);
  }

  // ----------------------------------------------------------------------------- beds

  private bed(id: SoundId): Bed {
    let b = this.beds.get(id);
    if (!b) {
      b = { id, handle: null, level: 0, target: 0, sent: -1, quiet: 0, pitch: 1, sentPitch: 1 };
      this.beds.set(id, b);
    }
    return b;
  }

  private updateBeds(dt: number): void {
    const c = this.ctx;
    const above = 1 - c.underground;
    const roof = c.env === 'attic' ? 1.3 : c.env === 'barn' ? 1.2 : 0.8;
    const win = c.env === 'room_small' || c.env === 'room_large' || c.env === 'hall' ? 0.7 : c.env === 'attic' ? 0.3 : 0.4;
    const tunnel = c.env === 'tunnel' ? 1 : c.env === 'basement' ? 0.55 : 0;
    this.bed('wind_loop').target = c.outdoor * (0.15 + 0.85 * c.wind);
    this.bed('wind_loop').pitch = 0.9 + 0.2 * c.wind;
    this.bed('wind_interior_loop').target = c.indoor * above * (0.1 + 0.9 * c.wind);
    this.bed('forest_night_loop').target = c.outdoor * (c.trees ? 1 : 0.6) * (1 - 0.6 * c.rain);
    this.bed('rain_loop').target = c.outdoor * c.rain;
    this.bed('rain_roof_loop').target = c.indoor * c.rain * roof * Math.max(0.1, above);
    this.bed('rain_window_loop').target = c.indoor * c.rain * win * above;
    this.bed('tunnel_air_loop').target = c.indoor * tunnel;

    const k = 1 - Math.exp(-dt / 1.4);
    for (const b of this.beds.values()) {
      b.level += (b.target - b.level) * k;
      if (b.level > 0.003 && !b.handle) {
        b.handle = this.engine.play(b.id, { volume: 0, wide: true, loop: true, fadeIn: 0.5 });
        b.sent = 0;
        if (!b.handle.playing) b.handle = null;
      }
      if (b.handle) {
        if (Math.abs(b.level - b.sent) > 0.004) {
          b.handle.setVolume(b.level, 0.25);
          b.sent = b.level;
        }
        if (Math.abs(b.pitch - b.sentPitch) > 0.01) {
          b.handle.setPitch(b.pitch, 1.5);
          b.sentPitch = b.pitch;
        }
        b.quiet = b.level < 0.002 ? b.quiet + dt : 0;
        if (b.quiet > 4 || !b.handle.playing) {
          b.handle.stop(0.5);
          b.handle = null;
          b.sentPitch = 1;
        }
      }
    }
  }

  // ----------------------------------------------------------------------------- tension

  private updateTension(dt: number, time: number): void {
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) this.enterPhase(weighted(this.phase.next));
    // slow drift over the night so equal phases never feel identical
    const drift = 1 + 0.15 * Math.sin((time || this.clock) / 420);
    const target = this.phase.mult * drift;
    this.mult += (target - this.mult) * (1 - Math.exp(-dt / 8));
  }

  private enterPhase(name: Phase['name'], dur?: number): void {
    this.phase = PHASES[name];
    this.phaseLeft = dur ?? rand(this.phase.dur[0], this.phase.dur[1]);
  }

  // ----------------------------------------------------------------------------- one-shots

  private updateEvents(dt: number): void {
    const c = this.ctx;
    const globalGap = 3 + 6 * (1 - Math.min(1, this.mult));
    for (const e of EVENTS) {
      const place = e.place === 'outdoor' ? c.outdoor : e.place === 'indoor' ? c.indoor : 1;
      if (place <= 0.02) continue;
      if (e.needsTension !== undefined && this.mult < e.needsTension) continue;
      const cond = e.cond ? Math.max(0, e.cond(c)) : 1;
      if (cond <= 0) continue;
      const main = (e.channel ?? 'main') === 'main';
      const rate = (place * cond * (main ? this.mult : 1) * this.intensity) / e.mean;
      if (Math.random() >= rate * dt) continue;
      const key = e.id + e.place;
      if (this.clock - (this.last.get(key) ?? -1e9) < e.minGap) continue;
      if (main && this.clock - this.lastMain < globalGap) continue;
      if (this.fire(e)) {
        this.last.set(key, this.clock);
        if (main) this.lastMain = this.clock;
      }
    }
    if (this.pendingFemale > 0 && this.clock >= this.pendingFemale) {
      this.pendingFemale = -1;
      const p = this.around(40, 90, 6, 14);
      this.engine.play('owl_hoot', { position: p, variation: 3, volume: rand(0.4, 0.7), occlusion: 0.6 * this.ctx.indoor });
    }
  }

  private fire(e: EventDef): boolean {
    const c = this.ctx;
    let pos: THREE.Vector3;
    if (e.spot === 'owl') pos = this.owlSpot(e);
    else if (e.spot === 'dog') pos = tmpV.copy(this.dogDir).multiplyScalar(rand(e.dist[0], e.dist[1])).add(this.listener).setY(this.listener.y + rand(e.height[0], e.height[1])).clone();
    else if (e.spot === 'drip') pos = this.dripSpot(e);
    else pos = this.around(e.dist[0], e.dist[1], e.height[0], e.height[1]);
    // sounds from the "other" side of a wall start muffled; the occlusion provider may refine it
    const occ = e.place === 'outdoor' ? 0.6 * c.indoor : e.place === 'indoor' ? 0.7 * c.outdoor : e.id === 'thunder_distant' ? 0.45 * c.indoor : 0.5 * c.indoor;
    const variation = e.variations ? e.variations[Math.floor(Math.random() * e.variations.length)] : undefined;
    const h = this.engine.play(e.id, { position: pos, volume: rand(e.volume[0], e.volume[1]), occlusion: occ, variation });
    if (e.id === 'owl_hoot' && h.playing && Math.random() < 0.25) this.pendingFemale = this.clock + rand(8, 20);
    return h.playing;
  }

  /** Random point around the listener (uniform azimuth, distance and height ranges). */
  private around(d0: number, d1: number, h0: number, h1: number, bearing?: number, spread = Math.PI * 2): THREE.Vector3 {
    const a = bearing === undefined ? Math.random() * Math.PI * 2 : bearing + (Math.random() - 0.5) * spread;
    const d = rand(d0, d1);
    return new THREE.Vector3(this.listener.x + Math.cos(a) * d, this.listener.y + rand(h0, h1), this.listener.z + Math.sin(a) * d);
  }

  /** Owls call repeatedly from the same tree for a few minutes. */
  private owlSpot(e: EventDef): THREE.Vector3 {
    const s = this.spots.owl;
    const d = s ? Math.hypot(s.x - this.listener.x, s.z - this.listener.z) : 0;
    if (!s || this.clock - this.spotTime.owl > 240 || d < e.dist[0] * 0.6 || d > e.dist[1] * 1.6) {
      this.spots.owl = this.around(e.dist[0], e.dist[1], e.height[0], e.height[1]);
      this.spotTime.owl = this.clock;
    }
    return this.spots.owl!.clone();
  }

  /** Leaks drip from a few fixed places, not from random points. */
  private dripSpot(e: EventDef): THREE.Vector3 {
    this.dripSpots = this.dripSpots.filter((p) => p.distanceTo(this.listener) < e.dist[1] * 1.5);
    while (this.dripSpots.length < 3) this.dripSpots.push(this.around(e.dist[0], e.dist[1], e.height[0], e.height[1]));
    // most drips come from one dominant leak
    const r = Math.random();
    return this.dripSpots[r < 0.6 ? 0 : r < 0.85 ? 1 : 2].clone();
  }

  // ----------------------------------------------------------------------------- stingers

  /**
   * Request a rare unsettling sound. 'subtle': far away (footsteps upstairs, a door closing
   * somewhere, someone in the leaves). 'near': closer and behind the listener. Rate-limited;
   * returns false when on cooldown or nothing suitable could play. Followed by a quiet stretch.
   */
  triggerStinger(kind: StingerKind): boolean {
    if (!this.engine.ready || !this.engine.running) return false;
    const cooldown = kind === 'near' ? 90 : 45;
    if (this.clock - this.stingerAt < cooldown) return false;
    const c = this.ctx;
    const inside = c.indoor > 0.5;
    const fwd = this.engine.listenerForward;
    const behind = Math.atan2(-fwd.z, -fwd.x);
    let ok = false;
    if (kind === 'subtle') {
      const pick = Math.random();
      if (inside) {
        if (pick < 0.4) {
          ok = this.engine.play('footsteps_distant_wood', { position: this.around(4, 9, 3, 3.6), volume: rand(0.6, 0.9), occlusion: 0.5 }).playing;
        } else if (pick < 0.65) {
          ok = this.engine.play('door_slam_distant', { position: this.around(20, 40, -1, 4), volume: rand(0.5, 0.8), occlusion: 0.3 }).playing;
        } else if (pick < 0.85) {
          ok = this.engine.play('door_close', { position: this.around(12, 22, -1, 4), volume: rand(0.5, 0.8), occlusion: 0.75 }).playing;
        } else {
          ok = this.engine.play('floor_creak', { position: this.around(6, 12, 2.8, 3.5), volume: rand(0.7, 1), occlusion: 0.55 }).playing;
        }
      } else if (pick < 0.6) {
        ok = this.walkInLeaves(rand(14, 24), Math.random() * Math.PI * 2, 3 + Math.floor(Math.random() * 3), 0.45);
      } else {
        ok = this.engine.play('branch_snap_distant', { position: this.around(12, 25, 0, 2), volume: rand(0.7, 1) }).playing;
      }
    } else {
      const pick = Math.random();
      if (inside) {
        if (pick < 0.5) {
          ok = this.engine.play('floor_creak', { position: this.around(2.5, 4, -0.3, 0.3, behind, 1.2), volume: rand(0.6, 0.9), refDistance: 2 }).playing;
        } else if (pick < 0.8 && c.houseLike) {
          ok = this.engine.play('door_open_creak', { position: this.around(6, 10, -0.5, 0.5, behind, 2), volume: rand(0.45, 0.7), occlusion: 0.35 }).playing;
        } else {
          ok = this.engine.play('whisper_wind', { position: this.around(1.5, 2.5, 0.2, 0.8, behind, 1.5), volume: rand(0.7, 1) }).playing;
        }
      } else if (pick < 0.55) {
        ok = this.walkInLeaves(rand(8, 12), behind, 2 + Math.floor(Math.random() * 2), 0.6);
      } else {
        ok = this.engine.play('branch_snap_distant', { position: this.around(6, 10, 0, 1.5, behind, 1.4), volume: 1, refDistance: 6 }).playing;
      }
    }
    if (ok) {
      this.stingerAt = this.clock;
      this.lastMain = this.clock;
      this.enterPhase('still', rand(40, 90));
    }
    return ok;
  }

  /** A few slow steps in the leaves somewhere in the dark — then nothing. */
  private walkInLeaves(dist: number, bearing: number, steps: number, volume: number): boolean {
    const start = this.around(dist, dist, -0.5, 0.2, bearing, 0.6);
    const heading = Math.random() * Math.PI * 2;
    const spacing = rand(0.55, 0.75);
    let ok = false;
    for (let k = 0; k < steps; k++) {
      const p = start.clone().add(new THREE.Vector3(Math.cos(heading) * 0.7 * k, 0, Math.sin(heading) * 0.7 * k));
      const h = this.engine.play('step_leaves', {
        position: p, delay: k * spacing * rand(0.92, 1.1), volume: volume * (k === steps - 1 ? 0.7 : 1), refDistance: 2.5, lowpass: 5000,
      });
      ok = ok || h.playing;
    }
    return ok;
  }

  // ----------------------------------------------------------------------------- body

  private updateBody(dt: number, c: AmbienceContext): void {
    const stress = clamp01(c.stress ?? 0);
    if (stress > 0.2) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        const bpm = 58 + 72 * stress;
        this.heartT = (60 / bpm) * rand(0.97, 1.03);
        this.engine.play('heartbeat', { volume: 0.25 + 0.75 * ((stress - 0.2) / 0.8), pitch: 1 + 0.08 * stress, priority: 6 });
      }
    } else this.heartT = 0;
    const ex = clamp01(c.exertion ?? 0);
    if (ex > 0.35) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        const k = (ex - 0.35) / 0.65;
        this.breathT = rand(1.15, 1.35) / (0.85 + 0.45 * k);
        this.engine.play('breath_tired', { volume: 0.1 + 0.32 * k, pitch: 0.97 + 0.06 * k, priority: 6 });
      }
    } else this.breathT = Math.min(this.breathT, 0.3);
  }

  /** Stop all bed loops (e.g. when leaving the game). */
  dispose(): void {
    for (const b of this.beds.values()) b.handle?.stop(0.3);
    this.beds.clear();
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function rand(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}
