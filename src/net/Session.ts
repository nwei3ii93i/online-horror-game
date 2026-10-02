/**
 * The game's single entry point to replicated state – identical for solo and multiplayer.
 *
 *     const session = online
 *       ? await Session.connect('wss://host:8787', 'CRYPT', 'Anna')
 *       : await Session.solo('Anna', { seed });
 *
 * Solo uses a {@link LocalTransport} (in-process authoritative HostCore, offline,
 * zero latency); multiplayer uses a {@link WebSocketTransport} to the Node relay, which
 * runs the very same HostCore. Gameplay code never needs to know which one it got:
 *
 *  - world interactions go through `session.act(entity, op, data)` (optimistic, then
 *    reconciled with the host's verdict) and are observed via `session.world.subscribe`,
 *  - the local pose is published with `sendLocalState()` every frame (rate-limited here),
 *  - remote players are read through `players` + `sampleRemote()` (interpolated),
 *  - loud noises go out with `emitSound()` and come in as `'sound'` events.
 *
 * No DOM / three.js dependency (runs in Node too, which the self-test uses).
 */

import {
  DEFAULT_SEED, MAX_ACTION_DATA_JSON, MAX_DECLARE_BATCH, PROTOCOL_VERSION, STATE_RATE, TICK_RATE,
  clamp, isEntityId, isOpName, isSoundId, jsonLength, normalizeRoom, q2, q3, qv3, toEntityState, wrapAngle,
  type EntityState, type ErrorCode, type HelloMsg, type PlayerInfo, type PlayerPose, type PlayerSnapshot, type ServerMessage,
  type Stance, type Vec3, type WelcomeMsg,
} from './protocol';
import { WorldState } from './WorldState';
import { defaultRegistry, type ReducerContext, type ReducerRegistry } from './reducers';
import { LocalTransport } from './LocalTransport';
import { WebSocketTransport, type WebSocketTransportOptions } from './WebSocketTransport';
import type { Transport, TransportCloseEvent } from './Transport';
import { SnapshotBuffer, type RemoteSample } from './Interpolation';
import { Emitter } from './Emitter';
import { deepEqual, deepFreeze, jsonClone } from './util';

export type SessionMode = 'solo' | 'online';

/** Anything with x/y/z (THREE.Vector3) or a 3-tuple. */
export type Vec3Like = { readonly x: number; readonly y: number; readonly z: number } | readonly number[];

/** What the game publishes about the local player each frame. */
export interface LocalPlayerState {
  /** Feet position. */
  p: Vec3Like;
  yaw: number;
  pitch: number;
  stance: Stance;
  /** Flashlight on. */
  light: boolean;
  /** Velocity (m/s). Estimated from positions when omitted. */
  vel?: Vec3Like;
  /** Set once when the game teleports the player (respawn etc.) so the host accepts the jump. */
  teleport?: boolean;
}

/** A remote player as known by this client. */
export class RemotePlayerState {
  /** Interpolation buffer of pose samples. */
  readonly buffer = new SnapshotBuffer();
  /** `performance.now()` when the last pose sample arrived (0 = none yet). */
  lastHeard = 0;
  constructor(public info: PlayerInfo) {}
  get id(): string { return this.info.id; }
  get name(): string { return this.info.name; }
  get color(): string { return this.info.color; }
  /** Newest received pose (not interpolated). */
  get latest(): PlayerSnapshot | undefined { return this.buffer.latest; }
}

export interface EntityEvent {
  entity: string;
  state: Readonly<EntityState> | undefined;
  prev: Readonly<EntityState> | undefined;
  /** Player id that caused the change, or `'host'`. */
  by: string;
  t: number;
}

export interface SessionEvents {
  /** A player joined (after the session was established; the initial roster is in `players`). */
  playerJoined: PlayerInfo;
  playerLeft: { id: string; player: PlayerInfo; reason: string };
  /** Authoritative entity change (also for the local player's own accepted actions). */
  entity: EntityEvent;
  /** Loud noise made by another player. */
  sound: { id: string; p: Vec3; v: number; by: string };
  /** Connection lost (`willReconnect`) or ended for good. */
  disconnected: { reason: string; willReconnect: boolean };
  /** Automatic reconnect succeeded. `idChanged` if the old slot had expired. */
  reconnected: { resumed: boolean; idChanged: boolean };
  error: { code: ErrorCode; message: string; fatal: boolean };
}

