interface CacheEntry<T> {
  value: T;
  lastUsed: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxItems: number;

  constructor(maxItems: number = 30) {
    this.maxItems = maxItems;
  }

  public get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    entry.lastUsed = Date.now();
    return entry.value;
  }

  public set(key: string, value: T): void {
    if (this.cache.size >= this.maxItems) {
      // Evict least recently used entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.cache.entries()) {
        if (v.lastUsed < oldestTime) {
          oldestTime = v.lastUsed;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, lastUsed: Date.now() });
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

// Global caches
export const pageRenderCache = new LRUCache<HTMLCanvasElement>(15);
export const thumbnailCache = new LRUCache<string>(100);
export const pageBlobCache = new Map<string, string>();
