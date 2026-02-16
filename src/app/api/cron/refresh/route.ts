import { config } from '@/lib/config';
import { runRefresh } from '@/lib/refresh';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  /* ── Auth: always required ─────────────────────── */
  const provided = req.headers.get('x-cron-secret') || '';
  if (!config.cronSecret || provided !== config.cronSecret) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runRefresh({ force, dryRun });

    return Response.json({
      ok: true,
      result: {
        dryRun,
        force,
        ...result,
      },
    });
  } catch (e) {
    console.error('[cron/refresh]', e);
    return Response.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}
