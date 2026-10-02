/**
 * Procedural sound bank: every SoundId is synthesised at init into one or more AudioBuffers
 * (variations), cached, and picked at random (never the same variation twice in a row).
 *
 * Rendering is pure JS DSP (see dsp.ts / synth/*) driven in small time slices with `await`
 * between them so the page stays responsive; distant / dark sounds are rendered at half or
 * quarter sample rate to save time and memory.
 */
import { type Buf, Rng, fadeEdges, hashSeed, hp1, peak, rms, sanitize, scale, trimTail } from './dsp';
import * as F from './synth/footsteps';
import * as O from './synth/objects';
import * as L from './synth/loops';
import * as A from './synth/ambient';
import { ENVIRONMENTS, ENV_PRESETS, generateIR, type EnvironmentId } from './Environments';

export const SOUND_IDS = [
  // footsteps
  'step_wood', 'step_wood_creak', 'step_stone', 'step_tile', 'step_concrete', 'step_gravel', 'step_mud',
  'step_grass', 'step_leaves', 'step_metal', 'step_carpet', 'step_water', 'step_hay', 'land_soft', 'land_hard',
  // doors / objects
  'door_open_creak', 'door_close', 'door_locked', 'door_unlock', 'door_slam_distant', 'drawer_open',
  'drawer_close', 'wardrobe_open', 'latch', 'gate_iron_creak', 'glass_crunch', 'metal_clank', 'wood_knock',
  'object_drop_wood', 'object_drop_metal', 'paper_rustle', 'page_turn', 'key_pickup', 'item_pickup',
  'flashlight_click', 'switch_click', 'chain_rattle',
  // loops
  'wind_loop', 'wind_interior_loop', 'rain_loop', 'rain_roof_loop', 'rain_window_loop', 'forest_night_loop',
  'bulb_buzz_loop', 'generator_loop', 'clock_tick_loop', 'radio_static_loop', 'stream_loop', 'tunnel_air_loop',
  // ambient one-shots
  'drip', 'tree_creak', 'branch_snap_distant', 'owl_hoot', 'crow_caw_distant', 'dog_bark_distant',
  'thunder_distant', 'house_settle', 'floor_creak', 'metal_groan', 'shutter_bang', 'leaves_rustle_gust',
  'footsteps_distant_wood', 'whisper_wind', 'heartbeat', 'breath_tired', 'breath_calm',
] as const;

/** Every sound the bank can play. */
export type SoundId = (typeof SOUND_IDS)[number];

export type BankBus = 'sfx' | 'ambience' | 'ui';

type Recipe = (fs: number, rng: Rng, v: number) => Buf | Buf[];

export interface SoundDef {
  recipe: Recipe;
  variations: number;
  /** Render at sampleRate / rateDiv (dark or distant material). */
  rateDiv?: 1 | 2 | 4;
  loop?: boolean;
  /** Default playback gain. */
  gain: number;
  bus: BankBus;
  /** Panner defaults (inverse distance model). */
  ref: number;
  max: number;
  /** Default reverb send (0..1). */
  reverb: number;
  /** Random pitch spread per play (fraction). */
  pitchVar: number;
  /** Distance (air absorption, space) is already baked into the samples. */
  baked?: boolean;
  /** Target level: peak for one-shots, RMS for loops. */
  level?: number;
  /** Voice-stealing priority (higher survives). */
  priority?: number;
}

const step = (recipe: Recipe, variations: number, gain = 0.55): SoundDef => ({
  recipe, variations, gain, bus: 'sfx', ref: 2, max: 40, reverb: 0.5, pitchVar: 0.06, priority: 2,
});
const obj = (recipe: Recipe, variations: number, gain: number, ref = 2.5, max = 45, reverb = 0.7): SoundDef => ({
  recipe, variations, gain, bus: 'sfx', ref, max, reverb, pitchVar: 0.04, priority: 3,
});
const small = (recipe: Recipe, variations: number, gain: number): SoundDef => ({
  recipe, variations, gain, bus: 'sfx', ref: 1, max: 15, reverb: 0.4, pitchVar: 0.05, priority: 3,
});
const bed = (recipe: Recipe, variations: number, gain: number, rateDiv: 1 | 2 | 4 = 1): SoundDef => ({
  recipe, variations, gain, rateDiv, loop: true, bus: 'ambience', ref: 3, max: 60, reverb: 0, pitchVar: 0, level: 0.16, priority: 5,
});
const amb = (recipe: Recipe, variations: number, gain: number, ref: number, max: number, rateDiv: 1 | 2 | 4 = 1, reverb = 0.3, baked = false): SoundDef => ({
  recipe, variations, gain, rateDiv, bus: 'ambience', ref, max, reverb, pitchVar: 0.04, baked, priority: 1,
});

