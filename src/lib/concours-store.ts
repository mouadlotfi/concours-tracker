import { isOpenDeadline, type MatchedConcours } from './wadifa';

const KV_KEY = 'concours:history';

/* ------------------------------------------------------------------ */
/*  KV adapter: use Vercel KV when available, else fall back to a     */
/*  process-scoped in-memory Map (good enough for local dev).         */
/* ------------------------------------------------------------------ */

const hasKV = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
);

// Lazy-load @vercel/kv only when env vars are present so the import
// doesn't throw in dev environments.
async function kvGet<T>(key: string): Promise<T | null> {
  if (!hasKV) return memStore.get(key) as T ?? null;
  const { kv } = await import('@vercel/kv');
  return kv.get<T>(key);
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  if (!hasKV) {
    memStore.set(key, value);
    return;
  }
  const { kv } = await import('@vercel/kv');
  await kv.set(key, value);
}

// In-memory fallback store (only used when KV env vars are missing)
const memStore = new Map<string, unknown>();

if (!hasKV) {
  console.warn(
    '[concours-store] KV_REST_API_URL / KV_REST_API_TOKEN not set — using in-memory store (no persistence across restarts)',
  );
}

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
  const data = await kvGet<MatchedConcours[]>(KV_KEY);
  return data ?? [];
}

/**
 * Persist the full concours list to KV.
 */
async function saveAll(items: MatchedConcours[]): Promise<void> {
  await kvSet(KV_KEY, items);
}
