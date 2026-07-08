import type { Env } from './config';
import type { MatchedConcours } from './scraper';
import { isOpenDeadline } from './scraper';

export type MergeResult = { all: MatchedConcours[]; newItems: MatchedConcours[] };

export async function loadAll(env: Env): Promise<MatchedConcours[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM concours ORDER BY depositDeadlineIso ASC'
    ).all();

    if (!results) return [];

    return results.map((row: any) => ({
      id: row.id,
      wadifaUrl: row.wadifaUrl,
      sourceUrl: row.sourceUrl,
      title: row.title,
      depositDeadlineIso: row.depositDeadlineIso,
      concoursDateIso: row.concoursDateIso,
      details: row.details ? JSON.parse(row.details) : {},
      matchReason: row.matchReason,
      aiRelevant: row.aiRelevant === null ? undefined : Boolean(row.aiRelevant),
      aiReason: row.aiReason,
    }));
  } catch (err) {
    console.error('[store] loadAll error', err);
    return [];
  }
}

export async function mergeAndPrune(
  freshItems: MatchedConcours[],
  env: Env
): Promise<MergeResult> {
  const stored = await loadAll(env);
  const map = new Map<string, MatchedConcours>();

  // Load existing into map
  for (const item of stored) {
    map.set(item.id, item);
  }
  console.log(`[store] mergeAndPrune: ${stored.length} stored items, ${freshItems.length} fresh items`);

  const newItems: MatchedConcours[] = [];
  
  // Upsert new items, preserving existing AI classifications
  let preservedCount = 0;
  for (const item of freshItems) {
    if (!map.has(item.id)) {
      newItems.push(item);
    }
    const existing = map.get(item.id);
    // Sticky: once an item has an AI verdict stored, never overwrite it with a fresh one.
    if (existing && existing.aiRelevant !== undefined) {
      item.aiRelevant = existing.aiRelevant;
      item.aiReason = existing.aiReason;
      preservedCount++;
    }
    map.set(item.id, item);
  }
  console.log(`[store] mergeAndPrune: ${newItems.length} new items, ${preservedCount} AI classifications preserved`);

  // Prune expired
  const beforePrune = map.size;
  for (const [id, item] of map) {
    if (!isOpenDeadline(item.depositDeadlineIso)) {
      console.log(`[store] Pruning expired: ${id} (${item.title}) deadline=${item.depositDeadlineIso}`);
      map.delete(id);
    }
  }
  console.log(`[store] Pruned ${beforePrune - map.size} expired items, ${map.size} remaining`);

  // Sync back to D1
  const all = [...map.values()].sort((a, b) => {
    const ta = a.depositDeadlineIso ? new Date(a.depositDeadlineIso).getTime() : Infinity;
    const tb = b.depositDeadlineIso ? new Date(b.depositDeadlineIso).getTime() : Infinity;
    return ta - tb;
  });

  try {
    // Clear old items and insert fresh (simple approach for small dataset)
    // To be safer, we use a batch transaction
    const stmts = [env.DB.prepare('DELETE FROM concours')];

    for (const item of all) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO concours (id, title, wadifaUrl, sourceUrl, depositDeadlineIso, concoursDateIso, details, matchReason, aiRelevant, aiReason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.id,
          item.title,
          item.wadifaUrl,
          item.sourceUrl,
          item.depositDeadlineIso,
          item.concoursDateIso,
          JSON.stringify(item.details),
          item.matchReason,
          item.aiRelevant === undefined ? null : item.aiRelevant ? 1 : 0,
          item.aiReason || null
        )
      );
    }

    await env.DB.batch(stmts);
  } catch (err) {
    console.error('[store] mergeAndPrune error saving batch:', err);
  }

  return { all, newItems };
}
