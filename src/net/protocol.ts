/**
 * Wire protocol shared by the browser client, the in-process solo host and the Node relay.
 *
 * Every message is a plain JSON object with a `type` discriminator. Messages are
 * versioned via {@link PROTOCOL_VERSION}; the host rejects a `hello` from a different
 * version. Floats are quantised before sending (positions to millimetres, angles to
 * milliradians) to keep the JSON compact.
 *
 * This module must stay free of DOM, three.js and Node imports: the server imports it.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;
export const DEFAULT_SEED = 1987;
/** Hard cap of players per room (connected + reconnect-pending). */
export const MAX_PLAYERS = 6;
/** Host snapshot broadcast rate (Hz). */
export const TICK_RATE = 20;
/** Client state upload rate (Hz). */
export const STATE_RATE = 20;
/** Max horizontal speed (m/s) the host accepts between two state samples. */
export const MAX_HORIZONTAL_SPEED = 15;
/** Max vertical speed (m/s) the host accepts (falls are faster than running). */
export const MAX_VERTICAL_SPEED = 40;
/** Max serialized size (chars) of a single entity state / action payload. */
export const MAX_STATE_JSON = 2048;
export const MAX_ACTION_DATA_JSON = 1024;
/** Max number of entities a room's world may hold. */
export const MAX_ENTITIES = 8192;
/** Max entities per `declare` message (clients chunk larger batches). */
export const MAX_DECLARE_BATCH = 256;

/** WebSocket close codes used by the host / server. 4000-4003 are fatal (no reconnect). */
export const CloseCode = {
  ProtocolMismatch: 4000,
  RoomFull: 4001,
  Kicked: 4002,
  BadRoom: 4003,
  Replaced: 4004,
  HelloTimeout: 4005,
  ServerFull: 4006,
  ServerShutdown: 1001,
} as const;

/** Close codes after which a client must not try to reconnect. */
export const FATAL_CLOSE_CODES: readonly number[] = [
  CloseCode.ProtocolMismatch, CloseCode.RoomFull, CloseCode.Kicked, CloseCode.BadRoom, CloseCode.Replaced, CloseCode.ServerFull,
];

// ---------------------------------------------------------------------------------------
// Basic types
// ---------------------------------------------------------------------------------------

export type Vec3 = [number, number, number];
export type Stance = 'stand' | 'crouch' | 'crawl';
export const STANCES: readonly Stance[] = ['stand', 'crouch', 'crawl'];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Replicated state of one world entity: a small plain JSON object, e.g. `{ open: true, angle: 1.4 }`. */
export interface EntityState { [key: string]: JsonValue }

export interface PlayerInfo {
  id: string;
  name: string;
  /** CSS colour (`#rrggbb`) assigned by the host, unique within the room. */
  color: string;
  /** Host time (ms) the player joined. */
  joinedAt: number;
}

/** Replicated per-player pose. `p` is the feet position (capsule bottom). */
export interface PlayerPose {
  p: Vec3;
  yaw: number;
  pitch: number;
  stance: Stance;
  /** Flashlight on. */
  light: boolean;
  vel: Vec3;
}

/** A pose sample stamped with the sender's sample time in host clock (ms). */
export interface PlayerSnapshot extends PlayerPose {
  id: string;
  t: number;
}

export type LeaveReason = 'left' | 'timeout' | 'kicked';

export type ErrorCode =
  | 'protocol_mismatch'
  | 'room_full'
  | 'bad_room'
  | 'bad_request'
  | 'not_joined'
  | 'rate_limited'
  | 'kicked'
  | 'replaced'
  | 'hello_timeout'
  | 'server_full'
  | 'server_shutdown';

// ---------------------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------------------

export interface HelloMsg {
  type: 'hello';
  protocol: number;
  name: string;
  room: string;
  /** Requested world seed; only honoured by the server when the room is created. */
  seed?: number;
  /** Re-attach to a player slot after a dropped connection (token from `welcome`). */
  resume?: { id: string; token: string };
}

export interface StateMsg extends PlayerPose {
  type: 'state';
  seq: number;
  /** Sample time in (estimated) host clock, ms. */
  t: number;
  /** Intentional teleport (respawn, cutscene): skips the speed check, rate-limited by the host. */
  tp?: boolean;
}

/** Generic world action, e.g. `{ entity: 'door:manor_front', op: 'open', data: { angle: 1.4 } }`. */
export interface ActionMsg {
  type: 'action';
  seq: number;
  entity: string;
  op: string;
  data?: unknown;
}

/** Default states of entities the client knows from the seeded world (first writer wins). */
export interface DeclareMsg {
  type: 'declare';
  entities: Record<string, EntityState>;
}