const WOOD_OLD_CREAK = [0.55, 0, 0.3, 0, 0, 0.65, 0];

export const SOUND_DEFS: Record<SoundId, SoundDef> = {
  step_wood: step((fs, r) => F.stepWood(fs, r, 0, false), 6),
  step_wood_creak: step((fs, r, v) => F.stepWood(fs, r, WOOD_OLD_CREAK[v % WOOD_OLD_CREAK.length], true), 7),
  step_stone: step(F.stepStone, 5),
  step_tile: step(F.stepTile, 5),
  step_concrete: step(F.stepConcrete, 5),
  step_gravel: step(F.stepGravel, 6),
  step_mud: step(F.stepMud, 5),
  step_grass: step(F.stepGrass, 5, 0.5),
  step_leaves: step(F.stepLeaves, 6),
  step_metal: step(F.stepMetal, 5, 0.5),
  step_carpet: step(F.stepCarpet, 5, 0.5),
  step_water: step(F.stepWater, 5),
  step_hay: step(F.stepHay, 5, 0.5),
  land_soft: { ...step(F.landSoft, 3, 0.7), pitchVar: 0.05 },
  land_hard: { ...step(F.landHard, 3, 0.8), pitchVar: 0.05 },

  door_open_creak: { ...obj(O.doorOpenCreak, 3, 0.7, 3), rateDiv: 2 },
  door_close: obj(O.doorClose, 4, 0.8, 3),
  door_locked: obj(O.doorLocked, 3, 0.7, 2.5),
  door_unlock: obj(O.doorUnlock, 3, 0.6, 1.5),
  door_slam_distant: { ...obj(O.doorSlamDistant, 2, 0.9, 25, 400, 0.25), rateDiv: 4, baked: true },
  drawer_open: obj(O.drawerOpen, 3, 0.55, 1.5, 20),
  drawer_close: obj(O.drawerClose, 3, 0.6, 1.5, 20),
  wardrobe_open: { ...obj(O.wardrobeOpen, 3, 0.6, 2, 25), rateDiv: 2 },
  latch: obj(O.latch, 3, 0.55, 1.5, 25),
  gate_iron_creak: { ...obj(O.gateIronCreak, 3, 0.75, 5, 90, 0.5), rateDiv: 2 },
  glass_crunch: step(F.glassCrunch, 5, 0.55),
  metal_clank: obj(O.metalClank, 4, 0.75, 3, 60),
  wood_knock: obj(O.woodKnock, 4, 0.7, 2.5, 40),
  object_drop_wood: obj(O.objectDropWood, 4, 0.7, 2.5, 40),
  object_drop_metal: obj(O.objectDropMetal, 4, 0.75, 2.5, 50),
  paper_rustle: small(O.paperRustle, 3, 0.4),
  page_turn: small(O.pageTurn, 4, 0.4),
  key_pickup: small(O.keyPickup, 3, 0.5),
  item_pickup: small(O.itemPickup, 4, 0.4),
  flashlight_click: { ...small(O.flashlightClick, 3, 0.35), reverb: 0.15, priority: 4 },
  switch_click: small(O.switchClick, 3, 0.45),
  chain_rattle: { ...obj(O.chainRattle, 3, 0.6, 2, 35), rateDiv: 2 },

  wind_loop: bed(L.windLoop, 1, 0.55, 2),
  wind_interior_loop: bed(L.windInteriorLoop, 1, 0.45, 2),
  rain_loop: bed(L.rainLoop, 1, 0.5),
  rain_roof_loop: bed(L.rainRoofLoop, 1, 0.5, 2),
  rain_window_loop: bed(L.rainWindowLoop, 1, 0.4, 2),
  forest_night_loop: bed(L.forestNightLoop, 1, 0.35, 2),
  bulb_buzz_loop: { ...bed(L.bulbBuzzLoop, 1, 0.25, 2), bus: 'sfx', ref: 0.8, max: 8, reverb: 0.1 },
  generator_loop: { ...bed(L.generatorLoop, 1, 0.8, 2), bus: 'sfx', ref: 4, max: 120, reverb: 0.35 },
  clock_tick_loop: { ...bed(L.clockTickLoop, 1, 0.5, 2), bus: 'sfx', ref: 1.5, max: 20, reverb: 0.4 },
  radio_static_loop: { ...bed(L.radioStaticLoop, 1, 0.4, 2), bus: 'sfx', ref: 1.2, max: 20, reverb: 0.25 },
  stream_loop: { ...bed(L.streamLoop, 1, 0.6, 2), ref: 6, max: 120, reverb: 0.1 },
  tunnel_air_loop: bed(L.tunnelAirLoop, 1, 0.5, 4),

  drip: amb(A.drip, 8, 0.5, 1.5, 30, 1, 0.9),
  tree_creak: amb(A.treeCreak, 4, 0.7, 15, 250, 4, 0.15, true),
  branch_snap_distant: amb(A.branchSnapDistant, 4, 0.7, 15, 300, 2, 0.15, true),
  owl_hoot: amb(A.owlHoot, 4, 0.55, 40, 1000, 4, 0.15, true),
  crow_caw_distant: amb(A.crowCawDistant, 2, 0.5, 60, 1500, 4, 0.15, true),
  dog_bark_distant: amb(A.dogBarkDistant, 2, 0.3, 300, 6000, 4, 0.05, true),
  thunder_distant: { ...amb(A.thunderDistant, 3, 0.9, 2000, 20000, 4, 0.1, true), priority: 4 },
  house_settle: amb(A.houseSettle, 6, 0.55, 3, 40, 1, 0.6),
  floor_creak: amb(A.floorCreak, 5, 0.55, 3, 40, 1, 0.6),
  metal_groan: amb(A.metalGroan, 2, 0.6, 12, 200, 4, 0.3),
  shutter_bang: amb(A.shutterBang, 4, 0.7, 10, 200, 2, 0.35),
  leaves_rustle_gust: amb(A.leavesRustleGust, 3, 0.5, 15, 150, 2, 0.15),
  footsteps_distant_wood: amb(A.footstepsDistantWood, 3, 0.6, 8, 100, 4, 0.3, true),
  whisper_wind: amb(A.whisperWind, 3, 0.25, 2, 25, 2, 0.5),
  heartbeat: { ...amb(A.heartbeat, 3, 0.6, 1, 10, 4, 0), bus: 'sfx', pitchVar: 0.02, priority: 6 },
  breath_tired: { ...amb(A.breathTired, 4, 0.45, 1, 10, 2, 0.05), bus: 'sfx', pitchVar: 0.03, priority: 6 },
  breath_calm: { ...amb(A.breathCalm, 3, 0.3, 1, 10, 2, 0.05), bus: 'sfx', pitchVar: 0.03, priority: 6 },
};

