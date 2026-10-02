/**
 * Authoritative room logic, transport-agnostic.
 *
 * The same class runs
 *  - in the browser, inside {@link LocalTransport} (solo: one player, zero latency), and
 *  - in Node, one instance per room inside `server/server.ts` (multiplayer relay).
 *
 * Responsibilities: join / leave / reconnect-resume (max 6 per room), id + colour
 * assignment, validation and rate limiting of all client input, applying world actions
 * through the shared reducers, relaying sounds and broadcasting pose snapshots at a
 * fixed rate.
 *
 * Transports plug in through {@link HostCore.connect}: they hand over a
 * {@link HostConnection} (how to send to / close that client) and get back a
 * {@link HostLink} to feed received messages and the disconnect event into.
 *
 * No DOM / three.js / Node imports.
 */

import {
  CloseCode, DEFAULT_SEED, MAX_ENTITIES, MAX_HORIZONTAL_SPEED, MAX_PLAYERS, MAX_VERTICAL_SPEED, PROTOCOL_VERSION, TICK_RATE,
  parseClientMessage,
  type ActionMsg, type DeclareMsg, type EntityState, type ErrorCode, type HelloMsg, type LeaveReason, type PlayerInfo,
  type PlayerSnapshot, type ServerMessage, type SoundMsg, type StateMsg,
} from './protocol';
import { defaultRegistry, type ReducerRegistry } from './reducers';
import { WorldState } from './WorldState';
import { TokenBucket, deepEqual, randomToken } from './util';

/** How the host talks to one client. Implemented by each transport. */
export interface HostConnection {
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

/** Returned by {@link HostCore.connect}; the transport feeds it with incoming data. */
export interface HostLink {
  /** Deliver one decoded (JSON.parse'd) message from the client. Untrusted input is fine. */
  receive(raw: unknown): void;
  /**
   * The underlying connection closed. After an orderly `bye` (or `reason === 'bye'`)
   * the player leaves immediately, otherwise the slot is kept for the resume grace period.
   */
  disconnect(reason?: string): void;
  readonly playerId: string | null;
}

export type HostLogger = (level: 'info' | 'warn', msg: string) => void;

export interface HostCoreOptions {
  /** Room code (informational, sent in `welcome`). */
  room?: string;
  seed?: number;
  /** Max players (≤ {@link MAX_PLAYERS}). */
  maxPlayers?: number;
  /** Snapshot broadcast rate (Hz). */
  tickRate?: number;
  /** How long a dropped player's slot is kept for `hello.resume` (ms). 0 = leave immediately. */
  resumeGraceMs?: number;
  /** Clock (ms). Default `performance.now()`. Inject a fake clock for tests. */
  now?: () => number;
  /** Rule registry (default: the shared default registry). */
  registry?: ReducerRegistry;
  initialWorld?: Record<string, EntityState>;
  log?: HostLogger;
  /** Called when the last player slot is released. */
  onEmpty?: () => void;
}

/** Player colours: muted, distinguishable under a torch. */
export const PLAYER_COLORS = ['#c8553d', '#4f86c6', '#6aa86b', '#d9a441', '#9b6fc4', '#4fb3ad'] as const;

/** Time window after which continuously rejected states are accepted again (resync). */
const RESYNC_AFTER_MS = 2500;
/** Minimum interval between client-flagged teleports. */
const TELEPORT_COOLDOWN_MS = 3000;
/** Distance slack per state sample (m) on top of the speed limit. */
const MOVE_SLACK = 0.35;

interface HostPlayer {
  info: PlayerInfo;
  token: string;
  link: LinkImpl | null;
  /** Time the connection dropped (0 while connected). */
  goneAt: number;
  state: PlayerSnapshot | null;
  dirty: boolean;
  /** Next accepted state skips the speed check (first state, after resume). */
  freeMove: boolean;
  rejectSince: number;
  lastTp: number;
}

interface LinkImpl extends HostLink {
  player: HostPlayer | null;
  closed: boolean;
  conn: HostConnection;
  buckets: { all: TokenBucket; state: TokenBucket; action: TokenBucket; sound: TokenBucket; declare: TokenBucket; ping: TokenBucket };
  strikes: number;
}

export interface HostStats {
  messages: number;
  actions: number;
  rejectedActions: number;
  rejectedStates: number;
  droppedMessages: number;
}

export class HostCore {
  readonly room: string;
  readonly seed: number;
  readonly maxPlayers: number;
  readonly tickRate: number;
  readonly resumeGraceMs: number;
  readonly world: WorldState;
  readonly stats: HostStats = { messages: 0, actions: 0, rejectedActions: 0, rejectedStates: 0, droppedMessages: 0 };
  onEmpty: (() => void) | null;

  private players = new Map<string, HostPlayer>();
  private links = new Set<LinkImpl>();
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly log: HostLogger;
  private disposed = false;