/** Loud player-made noise others should hear (not footsteps). `v` is volume 0..1. */
export interface SoundMsg {
  type: 'sound';
  id: string;
  p: Vec3;
  v: number;
}

/** `t` is the sender's monotonic clock (`performance.now()`), echoed back in `pong`. */
export interface PingMsg {
  type: 'ping';
  t: number;
}

/** Orderly leave (no reconnect grace period). */
export interface ByeMsg {
  type: 'bye';
}

export type ClientMessage = HelloMsg | StateMsg | ActionMsg | DeclareMsg | SoundMsg | PingMsg | ByeMsg;

// ---------------------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------------------

export interface WelcomeMsg {
  type: 'welcome';
  protocol: number;
  you: PlayerInfo;
  /** Secret for `hello.resume` after a dropped connection. */
  token: string;
  room: string;
  seed: number;
  /** The other players in the room (not including `you`). */
  players: PlayerInfo[];
  /** Full authoritative world snapshot. */
  world: Record<string, EntityState>;
  serverTime: number;
  tickRate: number;
  resumed: boolean;
}

export interface JoinedMsg { type: 'joined'; player: PlayerInfo }
export interface LeftMsg { type: 'left'; id: string; reason: LeaveReason }

/** Batched pose snapshots of other players (only players with new samples). */
export interface StatesMsg {
  type: 'states';
  t: number;
  players: PlayerSnapshot[];
}

/** Authoritative entity update caused by `by` (a player id, or `'host'`). */
export interface EntityMsg {
  type: 'entity';
  entity: string;
  state: EntityState;
  by: string;
  t: number;
}

/** Batched authoritative entity states (new declarations, corrections). */
export interface EntitiesMsg {
  type: 'entities';
  states: Record<string, EntityState>;
  by: string;
  t: number;
}

/** Result of the receiver's own action `seq`, with the resulting authoritative state. */
export interface AckMsg {
  type: 'ack';
  seq: number;
  ok: boolean;
  entity: string;
  state?: EntityState;
  reason?: string;
}

export interface RelayedSoundMsg {
  type: 'sound';
  id: string;
  p: Vec3;
  v: number;
  by: string;
}

export interface PongMsg { type: 'pong'; t: number; serverTime: number }

export interface ErrorMsg {
  type: 'error';
  code: ErrorCode;
  message: string;
  /** The host closes the connection after a fatal error. */
  fatal: boolean;
}

export type ServerMessage =
  | WelcomeMsg | JoinedMsg | LeftMsg | StatesMsg | EntityMsg | EntitiesMsg | AckMsg | RelayedSoundMsg | PongMsg | ErrorMsg;

// ---------------------------------------------------------------------------------------
// Quantisation helpers
// ---------------------------------------------------------------------------------------

/** Round to 1/1000 (mm for metres, mrad for radians). */
export const q3 = (n: number): number => Math.round(n * 1000) / 1000;
/** Round to 1/100 (velocities). */
export const q2 = (n: number): number => Math.round(n * 100) / 100;
export const qv3 = (v: readonly number[]): Vec3 => [q3(v[0]), q3(v[1]), q3(v[2])];

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------
// Validation (host side treats all client input as hostile)
// ---------------------------------------------------------------------------------------

const ENTITY_ID_RE = /^[a-z][a-z0-9_]*:[A-Za-z0-9_.:\-/#]{1,96}$/;
const OP_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const SOUND_ID_RE = /^[A-Za-z0-9_.:\-/]{1,48}$/;
const ROOM_RE = /^[A-Z0-9_-]{1,32}$/;
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isVec3(v: unknown, limit = 1e5): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => isFiniteNumber(n) && Math.abs(n) <= limit);
}

export const isEntityId = (s: unknown): s is string => typeof s === 'string' && s.length <= 128 && ENTITY_ID_RE.test(s);
export const isOpName = (s: unknown): s is string => typeof s === 'string' && OP_RE.test(s);
export const isSoundId = (s: unknown): s is string => typeof s === 'string' && SOUND_ID_RE.test(s);

/** Upper-cases and validates a room code; returns null if invalid. */
export function normalizeRoom(room: unknown): string | null {
  if (typeof room !== 'string') return null;
  const r = room.trim().toUpperCase();
  return ROOM_RE.test(r) ? r : null;
}

/** Strips control characters, trims and caps the display name. */
export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'Wanderer';
  // drop control characters, zero-width and bidi-override code points
  const isBad = (c: number): boolean => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e);
  const n = [...name].filter((ch) => !isBad(ch.codePointAt(0) ?? 0)).join('').replace(/\s+/g, ' ').trim().slice(0, 24);
  return n || 'Wanderer';
}

