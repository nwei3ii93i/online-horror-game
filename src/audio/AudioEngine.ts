import * as THREE from 'three/webgpu';
import { SOUND_DEFS, SoundBank, type BankStats, type SoundId } from './SoundBank';
import { ENV_PRESETS, normalizeEnvironment, type EnvironmentId } from './Environments';

export type BusName = 'sfx' | 'ambience' | 'ui' | 'music';
export type { EnvironmentId };

export interface PlayOptions {
  /** World position; omit for a non-positional (head-locked) sound. */
  position?: THREE.Vector3;
  /** Multiplier on the sound's default gain. */
  volume?: number;
  /** Playback-rate multiplier. */
  pitch?: number;
  /** Random ± fraction applied to pitch (defaults per sound). */
  pitchVariance?: number;
  loop?: boolean;
  /** Reverb send 0..1 (defaults per sound). */
  reverb?: number;
  /** Manual occlusion 0..1 (combined with the occlusion provider by max()). */
  occlusion?: number;
  refDistance?: number;
  maxDistance?: number;
  bus?: 'sfx' | 'ambience' | 'ui';
  // ---- extensions
  rolloff?: number;
  /** Extra lowpass cap in Hz (e.g. crouched / muffled footsteps). */
  lowpass?: number;
  /** Force a specific variation instead of a random one. */
  variation?: number;
  /** Start delay in seconds. */
  delay?: number;
  /** Start offset into the buffer (s). Loops start at a random offset by default. */
  offset?: number;
  /** Fade-in time (s). Loops default to 0.3 s. */
  fadeIn?: number;
  /** Non-positional loops only: play the mono loop twice, half a loop apart, hard L/R → wide stereo bed. */
  wide?: boolean;
  /** Voice-stealing priority (higher survives). */
  priority?: number;
}

export interface SoundHandle {
  readonly id: SoundId | null;
  readonly playing: boolean;
  stop(fadeSec?: number): void;
  setPosition(v: THREE.Vector3): void;
  /** Volume multiplier (same meaning as PlayOptions.volume). */
  setVolume(v: number, rampSec?: number): void;
  /** 0..1: lowpass + attenuation, smoothed. */
  setOcclusion(o: number): void;
  setPitch(p: number, rampSec?: number): void;
  setReverb(send: number): void;
}

class SilentHandle implements SoundHandle {
  readonly id = null;
  readonly playing = false;
  stop(): void {}
  setPosition(): void {}
  setVolume(): void {}
  setOcclusion(): void {}
  setPitch(): void {}
  setReverb(): void {}
}

/** Returned whenever a sound cannot or should not play (no audio, culled, not ready). */
export const SILENT_HANDLE: SoundHandle = new SilentHandle();

export interface AudioEngineOptions {
  masterVolume?: number;
  /** Use HRTF panning for positional sounds (default true). */
  hrtf?: boolean;
  /** Maximum simultaneous voices (default 48). */
  maxVoices?: number;
}

export type OcclusionProvider = (from: THREE.Vector3, to: THREE.Vector3) => number;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const SMOOTH = 0.08;

/** Lowpass cutoff for an occlusion amount (0 → open, 1 → behind a solid wall). */
const occCutoff = (o: number): number => 20000 * Math.pow(0.028, o);
/** Air absorption: gentle darkening of far sources. */
const airCutoff = (d: number): number => (d < 20 ? 20000 : Math.max(2500, 20000 * Math.exp(-(d - 20) / 140)));
/** Inverse distance model, as the PannerNode computes it. */
function distanceGain(d: number, ref: number, max: number, rolloff: number): number {
  const dd = Math.min(Math.max(d, ref), Math.max(ref, max));
  return ref / (ref + rolloff * (dd - ref));
}
/** Fade to silence between max and 1.25·max (the panner itself stops attenuating at max). */
const rangeFade = (d: number, max: number): number => (d <= max ? 1 : Math.max(0, 1 - (d - max) / (0.25 * max)));

function holdParam(p: AudioParam, t: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof anyP.cancelAndHoldAtTime === 'function') {
    anyP.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

function setParam(p: AudioParam, v: number, t: number, immediate: boolean, tc = SMOOTH): void {
  if (!Number.isFinite(v)) return;
  if (immediate) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  } else {
    p.setTargetAtTime(v, t, tc);
  }
}

