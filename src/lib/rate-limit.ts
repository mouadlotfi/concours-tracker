/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Tracks request timestamps per key (e.g. IP address) and rejects
 * requests that exceed the configured limit within the window.
 */

type Entry = { timestamps: number[] };

const store = new Map<string, Entry>();

// Periodic cleanup every 5 minutes to avoid unbounded memory growth.
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(windowMs: number) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, CLEANUP_INTERVAL);
  // Don't keep the process alive just for cleanup.
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function rateLimit(opts: {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}) {
  const { limit, windowMs } = opts;
  ensureCleanup(windowMs);

  return function check(key: string): { ok: boolean; remaining: number } {
    const now = Date.now();
    const cutoff = now - windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= limit) {
      return { ok: false, remaining: 0 };
    }

    entry.timestamps.push(now);
    return { ok: true, remaining: limit - entry.timestamps.length };
  };
}
