type Handler<T> = (payload: T) => void;

/** Minimal strongly-typed event bus. */
export class EventBus<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Set<Handler<any>>>();
  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }
}
