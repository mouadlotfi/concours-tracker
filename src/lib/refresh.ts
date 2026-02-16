import { brevoListSubscribers } from './brevo';
import { mailEnabled, subscribersEnabled } from './config';
import { notifySubscribers } from './mailer';
import { getMatchedConcoursCached } from './wadifa-cache';

export type RefreshResult = {
  matched: number;
  newFound: number;
  recipients: number;
  notified: number;
  mailOk: boolean;
};

/**
 * Run a full refresh cycle: scrape → merge/prune → optionally notify subscribers.
 * Shared between the HTTP cron endpoint and the background scheduler.
 */
export async function runRefresh(opts?: {
  force?: boolean;
  dryRun?: boolean;
}): Promise<RefreshResult> {
  const { force = false, dryRun = false } = opts ?? {};
  const { items, newItems } = await getMatchedConcoursCached({ force });

  let notified = 0;
  let recipients = 0;
  let mailOk = true;

  if (!dryRun && mailEnabled() && subscribersEnabled() && newItems.length) {
    const subs = await brevoListSubscribers();
    recipients = subs.length;
    if (subs.length) {
      mailOk = await notifySubscribers(subs, newItems);
      notified = mailOk ? newItems.length : 0;
    }
  }

  return {
    matched: items.length,
    newFound: newItems.length,
    recipients,
    notified,
    mailOk,
  };
}
