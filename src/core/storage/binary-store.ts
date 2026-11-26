/**
 * BinaryStore: Holds raw ArrayBuffers in memory outside of React / Zustand state.
 * Prevents garbage collection overhead and avoids cloning huge byte arrays in React renders.
 * Also retains WeakMap proxy->buffer associations so in-place snapshot undo/redo
 * can restore the exact PDF binary associated with a PDFDocumentProxy without leaks.
 */
class BinaryStore {
  private buffers: Map<string, ArrayBuffer> = new Map();
  private proxyBuffers: WeakMap<object, ArrayBuffer> = new WeakMap();

  public set(id: string, data: ArrayBuffer): void {
    this.buffers.set(id, data);
  }

  public get(id: string): ArrayBuffer | undefined {
    return this.buffers.get(id);
  }

  public has(id: string): boolean {
    return this.buffers.has(id);
  }

  public remove(id: string): void {
    this.buffers.delete(id);
  }

  public delete(id: string): boolean {
    return this.buffers.delete(id);
  }

  public associateProxy(proxy: object | null | undefined, data: ArrayBuffer): void {
    if (proxy && typeof proxy === 'object') {
      this.proxyBuffers.set(proxy, data.slice(0));
    }
  }

  public getForProxy(proxy: object | null | undefined): ArrayBuffer | undefined {
    if (!proxy || typeof proxy !== 'object') return undefined;
    return this.proxyBuffers.get(proxy);
  }

  public keys(): string[] {
    return Array.from(this.buffers.keys());
  }

  public size(): number {
    return this.buffers.size;
  }

  public clear(): void {
    this.buffers.clear();
    this.proxyBuffers = new WeakMap();
  }
}

export const binaryStore = new BinaryStore();
