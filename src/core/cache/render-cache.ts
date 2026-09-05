/**
 * High-Performance In-Memory Render Cache System
 * - O(1) Map-based LRU with touch-on-get() (MRU re-ordering)
 * - Strict ImageBitmap.close() calls on eviction to prevent GPU/VRAM leaks
 * - Quantized scale normalization (%10 buckets) to prevent zoom cache pollution
 * - Dynamic capacity adjustment for continuous/multi-page view modes
 */

export class TrueLRUCache<T> {
  private cache: Map<string, T> = new Map();
  private maxItems: number;
  private onEvict?: (value: T, key: string) => void;

  constructor(maxItems: number = 30, onEvict?: (value: T, key: string) => void) {
    this.maxItems = maxItems;
    this.onEvict = onEvict;
  }

  /**
   * Retrieves an item and promotes it to the Most Recently Used (MRU) position.
   */
  public get(key: string): T | undefined {
    if (!this.cache.has(key)) return undefined;

    const value = this.cache.get(key)!;
    // Touch: delete and re-insert at the end of the Map
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Peek without touching/promoting the key.
   */
  public peek(key: string): T | undefined {
    return this.cache.get(key);
  }

  /**
   * Inserts or updates an item, evicting the Least Recently Used (LRU) entry if full.
   */
  public set(key: string, value: T): void {
    // If key exists, delete first to refresh insertion order
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      if (existing !== value && this.onEvict) {
        try {
          this.onEvict(existing, key);
        } catch {}
      }
      this.cache.delete(key);
    } else {
      // Evict oldest (first key in insertion order) if at or over capacity
      while (this.cache.size >= this.maxItems && this.cache.size > 0) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) {
          const item = this.cache.get(oldestKey);
          if (item && this.onEvict) {
            try {
              this.onEvict(item, oldestKey);
            } catch {}
          }
          this.cache.delete(oldestKey);
        } else {
          break;
        }
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Dynamically adjusts maximum items, immediately evicting excess entries if needed.
   */
  public setMaxItems(newMax: number): void {
    this.maxItems = Math.max(1, newMax);
    while (this.cache.size > this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const item = this.cache.get(oldestKey);
        if (item && this.onEvict) {
          try {
            this.onEvict(item, oldestKey);
          } catch {}
        }
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  public getMaxItems(): number {
    return this.maxItems;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): boolean {
    if (this.cache.has(key)) {
      const item = this.cache.get(key)!;
      if (this.onEvict) {
        try {
          this.onEvict(item, key);
        } catch {}
      }
      return this.cache.delete(key);
    }
    return false;
  }

  public clear(): void {
    if (this.onEvict) {
      for (const [k, v] of this.cache.entries()) {
        try {
          this.onEvict(v, k);
        } catch {}
      }
    }
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  public keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  public entries(): IterableIterator<[string, T]> {
    return this.cache.entries();
  }
}

// Backward-compatibility alias
export const LRUCache = TrueLRUCache;

export interface PageBitmapEntry {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  docId: string;
  pageIndex: number;
}

export interface PageMetadataEntry {
  textContent?: any;
  links?: any[];
  widgets?: any[];
}

/**
 * Normalizes scale into 10% discrete buckets to avoid cache thrashing during smooth zoom.
 * e.g. 1.03 -> 1.0, 1.27 -> 1.3
 */
export function normalizeScale(scale: number): number {
  return Math.round(scale * 10) / 10;
}

export function makePageBitmapKey(
  docId: string,
  pageId: string,
  sourcePageIndex: number,
  rotation: number,
  scale: number
): string {
  const normScale = normalizeScale(scale).toFixed(1);
  return `${docId}_${pageId}_p${sourcePageIndex}_r${rotation}_s${normScale}`;
}

export function makePageMetaKey(
  docId: string,
  pageId: string,
  sourcePageIndex: number,
  rotation: number
): string {
  return `${docId}_${pageId}_p${sourcePageIndex}_r${rotation}`;
}

/**
 * 1. Full Page Bitmap Cache:
 * Bounded to 16 pages default (~120MB VRAM/RAM), dynamically scalable up to 32 pages
 * in continuous/multi-page view modes.
 * Explicitly calls ImageBitmap.close() on eviction to prevent native memory leaks.
 */
export const pageBitmapCache = new TrueLRUCache<PageBitmapEntry>(
  16,
  (entry) => {
    try {
      entry.bitmap.close?.();
    } catch {}
  }
);

/**
 * 2. Thumbnail Cache:
 * Bounded to 250 thumbnails (at 140px width ≈ 110KB each, max ~27MB).
 * Explicitly calls ImageBitmap.close() on eviction.
 */
export const thumbnailCache = new TrueLRUCache<ImageBitmap>(
  250,
  (bmp) => {
    try {
      bmp.close?.();
    } catch {}
  }
);

/**
 * 3. Page Metadata Cache:
 * Lightweight JSON objects (links, form widgets, textContent items).
 */
export const pageMetadataCache = new TrueLRUCache<PageMetadataEntry>(300);

/**
 * Legacy compatibility caches
 */
export const pageRenderCache = new TrueLRUCache<HTMLCanvasElement>(15);
export const pageBlobCache = new Map<string, string>();

/**
 * Adjusts dynamic capacity to prevent thrashing in multi-page/continuous views.
 * Formula: max(16, min(32, ceil(visibleCount * 2)))
 */
export function updateDynamicBitmapCapacity(visibleCount: number): void {
  const capacity = Math.max(16, Math.min(32, Math.ceil(visibleCount * 2)));
  if (pageBitmapCache.getMaxItems() !== capacity) {
    pageBitmapCache.setMaxItems(capacity);
  }
}

/**
 * Safely clears all caches associated with a specific document when closed.
 */
export function clearDocumentCaches(docId: string): void {
  if (!docId) return;

  // Clear matching page bitmaps
  const bitmapKeysToDelete: string[] = [];
  for (const key of pageBitmapCache.keys()) {
    if (key.startsWith(`${docId}_`)) {
      bitmapKeysToDelete.push(key);
    }
  }
  for (const k of bitmapKeysToDelete) {
    pageBitmapCache.delete(k); // Triggers bitmap.close()
  }

  // Clear matching metadata
  const metaKeysToDelete: string[] = [];
  for (const key of pageMetadataCache.keys()) {
    if (key.startsWith(`${docId}_`)) {
      metaKeysToDelete.push(key);
    }
  }
  for (const k of metaKeysToDelete) {
    pageMetadataCache.delete(k);
  }

  // Clear matching thumbnails
  const thumbKeysToDelete: string[] = [];
  for (const key of thumbnailCache.keys()) {
    if (key.includes(docId)) {
      thumbKeysToDelete.push(key);
    }
  }
  for (const k of thumbKeysToDelete) {
    thumbnailCache.delete(k); // Triggers bmp.close()
  }
}
