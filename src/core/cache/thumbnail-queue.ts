/**
 * High-Performance Render Queue
 * - Prioritizes the most recently visible items (newest timestamp / LIFO first).
 * - Allows 6 concurrent thumbnail renders (fast parallel worker batching).
 * - Allows 4 concurrent main page renders.
 * - Instantly drops cancelled tasks without blocking the queue.
 */

type RenderTask = () => Promise<void>;

interface QueueEntry {
  task: RenderTask;
  cancelled: boolean;
  cancel: () => void;
  priority: number;
}

let globalSeq = 0;

function createQueue(maxConcurrent: number) {
  let running = 0;
  const queue: QueueEntry[] = [];

  function runNext() {
    while (running < maxConcurrent && queue.length > 0) {
      // Sort descending: highest priority (most recently visible item) runs first!
      queue.sort((a, b) => b.priority - a.priority);
      const entry = queue.shift();
      if (!entry) break;
      if (entry.cancelled) {
        continue;
      }
      running++;
      entry
        .task()
        .catch(() => {})
        .finally(() => {
          running--;
          runNext();
        });
    }
  }

  function enqueue(task: RenderTask, priority?: number): () => void {
    const p = priority !== undefined ? priority : ++globalSeq;
    const entry: QueueEntry = {
      task,
      cancelled: false,
      priority: p,
      cancel: () => {
        entry.cancelled = true;
      },
    };
    queue.push(entry);
    runNext();
    return entry.cancel;
  }

  function clear() {
    for (const e of queue) {
      e.cancelled = true;
    }
    queue.length = 0;
  }

  return { enqueue, clear };
}

// 6 concurrent thumbnails for sidebar & page manager grid
const thumbnailQ = createQueue(6);
export const enqueueThumbnail = thumbnailQ.enqueue;
export const clearThumbnailQueue = thumbnailQ.clear;

// 4 concurrent page renders for main viewer
const pageQ = createQueue(4);
export const enqueuePageRender = pageQ.enqueue;
export const clearPageRenderQueue = pageQ.clear;