export interface RenderedVariation {
  channels: Buf[];
  rate: number;
  /** Non-finite samples that had to be zeroed (should always be 0). */
  bad: number;
}

/** Render one variation of one sound (pure; usable outside the browser for tests). */
export function renderVariation(id: SoundId, v: number, baseRate: number): RenderedVariation {
  const def = SOUND_DEFS[id];
  const rate = Math.round(baseRate / (def.rateDiv ?? 1));
  const rng = new Rng(hashSeed(id, v));
  const res = def.recipe(rate, rng, v);
  let channels = Array.isArray(res) ? res : [res];
  let bad = 0;
  for (const c of channels) {
    bad += sanitize(c);
    if (!def.loop) hp1(c, 18, rate);
  }
  if (!def.loop) {
    // drop inaudible tails (-75 dB re peak) to save memory, then de-click the edges
    if (channels.length === 1) channels = [trimTail(channels[0], rate, 1.8e-4, 15)];
    for (const c of channels) fadeEdges(c, rate, 0.3, 6);
  }
  let p = 0;
  let r = 0;
  for (const c of channels) {
    p = Math.max(p, peak(c));
    r = Math.max(r, rms(c));
  }
  let g = 1;
  if (def.loop) {
    g = r > 1e-9 ? (def.level ?? 0.16) / r : 1;
    if (p * g > 0.95) g = 0.95 / p;
  } else {
    g = p > 1e-9 ? (def.level ?? 0.89) / p : 1;
  }
  for (const c of channels) scale(c, g);
  return { channels, rate, bad };
}