function setPannerPosition(p: PannerNode, v: THREE.Vector3): void {
  if (p.positionX) {
    p.positionX.value = v.x;
    p.positionY.value = v.y;
    p.positionZ.value = v.z;
  } else {
    (p as PannerNode & { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, v.z);
  }
}

class Voice implements SoundHandle {
  playing = true;
  stopping = false;
  finished = false;
  stopAt = 0;
  readonly position = new THREE.Vector3();
  distance = 0;
  providerOcc = 0;
  manualOcc: number;
  volume: number;
  reverb: number;
  rate: number;
  readonly born: number;

  constructor(
    private readonly engine: AudioEngine,
    readonly id: SoundId,
    private readonly ctx: AudioContext,
    readonly srcs: AudioBufferSourceNode[],
    readonly nodes: AudioNode[],
    readonly filter: BiquadFilterNode,
    readonly gain: GainNode,
    readonly fade: GainNode,
    readonly panner: PannerNode | null,
    readonly send: GainNode,
    readonly loop: boolean,
    readonly priority: number,
    private readonly defGain: number,
    private readonly ref: number,
    private readonly max: number,
    private readonly baked: boolean,
    private readonly lowpassCap: number,
    volume: number,
    reverb: number,
    occ: number,
    rate: number,
  ) {
    this.volume = volume;
    this.reverb = reverb;
    this.manualOcc = occ;
    this.rate = rate;
    this.born = ctx.currentTime;
  }

  get positional(): boolean {
    return this.panner !== null;
  }

  /** Push gain / filter / send targets to the graph. */
  apply(immediate: boolean): void {
    if (this.finished) return;
    const t = this.ctx.currentTime;
    const occ = Math.max(this.manualOcc, this.providerOcc);
    const nyq = this.ctx.sampleRate * 0.5 - 200;
    let cut = Math.min(this.lowpassCap, occCutoff(occ), nyq);
    if (this.positional && !this.baked) cut = Math.min(cut, airCutoff(this.distance));
    const att = Math.pow(10, (-15 * occ) / 20);
    const range = this.positional ? rangeFade(this.distance, this.max) : 1;
    const revDist = this.positional ? Math.min(1, Math.max(0.15, Math.sqrt(this.ref / Math.max(this.distance, this.ref)))) : 1;
    setParam(this.filter.frequency, Math.max(40, cut), t, immediate, 0.12);
    setParam(this.gain.gain, this.volume * att * range, t, immediate);
    setParam(this.send.gain, this.reverb * revDist * (1 - 0.35 * occ) * range, t, immediate);
  }

  stop(fadeSec = 0.05): void {
    if (!this.playing || this.stopping) return;
    this.stopping = true;
    const t = this.ctx.currentTime;
    const f = Math.max(0.01, fadeSec);
    try {
      holdParam(this.fade.gain, t);
      this.fade.gain.linearRampToValueAtTime(0, t + f);
    } catch {
      /* ignore */
    }
    this.stopAt = t + f;
    for (const s of this.srcs) {
      try {
        s.stop(t + f + 0.02);
      } catch {
        /* already stopped */
      }
    }
  }

  setPosition(v: THREE.Vector3): void {
    if (this.finished) return;
    this.position.copy(v);
    if (this.panner) setPannerPosition(this.panner, v);
  }

  setVolume(v: number, rampSec = 0.05): void {
    if (this.finished || this.stopping) return;
    this.volume = Math.max(0, v) * this.defGain;
    const occ = Math.max(this.manualOcc, this.providerOcc);
    const range = this.positional ? rangeFade(this.distance, this.max) : 1;
    const g = this.volume * Math.pow(10, (-15 * occ) / 20) * range;
    setParam(this.gain.gain, g, this.ctx.currentTime, rampSec <= 0, Math.max(0.005, rampSec / 3));
  }

  setOcclusion(o: number): void {
    if (this.finished) return;
    this.manualOcc = clamp01(o);
    this.apply(false);
  }

  setPitch(p: number, rampSec = 0.1): void {
    if (this.finished) return;
    const r = Math.max(0.05, p * this.rate);
    for (const s of this.srcs) setParam(s.playbackRate, r, this.ctx.currentTime, rampSec <= 0, Math.max(0.005, rampSec / 3));
  }

  setReverb(send: number): void {
    if (this.finished) return;
    this.reverb = Math.max(0, send);
    this.apply(false);
  }

  /** Tear down the graph (called on 'ended' or when stale). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    for (const s of this.srcs) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.engine._remove(this);
  }
}

/**
 * Web Audio engine: buses, global convolution reverb with per-environment procedural IRs
 * (crossfaded between two convolvers), HRTF-panned positional voices with smoothed
 * occlusion / air absorption, voice limiting, and the procedural sound bank.
 *
 * Every method is safe to call when Web Audio is unavailable or before init() — the game
 * simply runs silently.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  bank: SoundBank | null = null;
  /** True once the sound bank is rendered and the graph is built. */
  ready = false;
  readonly listenerPosition = new THREE.Vector3();
  readonly listenerForward = new THREE.Vector3(0, 0, -1);
  readonly listenerUp = new THREE.Vector3(0, 1, 0);
  /** Occlusion evaluations per positional voice per second. */
  occlusionRate = 5;

  private failed = false;
  private hrtf: boolean;
  private maxVoices: number;
  private masterVolume: number;
  private muted = false;
  private master: GainNode | null = null;
  private buses: Partial<Record<BusName, GainNode>> = {};
  private sends: Partial<Record<BusName, GainNode>> = {};
  private busVolumes: Record<BusName, number> = { sfx: 1, ambience: 0.85, ui: 0.8, music: 0.6 };
  private convs: ConvolverNode[] = [];
  private convGains: GainNode[] = [];
  private activeConv = 0;
  private envApplied = false;
  private envToken = 0;
  private env: EnvironmentId = 'outdoor';
  private voices: Voice[] = [];
  private rr = 0;
  private occProvider: OcclusionProvider | null = null;
  private initPromise: Promise<void> | null = null;
  private unlockHandler: (() => void) | null = null;

  constructor(opts: AudioEngineOptions = {}) {
    this.masterVolume = clamp01(opts.masterVolume ?? 0.9);
    this.hrtf = opts.hrtf ?? true;
    this.maxVoices = opts.maxVoices ?? 48;
  }

  /** The AudioContext (null if Web Audio is unavailable or not created yet). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get environment(): EnvironmentId {
    return this.env;
  }

  /** True when the context exists and is running (i.e. sound is actually audible). */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get activeVoices(): number {
    return this.voices.length;
  }

  get stats(): BankStats | null {
    return this.bank?.stats ?? null;
  }

  // ----------------------------------------------------------------------------- lifecycle

  private ensureContext(): AudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    try {
      const w = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) : null;
      const Ctor = w ? w.AudioContext ?? w.webkitAudioContext : undefined;
      if (!Ctor) {
        this.failed = true;
        return null;
      }
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (e) {
      console.warn('[audio] Web Audio unavailable, running silent', e);
      this.failed = true;
      this.ctx = null;
    }
    return this.ctx;
  }

  /**
   * Create the context, build the graph and pre-render the sound bank (progress 0..1).
   * Resolves (never rejects) — on failure the engine stays silent.
   */
  init(onProgress?: (p: number) => void): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit(onProgress);
    return this.initPromise;
  }

  private async doInit(onProgress?: (p: number) => void): Promise<void> {
    const report = (p: number) => {
      try {
        onProgress?.(p);
      } catch {
        /* never let UI callbacks break audio init */
      }
    };
    const ctx = this.ensureContext();
    if (!ctx) {
      report(1);
      return;
    }
    try {
      this.buildGraph(ctx);
      this.installUnlock();
      this.bank = new SoundBank(ctx);
      const st = await this.bank.render(report);
      if (st.bad > 0) console.warn(`[audio] ${st.bad} non-finite samples were zeroed`);
      this.ready = true;
      this.applyEnvironment(this.env, 0);
    } catch (e) {
      console.warn('[audio] init failed, running silent', e);
      this.ready = false;
    }
    report(1);
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.masterVolume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;

    const reverbIn = ctx.createGain();
    const preHp = ctx.createBiquadFilter();
    preHp.type = 'highpass';
    preHp.frequency.value = 90;
    reverbIn.connect(preHp);
    const reverbOut = ctx.createGain();
    reverbOut.connect(master);
    for (let i = 0; i < 2; i++) {
      const c = ctx.createConvolver();
      c.normalize = false;
      const g = ctx.createGain();
      g.gain.value = 0;
      preHp.connect(c);
      c.connect(g);
      g.connect(reverbOut);
      this.convs.push(c);
      this.convGains.push(g);
    }
    for (const b of ['sfx', 'ambience', 'ui', 'music'] as const) {
      const g = ctx.createGain();
      g.gain.value = this.busVolumes[b];
      g.connect(master);
      this.buses[b] = g;
      const s = ctx.createGain();
      s.gain.value = this.busVolumes[b];
      s.connect(reverbIn);
      this.sends[b] = s;
    }
  }

  /** Resume on the first user gesture automatically (the game should still call resume()). */
  private installUnlock(): void {
    if (typeof window === 'undefined' || this.unlockHandler) return;
    const h = () => {
      void this.resume().then(() => {
        if (this.running && this.unlockHandler) {
          for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(ev, h, true);
          this.unlockHandler = null;
        }
      });
    };
    this.unlockHandler = h;
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, h, true);
  }

  /** Call from a user gesture (click / key) — browsers keep audio suspended until then. */
  resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve();
    try {
      return ctx.resume().catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  /** Suspend processing (e.g. when the game is paused in a menu). */
  suspend(): Promise<void> {
    if (!this.ctx || this.ctx.state !== 'running') return Promise.resolve();
    return this.ctx.suspend().catch(() => undefined);
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v);
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  setBusVolume(bus: BusName, v: number): void {
    this.busVolumes[bus] = Math.max(0, v);
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const b = this.buses[bus];
    const s = this.sends[bus];
    if (b) setParam(b.gain, this.busVolumes[bus], t, false, 0.05);
    if (s) setParam(s.gain, this.busVolumes[bus], t, false, 0.05);
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    setParam(this.master.gain, this.muted ? 0 : this.masterVolume, this.ctx.currentTime, false, 0.04);
  }

  dispose(): void {
    this.stopAll(0);
    if (this.unlockHandler && typeof window !== 'undefined') {
      for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(ev, this.unlockHandler, true);
    }
    this.unlockHandler = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.ready = false;
  }

  // ----------------------------------------------------------------------------- listener & environment

  setListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    this.listenerPosition.copy(position);
    if (forward.lengthSq() > 1e-8) this.listenerForward.copy(forward).normalize();
    if (up.lengthSq() > 1e-8) this.listenerUp.copy(up).normalize();
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const p = this.listenerPosition, f = this.listenerForward, u = this.listenerUp;
    try {
      if (L.positionX) {
        L.positionX.value = p.x;
        L.positionY.value = p.y;
        L.positionZ.value = p.z;
        L.forwardX.value = f.x;
        L.forwardY.value = f.y;
        L.forwardZ.value = f.z;
        L.upX.value = u.x;
        L.upY.value = u.y;
        L.upZ.value = u.z;
      } else {
        const legacy = L as AudioListener & {
          setPosition(x: number, y: number, z: number): void;
          setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
        };
        legacy.setPosition(p.x, p.y, p.z);
        legacy.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
      }
    } catch {
      /* degenerate orientation — ignore this frame */
    }
  }

  /** Switch the reverb space; IRs are crossfaded over `crossfadeSec`. Accepts loose names too. */
  setEnvironment(env: EnvironmentId | string, crossfadeSec = 1.5): void {
    const e = normalizeEnvironment(env);
    if (e === this.env && this.envApplied) return;
    this.env = e;
    if (this.ready) this.applyEnvironment(e, crossfadeSec);
  }

  private applyEnvironment(env: EnvironmentId, fade: number): void {
    const ctx = this.ctx;
    const ir = this.bank?.getIR(env);
    if (!ctx || !ir || this.convs.length < 2) return;
    const wet = ENV_PRESETS[env].wet;
    const next = this.envApplied ? 1 - this.activeConv : this.activeConv;
    const token = ++this.envToken;
    const go = () => {
      if (token !== this.envToken || !this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const f = Math.max(0.02, fade);
        this.convs[next].buffer = ir;
        const gN = this.convGains[next].gain;
        holdParam(gN, t);
        gN.linearRampToValueAtTime(wet, t + f);
        if (next !== this.activeConv || !this.envApplied) {
          const gO = this.convGains[1 - next].gain;
          holdParam(gO, t);
          gO.linearRampToValueAtTime(0, t + f);
        }
        this.activeConv = next;
        this.envApplied = true;
      } catch (e) {
        console.warn('[audio] environment switch failed', e);
      }
    };
    const g = this.convGains[next].gain;
    if (this.envApplied && g.value > 0.002) {
      // the target convolver is still ringing out from a previous switch: duck it before swapping its IR
      const t = ctx.currentTime;
      holdParam(g, t);
      g.linearRampToValueAtTime(0, t + 0.05);
      setTimeout(go, 70);
    } else {
      go();
    }
  }

  /**
   * Swap synthesised sounds for recorded samples: `${base}${id}_${n}.mp3` for n < count.
   * Missing or undecodable files leave the synthesised version in place.
   */
  async loadSamples(base: string, counts: Partial<Record<SoundId, number>>): Promise<void> {
    const ctx = this.ctx, bank = this.bank;
    if (!ctx || !bank) return;
    await Promise.all(Object.entries(counts).map(async ([id, n]) => {
      const bufs = await Promise.all(Array.from({ length: n ?? 0 }, async (_, i) => {
        try {
          const r = await fetch(`${base}${id}_${i}.mp3`);
          if (!r.ok) return null;
          return await ctx.decodeAudioData(await r.arrayBuffer());
        } catch {
          return null;
        }
      }));
      bank.setSamples(id as SoundId, bufs.filter((b): b is AudioBuffer => !!b));
    }));
  }

  /** fn(listener, source) → 0..1 occlusion. Re-evaluated round-robin for active positional sounds. */
  setOcclusionProvider(fn: OcclusionProvider | null): void {
    this.occProvider = fn;
  }

  // ----------------------------------------------------------------------------- playback

  play(id: SoundId, opts: PlayOptions = {}): SoundHandle {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank || !this.ready || ctx.state === 'closed') return SILENT_HANDLE;
    const def = SOUND_DEFS[id];
    if (!def) return SILENT_HANDLE;
    const loop = opts.loop ?? !!def.loop;
    // one-shots requested while audio is locked would all fire at once on resume
    if (!loop && ctx.state !== 'running') return SILENT_HANDLE;
    const buffer = bank.pick(id, opts.variation);
    if (!buffer) return SILENT_HANDLE;

    const positional = !!opts.position;
    const volume = Math.max(0, (opts.volume ?? 1) * def.gain);
    const ref = Math.max(0.05, opts.refDistance ?? def.ref);
    const max = Math.max(ref, opts.maxDistance ?? def.max);
    const rolloff = opts.rolloff ?? 1;
    let dist = 0;
    let provOcc = 0;
    if (positional) {
      dist = opts.position!.distanceTo(this.listenerPosition);
      if (!loop && volume * distanceGain(dist, ref, max, rolloff) * rangeFade(dist, max) < 0.0015) return SILENT_HANDLE;
      if (this.occProvider) {
        try {
          provOcc = clamp01(this.occProvider(this.listenerPosition, opts.position!));
        } catch {
          provOcc = 0;
        }
      }
    }
    const priority = opts.priority ?? def.priority ?? 1;
    if (!this.makeRoom(priority, loop)) return SILENT_HANDLE;

    try {
      const pv = opts.pitchVariance ?? def.pitchVar;
      const rate = Math.max(0.05, (opts.pitch ?? 1) * (1 + pv * (Math.random() * 2 - 1)));
      const t0 = ctx.currentTime + Math.max(0, opts.delay ?? 0);
      const wide = !positional && !!opts.wide && loop;
      const mk = () => {
        const s = ctx.createBufferSource();
        s.buffer = buffer;
        s.loop = loop;
        s.playbackRate.value = rate;
        return s;
      };
      const srcs: AudioBufferSourceNode[] = [];
      const nodes: AudioNode[] = [];
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = -3; // dB → Butterworth-ish, no resonance
      const gain = ctx.createGain();
      const fade = ctx.createGain();
      const send = ctx.createGain();
      nodes.push(filter, gain, fade, send);
      if (wide) {
        const merger = ctx.createChannelMerger(2);
        const a = mk();
        const b = mk();
        a.connect(merger, 0, 0);
        b.connect(merger, 0, 1);
        merger.connect(filter);
        srcs.push(a, b);
        nodes.push(merger);
      } else {
        const a = mk();
        a.connect(filter);
        srcs.push(a);
      }
      filter.connect(gain);
      gain.connect(fade);
      const busName: BusName = opts.bus ?? def.bus;
      const bus = this.buses[busName]!;
      let panner: PannerNode | null = null;
      if (positional) {
        panner = ctx.createPanner();
        panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = ref;
        panner.maxDistance = max;
        panner.rolloffFactor = rolloff;
        setPannerPosition(panner, opts.position!);
        fade.connect(panner);
        panner.connect(bus);
        nodes.push(panner);
      } else {
        fade.connect(bus);
      }
      fade.connect(send);
      send.connect(this.sends[busName]!);

      const voice = new Voice(
        this, id, ctx, srcs, nodes, filter, gain, fade, panner, send, loop, priority, def.gain, ref, max,
        !!def.baked, opts.lowpass ?? 22050, volume, Math.max(0, opts.reverb ?? def.reverb), clamp01(opts.occlusion ?? 0), rate,
      );
      if (positional) voice.position.copy(opts.position!);
      voice.distance = dist;
      voice.providerOcc = provOcc;
      voice.apply(true);

      const fadeIn = opts.fadeIn ?? (loop ? 0.3 : 0);
      if (fadeIn > 0) {
        fade.gain.setValueAtTime(0, t0);
        fade.gain.linearRampToValueAtTime(1, t0 + fadeIn);
      }
      const dur = buffer.duration;
      let off = opts.offset ?? (loop ? Math.random() * dur : 0);
      off = Math.min(Math.max(0, off), Math.max(0, dur - 0.001));
      srcs[0].start(t0, off);
      if (srcs[1]) srcs[1].start(t0, (off + dur * 0.5) % dur);
      srcs[0].onended = () => voice.finish();
      this.voices.push(voice);
      return voice;
    } catch (e) {
      console.warn(`[audio] play(${id}) failed`, e);
      return SILENT_HANDLE;
    }
  }

  /** Stop every active voice. */
  stopAll(fadeSec = 0.1): void {
    for (const v of this.voices.slice()) v.stop(fadeSec);
  }

  /** Steal a voice if at the limit. Returns false if nothing could be freed. */
  private makeRoom(priority: number, loop: boolean): boolean {
    let live = 0;
    for (const v of this.voices) if (!v.stopping) live++;
    if (live < this.maxVoices) return true;
    let best: Voice | null = null;
    for (const v of this.voices) {
      if (v.stopping || v.loop) continue;
      if (v.priority > priority) continue;
      if (!best || v.priority < best.priority || (v.priority === best.priority && v.born < best.born)) best = v;
    }
    if (!best && loop) {
      for (const v of this.voices) if (!v.stopping && !v.loop && (!best || v.born < best.born)) best = v;
    }
    if (!best) return false;
    best.stop(0.03);
    return true;
  }

  /** @internal */
  _remove(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) {
      this.voices[i] = this.voices[this.voices.length - 1];
      this.voices.pop();
    }
  }

  /** Per-frame: occlusion / distance refresh (round-robin) and cleanup. */
  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const now = ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v && v.stopping && now > v.stopAt + 0.75) v.finish();
    }
    const n = this.voices.length;
    if (!n) return;
    let positional = 0;
    for (const v of this.voices) if (v.positional && !v.stopping) positional++;
    if (!positional) return;
    let budget = Math.min(positional, 12, Math.max(1, Math.ceil(positional * Math.max(0, dt) * this.occlusionRate)));
    for (let guard = 0; guard < n && budget > 0; guard++) {
      this.rr = (this.rr + 1) % this.voices.length;
      const v = this.voices[this.rr];
      if (!v || !v.positional || v.stopping) continue;
      v.distance = v.position.distanceTo(this.listenerPosition);
      if (this.occProvider) {
        try {
          v.providerOcc = clamp01(this.occProvider(this.listenerPosition, v.position));
        } catch {
          v.providerOcc = 0;
        }
      }
      v.apply(false);
      budget--;
    }
  }
}