  constructor(opts: HostCoreOptions = {}) {
    this.room = opts.room ?? 'SOLO';
    this.seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    this.maxPlayers = Math.max(1, Math.min(MAX_PLAYERS, opts.maxPlayers ?? MAX_PLAYERS));
    this.tickRate = Math.max(1, Math.min(60, opts.tickRate ?? TICK_RATE));
    this.resumeGraceMs = Math.max(0, opts.resumeGraceMs ?? 20000);
    this.now = opts.now ?? (() => performance.now());
    this.log = opts.log ?? (() => {});
    this.onEmpty = opts.onEmpty ?? null;
    this.world = new WorldState(opts.registry ?? defaultRegistry, opts.initialWorld);
  }

  // -------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------

  /** Number of occupied slots (connected + waiting for resume). */
  get playerCount(): number {
    return this.players.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.link) n++;
    return n;
  }

  listPlayers(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({ ...p.info }));
  }

  /** Attach a new client connection. The client must send `hello` first. */
  connect(conn: HostConnection): HostLink {
    const t = this.now();
    const link: LinkImpl = {
      player: null,
      closed: false,
      conn,
      strikes: 0,
      buckets: {
        all: new TokenBucket(120, 240, t),
        state: new TokenBucket(30, 30, t),
        action: new TokenBucket(20, 40, t),
        sound: new TokenBucket(8, 16, t),
        declare: new TokenBucket(10, 64, t),
        ping: new TokenBucket(5, 10, t),
      },
      get playerId() {
        return this.player?.info.id ?? null;
      },
      receive: (raw: unknown) => this.onMessage(link, raw),
      disconnect: (reason?: string) => this.onDisconnect(link, reason ?? 'closed'),
    };
    if (this.disposed) {
      this.sendError(link, 'server_shutdown', 'Room closed', true);
      conn.close(CloseCode.ServerShutdown, 'room closed');
      link.closed = true;
      return link;
    }
    this.links.add(link);
    return link;
  }

  /** Starts the fixed-rate snapshot timer. */
  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.tick(), 1000 / this.tickRate);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One host step: expires dropped players past the grace period and broadcasts new
   * pose samples. Called by the timer from {@link start}, or manually (tests).
   */
  tick(): void {
    const now = this.now();
    for (const p of [...this.players.values()]) {
      if (!p.link && p.goneAt && now - p.goneAt >= this.resumeGraceMs) this.removePlayer(p, 'timeout');
    }
    const fresh: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      if (p.dirty && p.state) {
        fresh.push(p.state);
        p.dirty = false;
      }
    }
    if (!fresh.length) return;
    for (const p of this.players.values()) {
      if (!p.link) continue;
      const others = fresh.filter((s) => s.id !== p.info.id);
      if (others.length) this.send(p.link, { type: 'states', t: now, players: others });
    }
  }

  /** Disconnects everyone and stops the timer. */
  dispose(reason = 'Room closed'): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const link of [...this.links]) {
      this.sendError(link, 'server_shutdown', reason, true);
      this.closeLink(link, CloseCode.ServerShutdown, reason);
    }
    this.links.clear();
    this.players.clear();
  }

  // -------------------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------------------

  private onMessage(link: LinkImpl, raw: unknown): void {
    if (link.closed || this.disposed) return;
    const now = this.now();
    this.stats.messages++;
    if (!link.buckets.all.take(now)) {
      this.stats.droppedMessages++;
      if (++link.strikes > 2000) this.kick(link, 'Flooding');
      return;
    }
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.stats.droppedMessages++;
      if (++link.strikes > 200) this.kick(link, 'Too many malformed messages');
      else if (link.strikes % 20 === 1) this.sendError(link, 'bad_request', 'Malformed message', false);
      return;
    }
    if (msg.type === 'ping') {
      if (link.buckets.ping.take(now)) this.send(link, { type: 'pong', t: msg.t, serverTime: now });
      return;
    }
    if (msg.type === 'hello') {
      this.onHello(link, msg);
      return;
    }
    const player = link.player;
    if (!player) {
      this.sendError(link, 'not_joined', 'Send hello first', false);
      return;
    }
    switch (msg.type) {
      case 'state': return this.onState(player, link, msg);
      case 'action': return this.onAction(player, link, msg);
      case 'declare': return this.onDeclare(player, link, msg);
      case 'sound': return this.onSound(player, link, msg);
      case 'bye': return this.onDisconnect(link, 'bye');
    }
  }

  private onHello(link: LinkImpl, msg: HelloMsg): void {
    if (link.player) {
      this.sendError(link, 'bad_request', 'Already joined', false);
      return;
    }
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.sendError(link, 'protocol_mismatch', `Protocol ${msg.protocol} not supported (host speaks ${PROTOCOL_VERSION})`, true);
      this.closeLink(link, CloseCode.ProtocolMismatch, 'protocol mismatch');
      return;
    }
    const now = this.now();

    // reconnect into an existing slot
    if (msg.resume) {
      const p = this.players.get(msg.resume.id);
      if (p && p.token === msg.resume.token) {
        if (p.link && p.link !== link) {
          const old = p.link;
          old.player = null;
          this.sendError(old, 'replaced', 'Connection replaced by a newer one', true);
          this.closeLink(old, CloseCode.Replaced, 'replaced');
        }
        p.link = link;
        p.goneAt = 0;
        p.freeMove = true;
        p.rejectSince = 0;
        p.info.name = msg.name;
        link.player = p;
        this.sendWelcome(link, p, true);
        this.log('info', `[${this.room}] ${p.info.name} (${p.info.id}) resumed`);
        return;
      }
    }

    if (this.players.size >= this.maxPlayers) {
      this.sendError(link, 'room_full', `Room is full (${this.maxPlayers} players)`, true);
      this.closeLink(link, CloseCode.RoomFull, 'room full');
      return;
    }

    const used = new Set([...this.players.values()].map((p) => p.info.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.nextId % PLAYER_COLORS.length];
    const player: HostPlayer = {
      info: { id: `p${this.nextId++}`, name: msg.name, color, joinedAt: Math.round(now) },
      token: randomToken(16),
      link,
      goneAt: 0,
      state: null,
      dirty: false,
      freeMove: true,
      rejectSince: 0,
      lastTp: -Infinity,
    };
    this.players.set(player.info.id, player);
    link.player = player;
    this.sendWelcome(link, player, false);
    this.broadcast({ type: 'joined', player: { ...player.info } }, player.info.id);
    this.log('info', `[${this.room}] ${player.info.name} (${player.info.id}) joined – ${this.players.size}/${this.maxPlayers}`);
  }

  private sendWelcome(link: LinkImpl, p: HostPlayer, resumed: boolean): void {
    const now = this.now();
    const others = [...this.players.values()].filter((o) => o !== p);
    this.send(link, {
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      you: { ...p.info },
      token: p.token,
      room: this.room,
      seed: this.seed,
      players: others.map((o) => ({ ...o.info })),
      world: this.world.snapshot(),
      serverTime: now,
      tickRate: this.tickRate,
      resumed,
    });
    // let the newcomer see everybody's last pose immediately (idle players send rarely)
    const poses = others.map((o) => o.state).filter((s): s is PlayerSnapshot => s !== null);
    if (poses.length) this.send(link, { type: 'states', t: now, players: poses });
  }

  private onState(p: HostPlayer, link: LinkImpl, msg: StateMsg): void {
    const now = this.now();
    if (!link.buckets.state.take(now)) return;
    const prev = p.state;
    // sample time in host clock: never in the future, never older than 1 s, strictly increasing
    let t = Math.min(msg.t, now);
    t = Math.max(t, now - 1000);
    if (prev) t = Math.max(t, prev.t + 1);
    t = Math.round(t);

    if (prev && !p.freeMove) {
      const dt = Math.max((t - prev.t) / 1000, 0.05);
      const dh = Math.hypot(msg.p[0] - prev.p[0], msg.p[2] - prev.p[2]);
      const dv = Math.abs(msg.p[1] - prev.p[1]);
      if (dh > MAX_HORIZONTAL_SPEED * dt + MOVE_SLACK || dv > MAX_VERTICAL_SPEED * dt + MOVE_SLACK) {
        if (msg.tp && now - p.lastTp >= TELEPORT_COOLDOWN_MS) {
          p.lastTp = now;
        } else if (p.rejectSince && now - p.rejectSince >= RESYNC_AFTER_MS) {
          this.log('warn', `[${this.room}] ${p.info.id} position resync after ${Math.round(now - p.rejectSince)} ms of rejected states`);
        } else {
          if (!p.rejectSince) p.rejectSince = now;
          this.stats.rejectedStates++;
          return;
        }
      }
    }
    p.freeMove = false;
    p.rejectSince = 0;
    p.state = { id: p.info.id, t, p: msg.p, yaw: msg.yaw, pitch: msg.pitch, stance: msg.stance, light: msg.light, vel: msg.vel };
    p.dirty = true;
  }

  private onAction(p: HostPlayer, link: LinkImpl, msg: ActionMsg): void {
    const now = this.now();
    this.stats.actions++;
    const current = this.world.get(msg.entity);
    if (!link.buckets.action.take(now)) {
      this.stats.rejectedActions++;
      this.send(link, { type: 'ack', seq: msg.seq, ok: false, entity: msg.entity, ...(current ? { state: current } : {}), reason: 'rate_limited' });
      return;
    }
    if (!current && this.world.size >= MAX_ENTITIES) {
      this.stats.rejectedActions++;
      this.send(link, { type: 'ack', seq: msg.seq, ok: false, entity: msg.entity, reason: 'world_full' });
      return;
    }
    const res = this.world.apply(msg.entity, msg.op, msg.data, { playerId: p.info.id, entity: msg.entity, t: now });
    if (!res.ok) this.stats.rejectedActions++;
    this.send(link, {
      type: 'ack', seq: msg.seq, ok: res.ok, entity: msg.entity,
      ...(res.state ? { state: res.state as EntityState } : {}),
      ...(res.ok ? {} : { reason: 'rejected' }),
    });
    if (res.ok && res.changed && res.state) {
      this.broadcast({ type: 'entity', entity: msg.entity, state: res.state as EntityState, by: p.info.id, t: now }, p.info.id);
    }
  }

  private onDeclare(p: HostPlayer, link: LinkImpl, msg: DeclareMsg): void {
    const now = this.now();
    if (!link.buckets.declare.take(now)) return;
    const added: Record<string, EntityState> = {};
    const corrections: Record<string, EntityState> = {};
    let nAdded = 0, nCorr = 0;
    for (const [id, state] of Object.entries(msg.entities)) {
      const cur = this.world.get(id);
      if (cur === undefined) {
        if (this.world.size >= MAX_ENTITIES) break;
        this.world.applyAuthoritative(id, state);
        added[id] = state;
        nAdded++;
      } else if (!deepEqual(cur, state)) {
        corrections[id] = cur as EntityState;
        nCorr++;
      }
    }
    if (nAdded) this.broadcast({ type: 'entities', states: added, by: p.info.id, t: now }, p.info.id);
    if (nCorr) this.send(link, { type: 'entities', states: corrections, by: 'host', t: now });
  }

  private onSound(p: HostPlayer, link: LinkImpl, msg: SoundMsg): void {
    if (!link.buckets.sound.take(this.now())) return;
    this.broadcast({ type: 'sound', id: msg.id, p: msg.p, v: msg.v, by: p.info.id }, p.info.id);
  }

  private onDisconnect(link: LinkImpl, reason: string): void {
    if (link.closed && !link.player) {
      this.links.delete(link);
      return;
    }
    const p = link.player;
    link.closed = true;
    link.player = null;
    this.links.delete(link);
    if (!p || p.link !== link) return;
    p.link = null;
    if (reason === 'bye' || reason === 'kicked' || this.resumeGraceMs === 0) {
      this.removePlayer(p, reason === 'kicked' ? 'kicked' : 'left');
      if (reason === 'bye') this.closeLink(link, 1000, 'bye');
    } else {
      p.goneAt = this.now();
      this.log('info', `[${this.room}] ${p.info.name} (${p.info.id}) dropped (${reason}); holding slot ${this.resumeGraceMs} ms`);
    }
  }

  // -------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------

  private removePlayer(p: HostPlayer, reason: LeaveReason): void {
    if (!this.players.delete(p.info.id)) return;
    const id = p.info.id;
    this.broadcast({ type: 'left', id, reason });
    this.log('info', `[${this.room}] ${p.info.name} (${id}) left (${reason}) – ${this.players.size}/${this.maxPlayers}`);
    // release whatever the player was holding (items with `by === id`)
    const now = this.now();
    for (const [eid, st] of [...this.world.entries()]) {
      if (st.by !== id) continue;
      const res = this.world.apply(eid, '$release', { p: p.state?.p }, { playerId: id, entity: eid, t: now });
      if (res.ok && res.changed && res.state) this.broadcast({ type: 'entity', entity: eid, state: res.state as EntityState, by: 'host', t: now });
    }
    if (this.players.size === 0) this.onEmpty?.();
  }

  private kick(link: LinkImpl, why: string): void {
    this.log('warn', `[${this.room}] kicking ${link.playerId ?? 'anonymous'}: ${why}`);
    this.sendError(link, 'kicked', why, true);
    this.closeLink(link, CloseCode.Kicked, why);
    this.onDisconnect(link, 'kicked');
  }

  private closeLink(link: LinkImpl, code: number, reason: string): void {
    link.closed = true;
    try {
      link.conn.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private send(link: LinkImpl, msg: ServerMessage): void {
    if (link.closed) return;
    try {
      link.conn.send(msg);
    } catch (err) {
      this.log('warn', `[${this.room}] send failed: ${(err as Error).message}`);
    }
  }

  private sendError(link: LinkImpl, code: ErrorCode, message: string, fatal: boolean): void {
    this.send(link, { type: 'error', code, message, fatal });
  }

  /** Sends to every connected player except `exceptId`. */
  private broadcast(msg: ServerMessage, exceptId?: string): void {
    for (const p of this.players.values()) {
      if (p.link && p.info.id !== exceptId) this.send(p.link, msg);
    }
  }
}
