/**
 * Next.js instrumentation hook — runs once on server startup.
 * Sets up the background cron scheduler for periodic scraping.
 */
export async function register() {
  // Only run in the Node.js runtime (not in Edge).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { default: cron } = await import('node-cron');
    const { config } = await import('./lib/config');
    const { runRefresh } = await import('./lib/refresh');

    const expression = config.refreshCron;
    console.log(`[scheduler] Registering refresh cron: "${expression}"`);

    cron.schedule(expression, async () => {
      const ts = new Date().toISOString();
      console.log(`[scheduler] ${ts} — Starting scheduled refresh…`);
      try {
        const result = await runRefresh({ force: true });
        console.log(`[scheduler] ${ts} — Refresh complete:`, result);
      } catch (e) {
        console.error(`[scheduler] ${ts} — Refresh failed:`, e);
      }
    });
  }
}