/** Yield to the event loop (not throttled like setTimeout in background tabs). */
export function yieldToMain(): Promise<void> {
  const sch = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sch && typeof sch.yield === 'function') return sch.yield();
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface BankStats {
  ms: number;
  buffers: number;
  samples: number;
  bytes: number;
  bad: number;
}

/** A render job: a sound variation, or an environment impulse response ("ir:<env>"). */
export type Job = [SoundId | `ir:${EnvironmentId}`, number];

/** Render any job (pure; runs on the main thread or in SoundWorker). */
export function renderJob(job: Job, baseRate: number): RenderedVariation {
  const [id, v] = job;
  if (id.startsWith('ir:')) {
    const env = id.slice(3) as EnvironmentId;
    const [l, r] = generateIR(baseRate, ENV_PRESETS[env], v);
    return { channels: [l, r], rate: baseRate, bad: 0 };
  }
  return renderVariation(id as SoundId, v, baseRate);
}

interface WorkerResult {
  id: Job[0];
  v: number;
  rate?: number;
  channels?: Buf[];
  bad?: number;
  error?: string;
  done?: boolean;
}

export interface RenderOptions {
  /** Render in Web Workers when available (default true); falls back to the main thread. */
  workers?: boolean;
  /** Number of workers (default: hardwareConcurrency − 1, clamped to 1..3). */
  workerCount?: number;
  /** Main-thread time slice in ms between yields (default 10). */
  budgetMs?: number;
  ids?: readonly SoundId[];
}

export class SoundBank {
  /** Buffers indexed by variation (sparse until rendered). */
  private readonly buffers = new Map<SoundId, (AudioBuffer | undefined)[]>();
  /** Reverb impulse responses per environment (at the context sample rate). */
  private readonly irs = new Map<EnvironmentId, AudioBuffer>();
  private readonly history = new Map<SoundId, number[]>();
  stats: BankStats = { ms: 0, buffers: 0, samples: 0, bytes: 0, bad: 0 };
  ready = false;
  /** How the bank was rendered ('workers', 'main' or 'mixed'). */
  mode = 'main';

  constructor(private readonly ctx: BaseAudioContext) {}

  /** Render every sound. Uses workers when possible, otherwise time-sliced main-thread rendering. */
  async render(onProgress?: (p: number) => void, opts: RenderOptions = {}): Promise<BankStats> {
    const t0 = now();
    const jobs: Job[] = ENVIRONMENTS.map((e, i): Job => [`ir:${e}`, i + 1]);
    for (const id of opts.ids ?? SOUND_IDS) for (let v = 0; v < SOUND_DEFS[id].variations; v++) jobs.push([id, v]);
    const total = jobs.length;
    let doneCount = 0;
    const progress = () => onProgress?.(Math.min(1, doneCount / total));
    let pending = jobs;
    if ((opts.workers ?? true) && typeof Worker !== 'undefined') {
      pending = await this.renderInWorkers(jobs, opts.workerCount, () => {
        doneCount++;
        progress();
      });
      this.mode = pending.length === 0 ? 'workers' : pending.length === jobs.length ? 'main' : 'mixed';
    }
    const budget = opts.budgetMs ?? 10;
    let slice = now();
    for (const job of pending) {
      const [id, v] = job;
      try {
        const r = renderJob(job, this.ctx.sampleRate);
        this.add(id, v, r.rate, r.channels, r.bad);
      } catch (e) {
        console.warn(`[audio] failed to render ${id}#${v}`, e);
      }
      doneCount++;
      if (now() - slice > budget) {
        progress();
        await yieldToMain();
        slice = now();
      }
    }
    this.stats.bytes = this.stats.samples * 4;
    this.stats.ms = now() - t0;
    this.ready = true;
    onProgress?.(1);
    return this.stats;
  }

