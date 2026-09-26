import type { Env } from './config';
import type { MatchedConcours } from './scraper';
import { isOpenDeadline } from './scraper';
import { endOfDayIsoUtc, parseDdMmYyyyToIsoUtc } from './date';

export type MergeResult = { all: MatchedConcours[]; newItems: MatchedConcours[] };

export function mergeConcours(
  existing: MatchedConcours | undefined,
  fresh: MatchedConcours
): MatchedConcours {
  const details = {
    ...(existing?.details || {}),
    ...Object.fromEntries(Object.entries(fresh.details).filter(([, value]) => value.trim())),
  };

  if (!details['Administration qui recrute']) {
    try {
      const slug = decodeURIComponent(new URL(fresh.wadifaUrl).pathname.split('/').pop() || '');
      const administration = slug.match(/^(.*?)-concours-de-/i)?.[1]?.replace(/-/g, ' ').trim();
      // ponytail: URL fallback covers old rows; remove when every stored row uses the new card selectors.
      if (administration) details['Administration qui recrute'] = administration;
    } catch {
      // Keep the field empty when a legacy URL is malformed.
    }
  }

  const deadline = details['Date limite de dépôt des candidatures']
    || details['Date limite de dépôt des candidatures :'];
  const concoursDate = details['Date du concours'] || details['Date du concours :'];

  return {
    ...fresh,
    sourceUrl: fresh.sourceUrl || existing?.sourceUrl || null,
    notifiedAt: fresh.notifiedAt ?? existing?.notifiedAt,
    depositDeadlineIso: fresh.depositDeadlineIso || existing?.depositDeadlineIso
      || (deadline ? endOfDayIsoUtc(deadline) : null),
    concoursDateIso: fresh.concoursDateIso || existing?.concoursDateIso
      || (concoursDate ? parseDdMmYyyyToIsoUtc(concoursDate) : null),
    details,
  };
}

export async function loadAll(env: Env): Promise<MatchedConcours[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM concours ORDER BY depositDeadlineIso ASC'
    ).all();

    if (!results) return [];

    return results.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        wadifaUrl: String(r.wadifaUrl),
        sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : null,
        title: String(r.title),
        depositDeadlineIso: typeof r.depositDeadlineIso === 'string' ? r.depositDeadlineIso : null,
        concoursDateIso: typeof r.concoursDateIso === 'string' ? r.concoursDateIso : null,
        details: typeof r.details === 'string' ? JSON.parse(r.details) : {},
        matchReason: String(r.matchReason || ''),
        aiRelevant: r.aiRelevant === null || r.aiRelevant === undefined ? undefined : Boolean(r.aiRelevant),
        aiReason: typeof r.aiReason === 'string' ? r.aiReason : undefined,
        classificationVersion: typeof r.classificationVersion === 'string' ? r.classificationVersion : undefined,
        classificationHash: typeof r.classificationHash === 'string' ? r.classificationHash : undefined,
        classificationSource: (r.classificationSource === 'rules' || r.classificationSource === 'ai') ? r.classificationSource : undefined,
        classificationModel: typeof r.classificationModel === 'string' ? r.classificationModel : undefined,
        classifiedAt: typeof r.classifiedAt === 'string' ? r.classifiedAt : undefined,
        notifiedAt: typeof r.notifiedAt === 'string' ? r.notifiedAt : undefined,
      };
    });
  } catch (err) {
    console.error('[store] loadAll error', err);
    throw err;
  }
}