export interface SessionOptions {
  /** Minimum interpolation delay (ms); grows adaptively with network jitter. Default 100. */
  interpolationDelay?: number;
  /** Upper bound of the adaptive interpolation delay (ms). Default 350. */
  maxInterpolationDelay?: number;
  /** Pose upload rate (Hz). Default 20. */
  stateRate?: number;
  /** Actions without host answer resolve `false` after this (ms). Default 8000. */
  actionTimeout?: number;
  /** Max wait for `welcome` (ms). Default 8000. */
  welcomeTimeout?: number;
  /** Rule registry for client-side prediction (default: shared default registry). */
  registry?: ReducerRegistry;
  /** World seed. Solo: the seed. Online: only used if this client creates the room. */
  seed?: number;
}

export interface ConnectOptions extends SessionOptions {
  transport?: WebSocketTransportOptions;
}

interface PendingAction {
  seq: number;
  entity: string;
  op: string;
  data: unknown;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const toTuple = (v: Vec3Like): Vec3 =>
  'x' in v ? [v.x, v.y, v.z] : [v[0] ?? NaN, v[1] ?? NaN, v[2] ?? NaN];
const finite3 = (v: Vec3): boolean => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

export class Session {
  readonly world: WorldState;
  /** Other players in the room (never contains the local player). */
  readonly players = new Map<string, RemotePlayerState>();
  readonly events = new Emitter<SessionEvents>();
  /** Room code ('SOLO' in solo). */
  room = '';
  /** World seed decided by the host – build the procedural world from this. */
  seed = DEFAULT_SEED;
  tickRate = TICK_RATE;
  /** The local player's info (id, name, colour). */
  self: PlayerInfo = { id: '', name: '', color: '#ffffff', joinedAt: 0 };

  private readonly opts: Required<Omit<SessionOptions, 'registry' | 'seed'>>;
  private readonly requestedSeed: number | undefined;
  private name = '';
  private requestedRoom = '';
  private token = '';
  private joined = false;
  private ended = false;
  private lastError: { code: ErrorCode; message: string } | null = null;
  private welcomeWaiter: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  // world replication
  private confirmed = new Map<string, Readonly<EntityState>>();
  private pending: PendingAction[] = [];
  private declared = new Map<string, EntityState>();
  private declareQueue = new Map<string, EntityState>();
  private declareScheduled = false;
  private actionSeq = 0;

  // local pose upload
  private stateSeq = 0;
  private lastStateSent = -Infinity;
  private lastPose: PlayerPose | null = null;
  private tpPending = false;
  private velEstimate: { p: Vec3; t: number } | null = null;

  // clock sync
  private clockOffset = 0;
  private targetOffset = 0;
  private lastClockUpdate = performance.now();
  private clockSamples: { rtt: number; offset: number }[] = [];

  // adaptive interpolation delay
  private delay: number;
  private delayTarget: number;
  private lastDelayUpdate = performance.now();
  private lateEma = 0;
  private lateDev = 0;
  private lateInit = false;

  private constructor(readonly transport: Transport, readonly mode: SessionMode, opts: SessionOptions) {
    this.opts = {
      interpolationDelay: opts.interpolationDelay ?? 100,
      maxInterpolationDelay: opts.maxInterpolationDelay ?? 350,
      stateRate: opts.stateRate ?? STATE_RATE,
      actionTimeout: opts.actionTimeout ?? 8000,
      welcomeTimeout: opts.welcomeTimeout ?? 8000,
    };
    this.requestedSeed = opts.seed;
    this.delay = this.delayTarget = this.opts.interpolationDelay;
    this.world = new WorldState(opts.registry ?? defaultRegistry);
    transport.onMessage((m) => this.onMessage(m));
    transport.onClose((e) => this.onTransportClose(e));
    transport.onReopen?.(() => this.sendHello(true));
  }

  // -------------------------------------------------------------------------------------
  // Factories
  // -------------------------------------------------------------------------------------

  /** Single player, fully offline: authoritative host runs in-process. */
  static async solo(name = 'Wanderer', opts: SessionOptions = {}): Promise<Session> {
    const transport = new LocalTransport({ room: 'SOLO', seed: opts.seed, registry: opts.registry });
    return Session.create(transport, 'solo', 'SOLO', name, opts);
  }

