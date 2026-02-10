import { brevoListSubscribers } from '@/lib/brevo';
import { config, mailEnabled, subscribersEnabled } from '@/lib/config';
import { notifySubscribers } from '@/lib/mailer';
import { getMatchedConcoursCached } from '@/lib/wadifa-cache';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  if (config.cronSecret) {
    const provided = req.headers.get('x-cron-secret') || '';
    if (provided !== config.cronSecret) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const { items, newItems } = await getMatchedConcoursCached({ force });
    const feedItems = items.slice(0, config.maxFeedItems);

    let notified = 0;
    let recipients = 0;
    let mailOk = true;

    if (!dryRun && mailEnabled() && subscribersEnabled() && newItems.length) {
      const subs = await brevoListSubscribers(300);
      recipients = subs.length;
      if (subs.length) {
        mailOk = await notifySubscribers(subs, newItems);
        notified = mailOk ? newItems.length : 0;
      }
    }

    return Response.json({
      ok: true,
      result: {
        dryRun,
        force,
        matched: items.length,
        returned: feedItems.length,
        newFound: newItems.length,
        recipients,
        notified,
        mailOk,
      },
    });
  } catch (e) {
    console.error('[cron/refresh]', e);
    return Response.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}
