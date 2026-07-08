/**
 * Lightweight multi-stage timer for logging pipeline step durations.
 *
 * Usage:
 *   const t = timer();
 *   await doStep1();
 *   console.log(`[tag] step1 done in ${t.mark()}ms`);
 *   await doStep2();
 *   console.log(`[tag] step2 done in ${t.mark()}ms`);
 *   console.log(`[tag] total ${t.total()}ms`);
 */
export function timer() {
  let last = Date.now();
  const start = last;
  return {
    /** Milliseconds since the last mark() call (or creation). */
    mark: (): number => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      return delta;
    },
    /** Milliseconds since the timer was created. */
    total: (): number => Date.now() - start,
  };
}
