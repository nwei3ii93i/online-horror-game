/** Small IndexedDB cache for generated texture data, so the world only synthesises once. */
const DB_NAME = 'waldegg-texcache';
const STORE = 'tex';

export interface CachedTex { size: number; a: Uint8Array; b: Uint8Array; alphaMode: string }

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export class TextureCache {
  private db: Promise<IDBDatabase | null> = open();

  async get(key: string): Promise<CachedTex | null> {
    const db = await this.db;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = () => resolve((r.result as CachedTex) ?? null);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async put(key: string, value: CachedTex): Promise<void> {
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }

  async clear(): Promise<void> {
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