  private add(jobId: Job[0], v: number, rate: number, channels: Buf[], bad: number): void {
    const ab = this.ctx.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((c, ch) => ab.copyToChannel(c, ch));
    if (jobId.startsWith('ir:')) {
      this.irs.set(jobId.slice(3) as EnvironmentId, ab);
      this.stats.samples += ab.length * ab.numberOfChannels;
      return;
    }
    const id = jobId as SoundId;
    let list = this.buffers.get(id);
    if (!list) this.buffers.set(id, (list = []));
    list[v] = ab;
    this.stats.buffers++;
    this.stats.samples += ab.length * ab.numberOfChannels;
    this.stats.bad += bad;
  }

  /** Spread jobs over a few workers; resolves with the jobs that did NOT complete. */
  private renderInWorkers(jobs: Job[], count: number | undefined, onJob: () => void): Promise<Job[]> {
    const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    const n = Math.max(1, Math.min(8, count ?? Math.min(3, hc - 1)));
    const done = new Set<string>();
    const key = (id: Job[0], v: number) => `${id}#${v}`;
    // impulse responses first, then interleave the expensive loops across workers
    const weight = (j: Job) => (j[0].startsWith('ir:') ? 2 : SOUND_DEFS[j[0] as SoundId].loop ? 1 : 0);
    const order = jobs.slice().sort((a, b) => weight(b) - weight(a));
    return new Promise<Job[]>((resolve) => {
      const workers: Worker[] = [];
      let closed = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        for (const w of workers) w.terminate();
        resolve(jobs.filter(([id, v]) => !done.has(key(id, v))));
      };
      const watchdog = setTimeout(finish, 30000);
      const closeOne = () => {
        if (++closed >= n) finish();
      };
      for (let w = 0; w < n; w++) {
        let worker: Worker;
        try {
          worker = new Worker(new URL('./SoundWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          closeOne();
          continue;
        }
        workers.push(worker);
        worker.onmessage = (ev: MessageEvent<WorkerResult>) => {
          const m = ev.data;
          if (m.done) {
            closeOne();
            return;
          }
          if (m.error || !m.channels || !m.rate) {
            if (m.error) console.warn(`[audio] worker failed to render ${m.id}#${m.v}: ${m.error}`);
            return;
          }
          try {
            this.add(m.id, m.v, m.rate, m.channels, m.bad ?? 0);
            done.add(key(m.id, m.v));
            onJob();
          } catch (e) {
            console.warn('[audio] could not create buffer', e);
          }
        };
        worker.onerror = (ev) => {
          ev.preventDefault();
          closeOne();
        };
        worker.postMessage({ jobs: order.filter((_, i) => i % n === w), rate: this.ctx.sampleRate });
      }
    });
  }

  has(id: SoundId): boolean {
    return this.count(id) > 0;
  }

  /** Impulse response for an environment (null until rendered). */
  getIR(env: EnvironmentId): AudioBuffer | null {
    return this.irs.get(env) ?? null;
  }

  count(id: SoundId): number {
    const l = this.buffers.get(id);
    if (!l) return 0;
    let c = 0;
    for (const b of l) if (b) c++;
    return c;
  }

  /** A specific variation (falls back to any rendered one). */
  get(id: SoundId, variation: number): AudioBuffer | null {
    const l = this.buffers.get(id);
    if (!l || !l.length) return null;
    const b = l[((variation % l.length) + l.length) % l.length];
    return b ?? l.find((x) => !!x) ?? null;
  }

  /** Random variation, avoiding the most recently used ones. */
  pick(id: SoundId, variation?: number): AudioBuffer | null {
    if (variation !== undefined) return this.get(id, variation);
    const l = this.buffers.get(id);
    if (!l || !l.length) return null;
    const idx: number[] = [];
    l.forEach((b, i) => b && idx.push(i));
    if (!idx.length) return null;
    if (idx.length === 1) return l[idx[0]]!;
    let h = this.history.get(id);
    if (!h) this.history.set(id, (h = []));
    const recent = h.slice(-Math.min(idx.length > 3 ? 2 : 1, h.length));
    let k = idx[0];
    for (let tries = 0; tries < 10; tries++) {
      k = idx[Math.floor(Math.random() * idx.length)];
      if (!recent.includes(k)) break;
    }
    h.push(k);
    if (h.length > 4) h.shift();
    return l[k]!;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
