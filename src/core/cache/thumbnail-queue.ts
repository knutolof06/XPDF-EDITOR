/**
 * Generic Render Queue
 * Limits concurrent PDF.js renders to avoid overwhelming the worker.
 */

type RenderTask = () => Promise<void>;

interface QueueEntry {
  task: RenderTask;
  cancelled: boolean;
  cancel: () => void;
  priority: number;
}

function createQueue(maxConcurrent: number) {
  let running = 0;
  const queue: QueueEntry[] = [];

  function runNext() {
    while (running < maxConcurrent && queue.length > 0) {
      queue.sort((a, b) => a.priority - b.priority);
      const entry = queue.shift();
      if (!entry) break;
      if (entry.cancelled) { runNext(); return; }
      running++;
      entry.task().finally(() => { running--; runNext(); });
    }
  }

  function enqueue(task: RenderTask, priority = 9999): () => void {
    const entry: QueueEntry = {
      task, cancelled: false, priority,
      cancel: () => { entry.cancelled = true; },
    };
    queue.push(entry);
    runNext();
    return entry.cancel;
  }

  function clear() {
    queue.forEach(e => (e.cancelled = true));
    queue.length = 0;
  }

  return { enqueue, clear };
}

// Thumbnail queue: max 2 concurrent (sidebar + page manager)
const thumbnailQ = createQueue(2);
export const enqueueThumbnail = thumbnailQ.enqueue;
export const clearThumbnailQueue = thumbnailQ.clear;

// Main page render queue: max 3 concurrent (viewer scroll)
const pageQ = createQueue(3);
export const enqueuePageRender = pageQ.enqueue;
export const clearPageRenderQueue = pageQ.clear;
