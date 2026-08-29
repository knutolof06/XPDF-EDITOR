/**
 * BinaryStore: Holds raw ArrayBuffers in memory outside of React / Zustand state.
 * Prevents garbage collection overhead and avoids cloning huge byte arrays in React renders.
 * (Rule 16)
 */
class BinaryStore {
  private buffers: Map<string, ArrayBuffer> = new Map();

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

  public clear(): void {
    this.buffers.clear();
  }
}

export const binaryStore = new BinaryStore();