export async function mergeAndPrune(
  freshItems: MatchedConcours[],
  env: Env,
  options: { reclassify?: boolean } = {}
): Promise<MergeResult> {
  const stored = await loadAll(env);
  const map = new Map<string, MatchedConcours>();

  // Load existing into map
  for (const item of stored) {
    map.set(item.id, mergeConcours(undefined, item));
  }
  console.log(`[store] mergeAndPrune: ${stored.length} stored items, ${freshItems.length} fresh items`);

  const newItems: MatchedConcours[] = [];
  
  // Stored verdicts are sticky by default. Only the explicitly requested
  // reclassification workflow may replace an existing/manual verdict.
  let preservedCount = 0;
  for (const item of freshItems) {
    if (!map.has(item.id)) {
      newItems.push(item);
    }
    const existing = map.get(item.id);
    const preserveStoredVerdict = existing
      && existing.aiRelevant !== undefined
      && !options.reclassify;
    if (preserveStoredVerdict) {
      item.aiRelevant = existing.aiRelevant;
      item.aiReason = existing.aiReason;
      item.classificationVersion = existing.classificationVersion;
      item.classificationHash = existing.classificationHash;
      item.classificationSource = existing.classificationSource;
      item.classificationModel = existing.classificationModel;
      item.classifiedAt = existing.classifiedAt;
      preservedCount++;
    }
    map.set(item.id, mergeConcours(existing, item));
  }
  console.log(`[store] mergeAndPrune: ${newItems.length} new items, ${preservedCount} stored verdicts preserved`);

  // Prune expired
  const beforePrune = map.size;
  const expiredIds: string[] = [];
  for (const [id, item] of map) {
    if (!isOpenDeadline(item.depositDeadlineIso)) {
      console.log(`[store] Pruning expired: ${id} (${item.title}) deadline=${item.depositDeadlineIso}`);
      map.delete(id);
      expiredIds.push(id);
    }
  }
  console.log(`[store] Pruned ${beforePrune - map.size} expired items, ${map.size} remaining`);

  // Sync back to D1
  const all = [...map.values()].sort((a, b) => {
    const ta = a.depositDeadlineIso ? new Date(a.depositDeadlineIso).getTime() : Infinity;
    const tb = b.depositDeadlineIso ? new Date(b.depositDeadlineIso).getTime() : Infinity;
    return ta - tb;
  });

  const stmts: D1PreparedStatement[] = [];
  for (const item of all) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO concours (
              id, title, wadifaUrl, sourceUrl, depositDeadlineIso, concoursDateIso, details,
              matchReason, aiRelevant, aiReason, classificationVersion, classificationHash,
              classificationSource, classificationModel, classifiedAt, notifiedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title, wadifaUrl = excluded.wadifaUrl,
              sourceUrl = excluded.sourceUrl, depositDeadlineIso = excluded.depositDeadlineIso,
              concoursDateIso = excluded.concoursDateIso, details = excluded.details,
              matchReason = excluded.matchReason, aiRelevant = excluded.aiRelevant,
              aiReason = excluded.aiReason, classificationVersion = excluded.classificationVersion,
              classificationHash = excluded.classificationHash, classificationSource = excluded.classificationSource,
              classificationModel = excluded.classificationModel, classifiedAt = excluded.classifiedAt,
              notifiedAt = COALESCE(concours.notifiedAt, excluded.notifiedAt)`
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
          item.aiReason || null,
          item.classificationVersion || null,
          item.classificationHash || null,
          item.classificationSource || null,
          item.classificationModel || null,
          item.classifiedAt || null,
          item.notifiedAt || null
      )
    );
  }
  for (const id of expiredIds) stmts.push(env.DB.prepare('DELETE FROM concours WHERE id = ?').bind(id));

  if (stmts.length) await env.DB.batch(stmts);

  return { all, newItems };
}

/** Claim each relevant listing atomically before contacting the email provider. */
export async function claimNotifications(ids: string[], env: Env, at: Date = new Date()): Promise<string[]> {
  if (!ids.length) return [];
  const results = await env.DB.batch(ids.map((id) =>
    env.DB.prepare('UPDATE concours SET notifiedAt = ? WHERE id = ? AND notifiedAt IS NULL AND aiRelevant = 1')
      .bind(at.toISOString(), id)
  ));
  if (results.length !== ids.length || results.some((result) => !result.success || typeof result.meta?.changes !== 'number')) {
    throw new Error('Could not verify notification claims in D1');
  }
  return ids.filter((_, index) => results[index]!.meta.changes === 1);
}
