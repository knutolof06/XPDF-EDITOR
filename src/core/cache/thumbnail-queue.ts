/**
 * High-Performance Forward-Prioritized Render Queue (FIFO / Page Index Order)
 * - Prioritizes earliest pages first (Page 1 -> Page 2 -> Page 3...).
 * - Concurrency: 4 parallel workers for ultra-fast thumbnail loading.
 * - Yields to main thread between tasks to maintain smooth 60 FPS UI.
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
      // Sort ascending: lowest priority (earliest pages: Page 0, 1, 2...) run first!
      queue.sort((a, b) => a.priority - b.priority);
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

// 4 concurrent workers for fast thumbnail rendering in forward order
const thumbnailQ = createQueue(4);
export const enqueueThumbnail = thumbnailQ.enqueue;
export const clearThumbnailQueue = thumbnailQ.clear;

const pageQ = createQueue(2);
export const enqueuePageRender = pageQ.enqueue;
export const clearPageRenderQueue = pageQ.clear;
