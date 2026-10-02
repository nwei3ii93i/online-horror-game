/**
 * The gameplay side of replicated world state. Gameplay systems (doors, items, lights)
 * never mutate shared state directly: they call `act()` and react to `subscribe()`.
 * In solo play this is satisfied by a local loopback host; in multiplayer by the
 * network session (see src/net). Both run the same reducers, so behaviour is identical.
 */
export type EntityState = Record<string, unknown>;

export interface WorldBridge {
  /** Declare an entity with its initial state (ignored if the authority already knows it). */
  register(id: string, initial: EntityState): void;
  get(id: string): EntityState | undefined;
  /** Request a change. Applied optimistically; the authority may reject it. */
  act(id: string, op: string, data?: unknown): void;
  subscribe(fn: (id: string, state: EntityState | undefined) => void): () => void;
}

type Reducer = (cur: EntityState | undefined, op: string, data: any) => EntityState | null;

/** Minimal in-process authority used until/unless a network session is attached. */
export class LocalWorldBridge implements WorldBridge {
  private state = new Map<string, EntityState>();
  private subs = new Set<(id: string, s: EntityState | undefined) => void>();
  private reducers: [string, Reducer][] = [
    ['door:', (cur, op, data) => {
      const c = cur ?? {};
      if (op === 'open') return c.locked ? null : { ...c, target: data?.target ?? 1.75 };
      if (op === 'close') return { ...c, target: 0 };
      if (op === 'unlock') return !c.key || c.key === data?.key ? { ...c, locked: false } : null;
      if (op === 'lock') return { ...c, locked: true, target: 0 };
      return null;
    }],
    ['item:', (cur, op) => (op === 'take' ? { ...(cur ?? {}), taken: true } : op === 'drop' ? { ...(cur ?? {}), taken: false } : null)],
    ['light:', (cur, op) => (op === 'toggle' ? { ...(cur ?? {}), on: !(cur?.on ?? false) } : op === 'on' ? { ...(cur ?? {}), on: true } : op === 'off' ? { ...(cur ?? {}), on: false } : null)],
    ['', (cur, op, data) => ({ ...(cur ?? {}), [op]: data ?? true })],
  ];

  register(id: string, initial: EntityState): void {
    if (!this.state.has(id)) this.state.set(id, { ...initial });
  }

  get(id: string): EntityState | undefined { return this.state.get(id); }

  act(id: string, op: string, data?: unknown): void {
    const red = this.reducers.find(([p]) => id.startsWith(p));
    if (!red) return;
    const next = red[1](this.state.get(id), op, data);
    if (!next) return;
    this.state.set(id, next);
    for (const fn of this.subs) fn(id, next);
  }

  subscribe(fn: (id: string, state: EntityState | undefined) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
