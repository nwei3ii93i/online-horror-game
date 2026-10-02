/** Minimal strongly-typed event emitter (no DOM dependency). */
export class Emitter<M extends object> {
  private map = new Map<keyof M, Set<(payload: never) => void>>();

  /** Subscribes; returns an unsubscribe function. */
  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as (payload: never) => void);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: (payload: M[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof M>(type: K, fn: (payload: M[K]) => void): void {
    this.map.get(type)?.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (payload: M[K]) => void)(payload);
      } catch (err) {
        console.error(`[net] '${String(type)}' listener failed`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