  /**
   * Joins (or creates) room `room` on the relay at `url` (e.g. `ws://localhost:8787`).
   * Rejects if the server is unreachable, the room is full or the protocol differs.
   */
  static async connect(url: string, room: string, name: string, opts: ConnectOptions = {}): Promise<Session> {
    const code = normalizeRoom(room);
    if (!code) throw new Error(`Invalid room code "${room}" (1-32 chars: A-Z 0-9 _ -)`);
    const transport = new WebSocketTransport(url, opts.transport);
    return Session.create(transport, 'online', code, name, opts);
  }

  /** Low-level factory for any transport (e.g. several LocalTransports sharing one HostCore). */
  static async create(transport: Transport, mode: SessionMode, room: string, name: string, opts: SessionOptions = {}): Promise<Session> {
    const s = new Session(transport, mode, opts);
    s.name = name;
    s.requestedRoom = room;
    try {
      await transport.connect();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          s.welcomeWaiter = null;
          reject(new Error('The host did not answer'));
        }, s.opts.welcomeTimeout);
        s.welcomeWaiter = { resolve, reject, timer };
        s.sendHello(false);
      });
    } catch (err) {
      s.ended = true;
      transport.close();
      throw err;
    }
    return s;
  }

  // -------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------

  get localId(): string {
    return this.self.id;
  }

  /** True while joined to the host (false during reconnects and after close). */
  get connected(): boolean {
    return this.joined;
  }

  /** Smoothed round-trip time to the host in ms (0 in solo). */
  get latency(): number {
    return this.transport.latency;
  }

  /** Current adaptive interpolation delay (ms). */
  get interpolationDelay(): number {
    return this.delay;
  }

  /** Every player in the room including the local one. */
  roster(): PlayerInfo[] {
    return [this.self, ...[...this.players.values()].map((p) => p.info)];
  }

  /** Estimated host clock (ms). Monotonic except for large corrections (> 250 ms). */
  serverNow(): number {
    const now = performance.now();
    const dt = now - this.lastClockUpdate;
    this.lastClockUpdate = now;
    const diff = this.targetOffset - this.clockOffset;
    if (Math.abs(diff) > 250) this.clockOffset = this.targetOffset;
    else this.clockOffset += clamp(diff, -dt * 0.05, dt * 0.05);
    return now + this.clockOffset;
  }

  /** Host time at which remote players should be rendered this frame (serverNow − delay). */
  renderTime(): number {
    const now = performance.now();
    const dt = now - this.lastDelayUpdate;
    this.lastDelayUpdate = now;
    this.delay += clamp(this.delayTarget - this.delay, -dt * 0.05, dt * 0.05);
    return this.serverNow() - this.delay;
  }

  /** Interpolated pose of remote player `id` at `renderTime`, or null if unknown / no data yet. */
  sampleRemote(id: string, renderTime: number, out?: RemoteSample): RemoteSample | null {
    return this.players.get(id)?.buffer.sample(renderTime, out) ?? null;
  }

  // -------------------------------------------------------------------------------------
  // Outgoing
  // -------------------------------------------------------------------------------------

  /** Publish the local pose. Call every frame; sends at ≤ `stateRate` Hz and only on change (1 Hz keep-alive). */
  sendLocalState(state: LocalPlayerState): void {
    const now = performance.now();
    const p = toTuple(state.p);
    if (!finite3(p) || !Number.isFinite(state.yaw) || !Number.isFinite(state.pitch)) return;
    if (state.teleport) this.tpPending = true;
    let vel: Vec3;
    if (state.vel) vel = toTuple(state.vel);
    else if (this.velEstimate && now - this.velEstimate.t > 1) {
      const k = 1000 / (now - this.velEstimate.t);
      vel = [(p[0] - this.velEstimate.p[0]) * k, (p[1] - this.velEstimate.p[1]) * k, (p[2] - this.velEstimate.p[2]) * k];
    } else vel = [0, 0, 0];
    if (!finite3(vel) || state.teleport) vel = [0, 0, 0];
    this.velEstimate = { p, t: now };

    if (!this.joined || now - this.lastStateSent < 1000 / this.opts.stateRate - 2) return;
    const pose: PlayerPose = {
      p: qv3(p),
      yaw: q3(wrapAngle(state.yaw)),
      pitch: q3(clamp(state.pitch, -1.6, 1.6)),
      stance: state.stance,
      light: !!state.light,
      vel: [q2(clamp(vel[0], -60, 60)), q2(clamp(vel[1], -60, 60)), q2(clamp(vel[2], -60, 60))],
    };
    const changed = !this.lastPose || !deepEqual(pose, this.lastPose);
    if (!changed && !this.tpPending && now - this.lastStateSent < 1000) return;
    this.transport.send({ type: 'state', seq: ++this.stateSeq, t: Math.round(this.serverNow()), ...pose, ...(this.tpPending ? { tp: true } : {}) });
    this.lastStateSent = now;
    this.lastPose = pose;
    this.tpPending = false;
  }

  /**
   * Perform a world action, e.g. `act('door:manor_front', 'open', { angle: 1.4 })`.
   *
   * If the shared rules accept it locally, the change is applied to `world` immediately
   * (subscribers fire synchronously) and sent to the host. The promise resolves with the
   * host's verdict; on rejection the world rolls back to the authoritative state.
   * Resolves `false` while disconnected.
   */
  act(entity: string, op: string, data?: unknown): Promise<boolean> {
    if (!this.joined) return Promise.resolve(false);
    if (!isEntityId(entity) || !isOpName(op)) {
      console.warn(`[Session] invalid action ${entity}.${op}`);
      return Promise.resolve(false);
    }
    if (data !== undefined) {
      const len = jsonLength(data);
      if (len < 0 || len > MAX_ACTION_DATA_JSON) {
        console.warn(`[Session] action data for ${entity}.${op} is not serialisable or too large`);
        return Promise.resolve(false);
      }
      data = jsonClone(data);
    }
    const seq = ++this.actionSeq;
    const predicted = this.world.reduce(entity, op, data, this.ctx(entity));
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pending.findIndex((p) => p.seq === seq);
        if (i < 0) return;
        this.pending.splice(i, 1);
        this.recompute(entity);
        resolve(false);
      }, this.opts.actionTimeout);
      this.pending.push({ seq, entity, op, data, resolve, timer });
      if (predicted) this.world.applyAuthoritative(entity, predicted);
      this.flushDeclares();
      this.transport.send({ type: 'action', seq, entity, op, ...(data !== undefined ? { data } : {}) });
    });
  }

  /** Would `act(entity, op, data)` be accepted given what this client currently sees? (No side effects.) */
  predict(entity: string, op: string, data?: unknown): boolean {
    return this.world.reduce(entity, op, data, this.ctx(entity)) !== null;
  }

  /**
   * Declare the default state of an entity of the seeded world, e.g.
   * `declare('door:cellar', { locked: true, key: 'cellar_key' })`. Ignored if the entity
   * already has a state (e.g. from the host snapshot). The host keeps the first
   * declaration it receives, so every client building the same seed agrees.
   */
  declare(id: string, state: EntityState): void {
    if (!isEntityId(id)) {
      console.warn(`[Session] invalid entity id "${id}"`);
      return;
    }
    const s = toEntityState(state);
    if (!s) {
      console.warn(`[Session] state of ${id} is not a small JSON object`);
      return;
    }
    this.declared.set(id, s);
    if (this.confirmed.has(id)) return;
    this.confirmed.set(id, deepFreeze(s));
    this.recompute(id);
    this.declareQueue.set(id, s);
    this.scheduleDeclareFlush();
  }

  declareAll(states: Record<string, EntityState>): void {
    for (const [id, s] of Object.entries(states)) this.declare(id, s);
  }

  /** Broadcast a loud noise (door slam, scream, dropped item) to the other players. `v` = 0..1. */
  emitSound(id: string, pos: Vec3Like, volume = 1): void {
    if (!this.joined || !isSoundId(id)) return;
    const p = toTuple(pos);
    if (!finite3(p) || !Number.isFinite(volume)) return;
    this.transport.send({ type: 'sound', id, p: qv3(p), v: q3(clamp(volume, 0, 1)) });
  }

  /** Subscribe to a session event. Returns an unsubscribe function. */
  on<K extends keyof SessionEvents>(type: K, fn: (payload: SessionEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  /** Leave the room and close the connection (solo: shuts the local host down). */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.joined) this.transport.send({ type: 'bye' });
    this.transport.close();
  }

  // -------------------------------------------------------------------------------------
  // Incoming
  // -------------------------------------------------------------------------------------

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.onWelcome(msg);
        break;
      case 'joined': {
        const info = msg.player;
        if (info.id === this.self.id) break;
        const existing = this.players.get(info.id);
        if (existing) existing.info = info;
        else {
          this.players.set(info.id, new RemotePlayerState(info));
          this.events.emit('playerJoined', info);
        }
        break;
      }
      case 'left': {
        const rp = this.players.get(msg.id);
        if (!rp) break;
        this.players.delete(msg.id);
        this.events.emit('playerLeft', { id: msg.id, player: rp.info, reason: msg.reason });
        break;
      }
      case 'states': {
        const now = performance.now();
        const hostNow = this.serverNow();
        for (const s of msg.players) {
          const rp = this.players.get(s.id);
          if (!rp || !rp.buffer.push(s)) continue;
          rp.lastHeard = now;
          this.trackLateness(hostNow - s.t);
        }
        break;
      }
      case 'entity':
        this.onAuthoritative(msg.entity, msg.state, msg.by, msg.t);
        break;
      case 'entities':
        for (const [id, st] of Object.entries(msg.states)) this.onAuthoritative(id, st, msg.by, msg.t);
        break;
      case 'ack':
        this.onAck(msg.seq, msg.ok, msg.entity, msg.state);
        break;
      case 'sound':
        this.events.emit('sound', { id: msg.id, p: msg.p, v: msg.v, by: msg.by });
        break;
      case 'pong':
        this.onPong(msg.t, msg.serverTime);
        break;
      case 'error':
        this.lastError = { code: msg.code, message: msg.message };
        this.events.emit('error', { code: msg.code, message: msg.message, fatal: msg.fatal });
        if (msg.fatal && this.welcomeWaiter) {
          const w = this.welcomeWaiter;
          this.welcomeWaiter = null;
          clearTimeout(w.timer);
          w.reject(new Error(msg.message));
        }
        break;
    }
  }

  private onWelcome(msg: WelcomeMsg): void {
    const first = this.self.id === '';
    const prevId = this.self.id;
    this.self = msg.you;
    this.token = msg.token;
    this.room = msg.room;
    this.seed = msg.seed;
    this.tickRate = msg.tickRate;

    // clock: coarse estimate now, refined by pongs
    const est = msg.serverTime + this.transport.latency / 2 - performance.now();
    this.clockSamples = [];
    if (first || Math.abs(est - this.clockOffset) > 250) {
      this.clockOffset = this.targetOffset = est;
      this.lastClockUpdate = performance.now();
    } else this.targetOffset = est;

    // roster
    const ids = new Set(msg.players.map((p) => p.id));
    for (const [id, rp] of [...this.players]) {
      if (ids.has(id)) continue;
      this.players.delete(id);
      this.events.emit('playerLeft', { id, player: rp.info, reason: 'left' });
    }
    for (const info of msg.players) {
      const rp = this.players.get(info.id);
      if (rp) rp.info = info;
      else {
        this.players.set(info.id, new RemotePlayerState(info));
        if (!first) this.events.emit('playerJoined', info);
      }
    }

    // world: authoritative snapshot + our declarations the host does not know (e.g. after a host restart)
    const snapshot = msg.world;
    for (const [id, st] of this.declared) {
      if (!(id in snapshot)) {
        snapshot[id] = st;
        this.declareQueue.set(id, st);
      }
    }
    this.confirmed.clear();
    for (const [id, st] of Object.entries(snapshot)) this.confirmed.set(id, deepFreeze(st));
    this.world.load(snapshot);

    this.joined = true;
    this.lastStateSent = -Infinity;
    this.lastPose = null;
    this.scheduleDeclareFlush();

    if (this.welcomeWaiter) {
      const w = this.welcomeWaiter;
      this.welcomeWaiter = null;
      clearTimeout(w.timer);
      w.resolve();
    } else {
      this.events.emit('reconnected', { resumed: msg.resumed, idChanged: prevId !== msg.you.id });
    }
  }

  private onAuthoritative(entity: string, state: EntityState, by: string, t: number): void {
    const prev = this.confirmed.get(entity);
    this.confirmed.set(entity, deepFreeze(state));
    this.recompute(entity);
    if (!deepEqual(prev, state)) this.events.emit('entity', { entity, state: this.confirmed.get(entity), prev, by, t });
  }

  private onAck(seq: number, ok: boolean, entity: string, state: EntityState | undefined): void {
    const i = this.pending.findIndex((p) => p.seq === seq);
    const pa = i >= 0 ? this.pending.splice(i, 1)[0] : undefined;
    if (pa) clearTimeout(pa.timer);
    const prev = this.confirmed.get(entity);
    if (state) this.confirmed.set(entity, deepFreeze(state));
    this.recompute(entity);
    if (ok && state && !deepEqual(prev, state)) {
      this.events.emit('entity', { entity, state: this.confirmed.get(entity), prev, by: this.self.id, t: this.serverNow() });
    }
    pa?.resolve(ok);
  }

  private onPong(t: number, serverTime: number): void {
    const now = performance.now();
    const rtt = now - t;
    if (!(rtt >= 0 && rtt < 10000)) return;
    this.clockSamples.push({ rtt, offset: serverTime + rtt / 2 - now });
    if (this.clockSamples.length > 12) this.clockSamples.shift();
    let best = this.clockSamples[0];
    for (const s of this.clockSamples) if (s.rtt < best.rtt) best = s;
    this.targetOffset = best.offset;
  }

  private onTransportClose(ev: TransportCloseEvent): void {
    const wasJoined = this.joined;
    this.joined = false;
    this.failPending();
    if (this.welcomeWaiter && !ev.willReconnect) {
      const w = this.welcomeWaiter;
      this.welcomeWaiter = null;
      clearTimeout(w.timer);
      w.reject(new Error(this.lastError?.message ?? ev.reason));
      return;
    }
    if (ev.willReconnect) {
      if (wasJoined) this.events.emit('disconnected', { reason: ev.reason, willReconnect: true });
      return;
    }
    this.ended = true;
    this.events.emit('disconnected', { reason: this.lastError?.message ?? ev.reason, willReconnect: false });
  }

  // -------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------

  private sendHello(resume: boolean): void {
    const hello: HelloMsg = { type: 'hello', protocol: PROTOCOL_VERSION, name: this.name, room: this.requestedRoom };
    if (this.requestedSeed !== undefined) hello.seed = this.requestedSeed;
    if (resume && this.self.id && this.token) hello.resume = { id: this.self.id, token: this.token };
    this.transport.send(hello);
  }

  private ctx(entity: string): ReducerContext {
    return { playerId: this.self.id, entity, t: this.serverNow() };
  }

  /** Displayed state = authoritative state with all still-pending local actions replayed on top. */
  private recompute(entity: string): void {
    let s: Readonly<EntityState> | undefined = this.confirmed.get(entity);
    for (const pa of this.pending) {
      if (pa.entity !== entity) continue;
      const next = this.world.rules.reduce(entity, s, pa.op, pa.data, this.ctx(entity));
      if (next) s = next;
    }
    this.world.applyAuthoritative(entity, s);
  }

  private failPending(): void {
    if (!this.pending.length) return;
    const list = this.pending;
    this.pending = [];
    const touched = new Set<string>();
    for (const pa of list) {
      clearTimeout(pa.timer);
      touched.add(pa.entity);
    }
    for (const id of touched) this.recompute(id);
    for (const pa of list) pa.resolve(false);
  }

  private scheduleDeclareFlush(): void {
    if (this.declareScheduled || !this.declareQueue.size) return;
    this.declareScheduled = true;
    queueMicrotask(() => {
      this.declareScheduled = false;
      this.flushDeclares();
    });
  }

  /** Sends queued declarations now (batched). Must precede any action so the host knows the defaults. */
  private flushDeclares(): void {
    if (!this.joined || !this.declareQueue.size) return; // re-sent after the next welcome
    let batch: Record<string, EntityState> = {};
    let n = 0;
    for (const [id, st] of this.declareQueue) {
      batch[id] = st;
      if (++n === MAX_DECLARE_BATCH) {
        this.transport.send({ type: 'declare', entities: batch });
        batch = {};
        n = 0;
      }
    }
    if (n) this.transport.send({ type: 'declare', entities: batch });
    this.declareQueue.clear();
  }

  private trackLateness(late: number): void {
    if (!(late > -500 && late < 1000)) return; // stale idle poses from the welcome burst etc.
    if (!this.lateInit) {
      this.lateEma = late;
      this.lateDev = 10;
      this.lateInit = true;
    } else {
      this.lateEma += (late - this.lateEma) * 0.08;
      this.lateDev += (Math.abs(late - this.lateEma) - this.lateDev) * 0.08;
    }
    this.delayTarget = clamp(this.lateEma + 2.5 * this.lateDev + 500 / this.tickRate, this.opts.interpolationDelay, this.opts.maxInterpolationDelay);
  }
}
