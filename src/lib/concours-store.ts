import { kv } from '@vercel/kv';
import { isOpenDeadline, type MatchedConcours } from './wadifa';

const KV_KEY = 'concours:history';

/**
 * Merge freshly-scraped concours into the persistent store,
 * prune entries whose deposit deadline has passed, and return
 * the full list of currently-open concours sorted by deadline.
 */
export async function mergeAndPrune(
  freshItems: MatchedConcours[],
): Promise<MatchedConcours[]> {
  const stored = await loadAll();

  // Index stored items by id for fast lookup
  const map = new Map<string, MatchedConcours>();
  for (const item of stored) {
    map.set(item.id, item);
  }

  // Upsert fresh items (always overwrite with latest scraped data)
  for (const item of freshItems) {
    map.set(item.id, item);
  }

  // Keep only concours whose deadline is still open
  const open = [...map.values()].filter((it) =>
    isOpenDeadline(it.depositDeadlineIso),
  );

  // Sort by deadline ascending (soonest first), nulls last
  open.sort((a, b) => {
    if (!a.depositDeadlineIso && !b.depositDeadlineIso) return 0;
    if (!a.depositDeadlineIso) return 1;
    if (!b.depositDeadlineIso) return -1;
    return (
      new Date(a.depositDeadlineIso).getTime() -
      new Date(b.depositDeadlineIso).getTime()
    );
  });

  await saveAll(open);
  return open;
}

/**
 * Load all stored concours from KV (returns [] if key missing).
 */
export async function loadAll(): Promise<MatchedConcours[]> {
  const data = await kv.get<MatchedConcours[]>(KV_KEY);
  return data ?? [];
}

/**
 * Persist the full concours list to KV.
 */
async function saveAll(items: MatchedConcours[]): Promise<void> {
  await kv.set(KV_KEY, items);
}
