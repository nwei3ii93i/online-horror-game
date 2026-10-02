/**
 * World rules: pure reducers keyed by entity-id prefix.
 *
 * A reducer computes the next state of an entity from its current state and an action:
 *
 *     (current, op, data, ctx) => nextState | null      // null = action rejected
 *
 * The exact same reducers run on the authoritative host (the in-process solo host or the
 * Node relay) and on clients for optimistic prediction. Reducers therefore must be:
 *  - pure and deterministic (no Math.random / Date.now – use `ctx.t` if time matters),
 *  - free of DOM / three.js dependencies (the server imports them),
 *  - non-mutating (`current` is frozen; return a new object).
 *
 * Custom game rules: register them in a DOM-free module that is imported both by the game
 * and by `server/server.ts` (see INTEGRATION.md), otherwise the relay will not know them.
 *
 * Ops starting with `$` are host-internal (clients cannot send them because protocol
 * validation requires op names to start with a letter):
 *  - `$release` {p} – the player in `ctx.playerId` left the room; release what they hold.
 */

import { clamp, isFiniteNumber, isRecord, isVec3, qv3, toEntityState, type EntityState } from './protocol';

export interface ReducerContext {
  /** Acting player id (the local player on the client, the sender on the host). */
  playerId: string;
  /** Full entity id the action targets. */
  entity: string;
  /** Host time (ms) of the action (estimated host time when predicting on a client). */
  t: number;
}

export type Reducer = (
  current: Readonly<EntityState> | undefined,
  op: string,
  data: unknown,
  ctx: ReducerContext,
) => EntityState | null;

/** Maps entity-id prefixes (`'door:'`, `'door:*'`, or a full id) to reducers; longest prefix wins. */
export class ReducerRegistry {
  private map = new Map<string, Reducer>();
  /** Optional sink for reducer exceptions (they are treated as rejections). */
  onError: ((entity: string, op: string, err: unknown) => void) | null = null;

  /** Registers (or replaces) the reducer for a prefix. Returns an unregister function. */
  register(prefix: string, reducer: Reducer): () => void {
    const key = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    if (!key) throw new Error('reducer prefix must not be empty');
    this.map.set(key, reducer);
    return () => {
      if (this.map.get(key) === reducer) this.map.delete(key);
    };
  }

  /** The reducer registered for exactly this prefix (for composing / extending rules). */
  get(prefix: string): Reducer | undefined {
    return this.map.get(prefix.endsWith('*') ? prefix.slice(0, -1) : prefix);
  }

  /** The reducer responsible for an entity id (longest matching prefix). */
  resolve(entity: string): Reducer | undefined {
    let best: Reducer | undefined;
    let bestLen = -1;
    for (const [prefix, r] of this.map) {
      if (prefix.length > bestLen && entity.startsWith(prefix)) {
        best = r;
        bestLen = prefix.length;
      }
    }
    return best;
  }

  prefixes(): string[] {
    return [...this.map.keys()];
  }

  /**
   * Runs the reducer for `entity` without touching any store. Returns the next state
   * (detached, JSON-safe) or null when rejected / unknown entity type / invalid result.
   */
  reduce(entity: string, current: Readonly<EntityState> | undefined, op: string, data: unknown, ctx: ReducerContext): EntityState | null {
    const r = this.resolve(entity);
    if (!r) return null;
    let next: EntityState | null;
    try {
      next = r(current, op, data, ctx);
    } catch (err) {
      this.onError?.(entity, op, err);
      return null;
    }
    return next === null ? null : toEntityState(next);
  }
}

/** Registry used by default by every WorldState (client prediction and the hosts). */
export const defaultRegistry = new ReducerRegistry();

/** Registers a reducer on the default registry: `registerReducer('door:', (cur, op, data, ctx) => ...)`. */
export function registerReducer(prefix: string, reducer: Reducer): () => void {
  return defaultRegistry.register(prefix, reducer);
}

// ---------------------------------------------------------------------------------------
// Default rules
// ---------------------------------------------------------------------------------------

