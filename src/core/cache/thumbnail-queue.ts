/**
 * High-Performance Forward-Prioritized Render Queue (FIFO / Page Index Order)
 * - Prioritizes earliest pages first (Page 1 -> Page 2 -> Page 3...).
 * - Deduplicates pending tasks when an explicit task key is supplied.
 * - Sorts only when newly dirtied instead of on every dequeue step.
 * - Tracks running tasks so clear() cancels both pending and active entries cleanly.
 */

type RenderTask = () => Promise<void>;

interface QueueEntry {
  task: RenderTask;
  cancelled: boolean;
  cancel: () => void;
  priority: number;
  key?: string;
}

let globalSeq = 0;

function createQueue(maxConcurrent: number) {
  let running = 0;
  let needsSort = false;
  const queue: QueueEntry[] = [];
  const runningEntries = new Set<QueueEntry>();
  const pendingByKey = new Map<string, QueueEntry>();

  function runNext() {
    if (needsSort && queue.length > 1) {
      // Sort ascending: lowest priority (earliest pages: Page 0, 1, 2...) run first
      queue.sort((a, b) => a.priority - b.priority);
      needsSort = false;
    }

    while (running < maxConcurrent && queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      if (entry.key && pendingByKey.get(entry.key) === entry) {
        pendingByKey.delete(entry.key);
      }
      if (entry.cancelled) {
        continue;
      }

      running++;
      runningEntries.add(entry);
      Promise.resolve()
        .then(() => {
          if (entry.cancelled) return;
          return entry.task();
        })
        .catch(() => {
          // ignore failed render tasks in queue runner
        })
        .finally(() => {
          runningEntries.delete(entry);
          running--;
          setTimeout(runNext, 0);
        });
    }
  }

  function enqueue(task: RenderTask, priority?: number, key?: string): () => void {
    const p = priority !== undefined ? priority : ++globalSeq;

    // Deduplicate pending queued task with identical key
    if (key) {
      const existing = pendingByKey.get(key);
      if (existing && !existing.cancelled) {
        existing.cancelled = true;
        const idx = queue.indexOf(existing);
        if (idx !== -1) queue.splice(idx, 1);
      }
    }

    const entry: QueueEntry = {
      task,
      cancelled: false,
      priority: p,
      key,
      cancel: () => {
        entry.cancelled = true;
        if (entry.key && pendingByKey.get(entry.key) === entry) {
          pendingByKey.delete(entry.key);
        }
      },
    };

    if (key) {
      pendingByKey.set(key, entry);
    }

    queue.push(entry);
    needsSort = true;
    runNext();
    return entry.cancel;
  }

  function clear() {
    for (const e of queue) {
      e.cancelled = true;
    }
    for (const r of runningEntries) {
      r.cancelled = true;
    }
    pendingByKey.clear();
    queue.length = 0;
    needsSort = false;
  }

  return { enqueue, clear };
}

// 8 concurrent workers for ultra-fast parallel thumbnail rendering
const thumbnailQ = createQueue(8);
export const enqueueThumbnail = thumbnailQ.enqueue;
export const clearThumbnailQueue = thumbnailQ.clear;

const pageQ = createQueue(2);
export const enqueuePageRender = pageQ.enqueue;
export const clearPageRenderQueue = pageQ.clear;
