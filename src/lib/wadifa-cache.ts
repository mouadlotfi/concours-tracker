import { config } from './config';
import { scrapeMatchedConcours, type MatchedConcours } from './wadifa';
import { mergeAndPrune } from './concours-store';

type CacheState = {
  ts: number;
  items: MatchedConcours[];
  inFlight?: Promise<MatchedConcours[]>;
};

const KEY = '__wadifaMatchedCache';

function getState(): CacheState | undefined {
  return (globalThis as any)[KEY] as CacheState | undefined;
}

function setState(state: CacheState) {
  (globalThis as any)[KEY] = state;
}

export async function getMatchedConcoursCached(opts?: { force?: boolean }): Promise<MatchedConcours[]> {
  const force = Boolean(opts?.force);
  const ttlMs = Math.max(0, config.cacheSeconds) * 1000;
  const now = Date.now();
  const state = getState();

  if (!force && state && state.items.length && now - state.ts < ttlMs) {
    return state.items;
  }

  if (!force && state?.inFlight) {
    return await state.inFlight;
  }

  const inFlight = (async () => {
    const scraped = await scrapeMatchedConcours();
    // Merge freshly scraped items with KV history, prune expired
    const items = await mergeAndPrune(scraped);
    setState({ ts: Date.now(), items });
    return items;
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