/** Default swing angle (rad) when a door is opened without an explicit angle. */
export const DEFAULT_DOOR_ANGLE = 1.4;

const dataOf = (data: unknown): Record<string, unknown> => (isRecord(data) ? data : {});
const without = (s: Record<string, unknown>, ...keys: string[]): EntityState => {
  const o: Record<string, unknown> = { ...s };
  for (const k of keys) delete o[k];
  return o as EntityState;
};

/**
 * `door:*` – state `{ open, angle, locked, key? }`.
 *  - open {angle?}  rejected while locked; angle clamped to ±3.2 rad (default 1.4)
 *  - close          always allowed
 *  - toggle {angle?} open ↔ close (open rejected while locked)
 *  - lock {key?}    only when closed; if the door has a `key` requirement, `data.key` must match
 *  - unlock {key?}  if the door has a `key` requirement, `data.key` must match
 * Declare `{ locked: true, key: 'cellar_key' }` for doors that need a key.
 */
export const doorReducer: Reducer = (cur, op, data) => {
  const s: EntityState = { open: false, angle: 0, locked: false, ...cur };
  const d = dataOf(data);
  const keyOk = typeof s.key !== 'string' || d.key === s.key;
  const open = (): EntityState | null =>
    s.locked === true ? null : { ...s, open: true, angle: clamp(isFiniteNumber(d.angle) ? d.angle : DEFAULT_DOOR_ANGLE, -3.2, 3.2) };
  switch (op) {
    case 'open':
      return open();
    case 'close':
      return { ...s, open: false, angle: 0 };
    case 'toggle':
      return s.open === true ? { ...s, open: false, angle: 0 } : open();
    case 'lock':
      if (s.open === true || !keyOk) return null;
      return { ...s, locked: true };
    case 'unlock':
      if (!keyOk) return null;
      return { ...s, locked: false };
    default:
      return null;
  }
};

/**
 * `item:*` – state `{ taken, by?, p? }`.
 *  - take        rejected if somebody holds it; sets `by` to the taker
 *  - drop {p}    only by the holder; `p` = world position [x,y,z]
 *  - $release {p} (host) holder left the room: dropped at their last position
 */
export const itemReducer: Reducer = (cur, op, data, ctx) => {
  const s: EntityState = { taken: false, ...cur };
  const d = dataOf(data);
  switch (op) {
    case 'take':
      if (s.taken === true) return null;
      return { ...without(s, 'p'), taken: true, by: ctx.playerId };
    case 'drop':
      if (s.taken !== true || s.by !== ctx.playerId || !isVec3(d.p)) return null;
      return { ...without(s, 'by'), taken: false, p: qv3(d.p) };
    case '$release':
      if (s.taken !== true || s.by !== ctx.playerId) return null;
      return isVec3(d.p) ? { ...without(s, 'by'), taken: false, p: qv3(d.p) } : { ...without(s, 'by'), taken: false };
    default:
      return null;
  }
};

/** `light:*` – state `{ on }`; ops on / off / toggle. */
export const lightReducer: Reducer = (cur, op) => {
  const s: EntityState = { on: false, ...cur };
  switch (op) {
    case 'on': return { ...s, on: true };
    case 'off': return { ...s, on: false };
    case 'toggle': return { ...s, on: s.on !== true };
    default: return null;
  }
};

/** `note:*` – `read` is always allowed and changes nothing (useful as a replicated "event"). */
export const noteReducer: Reducer = (cur, op) => (op === 'read' ? { ...cur } : null);

/** `switch:*` – state `{ on }`; ops toggle (and on / off). */
export const switchReducer: Reducer = lightReducer;

/** Registers the built-in door / item / light / note / switch rules on a registry. */
export function registerDefaultReducers(registry: ReducerRegistry = defaultRegistry): void {
  registry.register('door:', doorReducer);
  registry.register('item:', itemReducer);
  registry.register('light:', lightReducer);
  registry.register('note:', noteReducer);
  registry.register('switch:', switchReducer);
}

registerDefaultReducers(defaultRegistry);
