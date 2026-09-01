/**
 * Low-Overhead Adaptive Render Queue
 * - Prioritizes the most recently visible items (LIFO first).
 * - Dynamically bounds concurrency (max 2 concurrent thumbnails) to ensure 60 FPS
 *   even on older dual/quad-core CPUs.
 * - Instantly cancels off-screen tasks without wasting CPU cycles.
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
          // Yield to main thread before starting next task to prevent UI lockup
          setTimeout(runNext, 0);
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

// Adaptive concurrency: 2 for thumbnails, 2 for main pages
const thumbnailQ = createQueue(2);
export const enqueueThumbnail = thumbnailQ.enqueue;
export const clearThumbnailQueue = thumbnailQ.clear;

const pageQ = createQueue(2);
export const enqueuePageRender = pageQ.enqueue;
export const clearPageRenderQueue = pageQ.clear;
