import { config } from './config';
import { scrapeMatchedConcours, type MatchedConcours } from './wadifa';
import { mergeAndPrune, type MergeResult } from './concours-store';

export type CacheResult = {
  /** All currently-open concours. */
  items: MatchedConcours[];
  /** Concours discovered for the first time during this scrape. */
  newItems: MatchedConcours[];
};

type CacheState = {
  ts: number;
  items: MatchedConcours[];
  inFlight?: Promise<CacheResult>;
};

const KEY = '__wadifaMatchedCache';

function getState(): CacheState | undefined {
  return (globalThis as any)[KEY] as CacheState | undefined;
}

function setState(state: CacheState) {
  (globalThis as any)[KEY] = state;
}

export async function getMatchedConcoursCached(opts?: { force?: boolean }): Promise<CacheResult> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, config.cacheSeconds) * 1000;
  const now = Date.now();
  const state = getState();

  if (!force && state && state.ts > 0 && now - state.ts < ttlMs) {
    return { items: state.items, newItems: [] };
  }

  if (!force && state?.inFlight) {
    return await state.inFlight;
  }

  const inFlight = (async () => {
    const scraped = await scrapeMatchedConcours();
    // Merge freshly scraped items with stored history, prune expired
    const { all, newItems } = await mergeAndPrune(scraped);
    setState({ ts: Date.now(), items: all });
    return { items: all, newItems };
  })();

  setState({ ts: state?.ts || 0, items: state?.items || [], inFlight });

  try {
    return await inFlight;
  } finally {
    const latest = getState();
    if (latest?.inFlight) {
      latest.inFlight = undefined;
      setState(latest);
    }
  }
}
