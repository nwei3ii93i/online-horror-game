/**
 * Replicated world state: entity id → small immutable JSON object.
 *
 * Used in three places with the same code:
 *  - HostCore (authoritative store; in-process for solo, inside the Node relay for multiplayer),
 *  - Session (the client's *displayed* world = authoritative + optimistic predictions),
 *  - reducers run against it for validation / prediction.
 *
 * Entity ids are `<type>:<name>`, e.g. `door:manor_front`, `item:cellar_key`, `light:hall`.
 * Stored states are deep-frozen; never mutate what `get()` returns.
 *
 * No DOM / three.js / Node imports: the server imports this file.
 */

import type { EntityState } from './protocol';
import { defaultRegistry, ReducerRegistry, type Reducer, type ReducerContext } from './reducers';
import { deepEqual, deepFreeze, jsonClone } from './util';

export { ReducerRegistry, defaultRegistry, registerReducer, registerDefaultReducers } from './reducers';
export type { Reducer, ReducerContext } from './reducers';

/** Called after an entity's state changed. `state` is undefined when the entity was removed. */
export type WorldListener = (id: string, state: Readonly<EntityState> | undefined, prev: Readonly<EntityState> | undefined) => void;

export interface ApplyResult {
  /** The reducer accepted the action. */
  ok: boolean;
  /** The accepted action actually changed the stored state. */
  changed: boolean;
  /** State after the action (the unchanged current state when rejected). */
  state: Readonly<EntityState> | undefined;
  prev: Readonly<EntityState> | undefined;
}

const EMPTY: EntityState = Object.freeze({}) as EntityState;

export class WorldState {
  private states = new Map<string, Readonly<EntityState>>();
  private listeners: { fn: WorldListener; prefix: string }[] = [];

  constructor(readonly rules: ReducerRegistry = defaultRegistry, initial?: Record<string, EntityState>) {
    if (initial) for (const [id, s] of Object.entries(initial)) this.states.set(id, deepFreeze(jsonClone(s)));
  }

  get size(): number {
    return this.states.size;
  }

  has(id: string): boolean {
    return this.states.has(id);
  }

  /** Current state (frozen) or undefined if the entity has never been declared / changed. */
  get(id: string): Readonly<EntityState> | undefined {
    return this.states.get(id);
  }

  ids(): IterableIterator<string> {
    return this.states.keys();
  }

  entries(): IterableIterator<[string, Readonly<EntityState>]> {
    return this.states.entries();
  }

  /** Detached, mutable deep copy of the whole world (JSON-serialisable). */
  snapshot(): Record<string, EntityState> {
    const out: Record<string, EntityState> = {};
    for (const [id, s] of this.states) out[id] = jsonClone(s) as EntityState;
    return out;
  }

  /** Replaces the whole world with a snapshot, notifying listeners about every difference. */
  load(snapshot: Record<string, EntityState>): void {
    for (const id of [...this.states.keys()]) if (!(id in snapshot)) this.applyAuthoritative(id, undefined);
    for (const [id, s] of Object.entries(snapshot)) this.applyAuthoritative(id, s);
  }

  /**
   * Sets an entity's state as-is (no reducer), e.g. from a host message.
   * `undefined`/`null` removes it. Returns true and notifies subscribers if it changed.
   */
  applyAuthoritative(id: string, state: Readonly<EntityState> | undefined | null): boolean {
    const prev = this.states.get(id);
    if (state === undefined || state === null) {
      if (prev === undefined) return false;
      this.states.delete(id);
      this.notify(id, undefined, prev);
      return true;
    }
    if (prev !== undefined && deepEqual(prev, state)) return false;
    const next = deepFreeze(jsonClone(state) as EntityState);
    this.states.set(id, next);
    this.notify(id, next, prev);
    return true;
  }

  /** Sets a default state only if the entity is unknown. Returns true if it was added. */
  declare(id: string, state: EntityState): boolean {
    if (this.states.has(id)) return false;
    return this.applyAuthoritative(id, state);
  }

  /** Pure: what would `op` do to `id` right now? Null if the rules reject it. Does not modify the world. */
  reduce(id: string, op: string, data: unknown, ctx: ReducerContext): EntityState | null {
    return this.rules.reduce(id, this.states.get(id), op, data, ctx);
  }

  /** Runs the rules and stores the result if accepted (authoritative use: the hosts). */
  apply(id: string, op: string, data: unknown, ctx: ReducerContext): ApplyResult {
    const prev = this.states.get(id);
    const next = this.rules.reduce(id, prev, op, data, ctx);
    if (next === null) return { ok: false, changed: false, state: prev, prev };
    // an absent entity and an empty object both mean "default state"
    if (deepEqual(prev ?? EMPTY, next)) return { ok: true, changed: false, state: prev, prev };
    this.applyAuthoritative(id, next);
    return { ok: true, changed: true, state: this.states.get(id), prev };
  }

  /**
   * Subscribes to state changes, optionally only for ids starting with `prefix`
   * (e.g. `'door:'`). Returns an unsubscribe function.
   */
  subscribe(fn: WorldListener, prefix = ''): () => void {
    const entry = { fn, prefix };
    this.listeners.push(entry);
    return () => {
      const i = this.listeners.indexOf(entry);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Registers a reducer on this world's rule registry (the shared default registry unless one was passed). */
  registerReducer(prefix: string, reducer: Reducer): () => void {
    return this.rules.register(prefix, reducer);
  }

  private notify(id: string, state: Readonly<EntityState> | undefined, prev: Readonly<EntityState> | undefined): void {
    for (const { fn, prefix } of [...this.listeners]) {
      if (prefix && !id.startsWith(prefix)) continue;
      try {
        fn(id, state, prev);
      } catch (err) {
        console.error('[WorldState] listener failed for', id, err);
      }
    }
  }
}