/** JSON length of a value, or -1 if it is not serialisable. */
export function jsonLength(v: unknown): number {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s.length : -1;
  } catch {
    return -1;
  }
}

/**
 * Converts an arbitrary value to a detached, JSON-safe EntityState (plain object), or
 * null when it is not a plain object, not serialisable or larger than `maxJson`.
 */
export function toEntityState(v: unknown, maxJson = MAX_STATE_JSON): EntityState | null {
  if (!isRecord(v)) return null;
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    return null;
  }
  if (typeof s !== 'string' || s.length > maxJson) return null;
  const out: unknown = JSON.parse(s);
  return isRecord(out) ? (out as EntityState) : null;
}

function parsePose(m: Record<string, unknown>): PlayerPose | null {
  if (!isVec3(m.p) || !isFiniteNumber(m.yaw) || !isFiniteNumber(m.pitch)) return null;
  if (typeof m.stance !== 'string' || !(STANCES as readonly string[]).includes(m.stance)) return null;
  if (typeof m.light !== 'boolean') return null;
  const vel: Vec3 = isVec3(m.vel, 1e3) ? m.vel : [0, 0, 0];
  return {
    p: qv3(m.p),
    yaw: q3(wrapAngle(m.yaw)),
    pitch: q3(clamp(m.pitch, -1.6, 1.6)),
    stance: m.stance as Stance,
    light: m.light,
    vel: [q2(clamp(vel[0], -60, 60)), q2(clamp(vel[1], -60, 60)), q2(clamp(vel[2], -60, 60))],
  };
}

/**
 * Validates and normalises an untrusted client message (already JSON-decoded).
 * Returns a fresh object containing only known, sanitised fields, or null if invalid.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'hello': {
      if (!isFiniteNumber(raw.protocol) || typeof raw.room !== 'string' || raw.room.length > 64) return null;
      const msg: HelloMsg = { type: 'hello', protocol: raw.protocol, name: sanitizeName(raw.name), room: raw.room };
      if (isFiniteNumber(raw.seed)) msg.seed = Math.floor(raw.seed) >>> 0;
      const r = raw.resume;
      if (isRecord(r) && typeof r.id === 'string' && PLAYER_ID_RE.test(r.id) && typeof r.token === 'string' && r.token.length <= 64) {
        msg.resume = { id: r.id, token: r.token };
      }
      return msg;
    }
    case 'state': {
      if (!isFiniteNumber(raw.seq) || !isFiniteNumber(raw.t)) return null;
      const pose = parsePose(raw);
      if (!pose) return null;
      const msg: StateMsg = { type: 'state', seq: raw.seq, t: raw.t, ...pose };
      if (raw.tp === true) msg.tp = true;
      return msg;
    }
    case 'action': {
      if (!isFiniteNumber(raw.seq) || !isEntityId(raw.entity) || !isOpName(raw.op)) return null;
      const msg: ActionMsg = { type: 'action', seq: raw.seq, entity: raw.entity, op: raw.op };
      if (raw.data !== undefined) {
        const len = jsonLength(raw.data);
        if (len < 0 || len > MAX_ACTION_DATA_JSON) return null;
        msg.data = JSON.parse(JSON.stringify(raw.data)) as unknown;
      }
      return msg;
    }
    case 'declare': {
      if (!isRecord(raw.entities)) return null;
      const entities: Record<string, EntityState> = {};
      let n = 0;
      for (const [id, st] of Object.entries(raw.entities)) {
        if (++n > MAX_DECLARE_BATCH) break;
        if (!isEntityId(id)) continue;
        const s = toEntityState(st);
        if (s) entities[id] = s;
      }
      return { type: 'declare', entities };
    }
    case 'sound': {
      if (!isSoundId(raw.id) || !isVec3(raw.p) || !isFiniteNumber(raw.v)) return null;
      return { type: 'sound', id: raw.id, p: qv3(raw.p), v: q3(clamp(raw.v, 0, 1)) };
    }
    case 'ping':
      return isFiniteNumber(raw.t) ? { type: 'ping', t: raw.t } : null;
    case 'bye':
      return { type: 'bye' };
    default:
      return null;
  }
}

const SERVER_TYPES = new Set<string>(['welcome', 'joined', 'left', 'states', 'entity', 'entities', 'ack', 'sound', 'pong', 'error']);

/** Light structural check of a server message (the server is trusted). */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !SERVER_TYPES.has(raw.type)) return null;
  return raw as unknown as ServerMessage;
}
