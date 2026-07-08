import * as cheerio from 'cheerio';

import { configDefaults } from './config';
import type { Env } from './config';
import { endOfDayIsoUtc, parseDdMmYyyyToIsoUtc } from './date';
import { normalizeText } from './normalize';
import { filterWithAI } from './ai-filter';
import { timer } from './log';

export type WadifaListItem = {
  id: string;
  wadifaUrl: string;
  title: string;
  administration: string;
  posts: string;
  diplomas: string;
  specialties: string;
  deadlineText: string | null;
  concoursDateText: string | null;
  depositDeadlineIso: string | null;
  concoursDateIso: string | null;
};

export type WadifaDetail = {
  wadifaUrl: string;
  title: string | null;
  details: Record<string, string>;
  sourceUrl: string | null;
  depositDeadlineIso: string | null;
  concoursDateIso: string | null;
};

export type MatchedConcours = {
  id: string;
  wadifaUrl: string;
  sourceUrl: string | null;
  title: string;
  matchReason: string;
  aiRelevant?: boolean;
  aiReason?: string;
  depositDeadlineIso: string | null;
  concoursDateIso: string | null;
  details: Record<string, string>;
};

/** Decode residual HTML entities that Cheerio's .text() may leave behind (double-encoded sources). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function absUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `${configDefaults.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': configDefaults.userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${url}`);
  }
  return await res.text();
}



function parseListCardText(raw: string): Omit<WadifaListItem, 'id' | 'wadifaUrl'> {
  // The anchor text is a flattened concatenation. We rely on stable French labels.
  const text = raw.replace(/\s+/g, ' ').trim();

  const title = (text.match(/^(.*?)\s+Administration\s+qui\s+recrute\s*:/i)?.[1] || '').trim();
  const administration =
    (text.match(/Administration\s+qui\s+recrute\s*:\s*(.*?)\s+Nombre\s+de\s+postes\s*:/i)?.[1] || '').trim();
  const posts = (text.match(/Nombre\s+de\s+postes\s*:\s*(.*?)\s+Dipl[oô]mes\s+requis\s*:/i)?.[1] || '').trim();

  let diplomas =
    (text.match(/Dipl[oô]mes\s+requis\s*:\s*(.*?)\s+Sp[eé]cialit[eé]s\s+requises\s*:/i)?.[1] || '').trim();
  let specialties =
    (text.match(/Sp[eé]cialit[eé]s\s+requises\s*:\s*(.*?)\s+Il\s+y\s+a\s+/i)?.[1] || '').trim();

  if (!diplomas) {
    diplomas = (text.match(/Dipl[oô]mes\s+requis\s*:\s*(.*?)\s+Il\s+y\s+a\s+/i)?.[1] || '').trim();
  }
  if (!specialties) {
    specialties = (text.match(/Sp[eé]cialit[eé]s\s+requises\s*:\s*(.*?)(?:\s+Il\s+y\s+a\s+|$)/i)?.[1] || '').trim();
  }

  const datePair = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
  const deadlineText = datePair?.[1] || null;
  const concoursDateText = datePair?.[2] || null;
  const depositDeadlineIso = deadlineText ? endOfDayIsoUtc(deadlineText) : null;
  const concoursDateIso = concoursDateText ? parseDdMmYyyyToIsoUtc(concoursDateText) : null;

  return {
    title: title || text.slice(0, 120),
    administration,
    posts,
    diplomas,
    specialties,
    deadlineText,
    concoursDateText,
    depositDeadlineIso,
    concoursDateIso,
  };
}

export async function listWadifaItems(): Promise<WadifaListItem[]> {
  const items: WadifaListItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= Math.max(1, configDefaults.maxPages); page++) {
    const u = new URL(absUrl(configDefaults.listPath));
    if (page > 1) u.searchParams.set('pageNumber', String(page));
    if (configDefaults.listSortBy) u.searchParams.set('sortBy', String(configDefaults.listSortBy));

    const html = await fetchHtml(u.toString());
    const $ = cheerio.load(html);

    $("a[href*='/fr/']").each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!/\/fr\/\d{4,6}\//.test(href)) return;
      const wadifaUrl = absUrl(href);
      if (seen.has(wadifaUrl)) return;
      seen.add(wadifaUrl);

      const id = href.match(/\/fr\/(\d{4,6})\//)?.[1] || wadifaUrl;
      const cardText = decodeEntities($(el).text() || '');
      const parsed = parseListCardText(cardText);

      items.push({
        id,
        wadifaUrl,
        ...parsed,
      });
    });
  }

  return items;
}

export async function fetchWadifaDetail(wadifaUrl: string): Promise<WadifaDetail> {
  const html = await fetchHtml(wadifaUrl);
  const $ = cheerio.load(html);

  const title = decodeEntities($('h1').first().text().replace(/\s+/g, ' ').trim());
  const details: Record<string, string> = {};

  $('#InfosJob .job-overview-inner li').each((_, li) => {
    const label = decodeEntities($(li).find('span').first().text().replace(/\s+/g, ' ').trim());
    if (!label) return;
    const value = decodeEntities(
      $(li)
        .find('h2,h5,h4')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (!value) return;
    details[label] = value;
  });

  const sourceHref = ($('a#UrlJobEmploi').attr('href') || '').trim();
  const sourceUrl = sourceHref ? absUrl(sourceHref) : null;

  const dl = details['Date limite de dépôt des candidatures'] || '';
  const dc = details['Date du concours'] || '';
  const depositDeadlineIso = dl ? endOfDayIsoUtc(dl) : null;
  const concoursDateIso = dc ? parseDdMmYyyyToIsoUtc(dc) : null;

  return {
    wadifaUrl,
    title: title || null,
    details,
    sourceUrl,
    depositDeadlineIso,
    concoursDateIso,
  };
}

export function isOpenDeadline(iso: string | null): boolean {
  if (!iso) return true;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return true;
  return ms >= Date.now();
}



export async function scrapeMatchedConcours(
  env: Env,
  existingClassifications?: Map<string, { aiRelevant?: boolean; aiReason?: string }>
): Promise<MatchedConcours[]> {
  const t = timer();

  const list = await listWadifaItems();
  console.log(`[wadifa] Scraped ${list.length} items from wadifa list pages in ${t.mark()}ms`);
  const matched = list.filter((it) => isOpenDeadline(it.depositDeadlineIso));
  console.log(`[wadifa] ${matched.length} items have open deadlines (filtered from ${list.length})`);

  // Build basic items first without making subrequests for details
  const out: MatchedConcours[] = matched.map((it) => ({
    id: it.id,
    wadifaUrl: it.wadifaUrl,
    sourceUrl: null,
    title: it.title,
    matchReason: 'Sent directly to AI',
    depositDeadlineIso: it.depositDeadlineIso,
    concoursDateIso: it.concoursDateIso,
    details: {
      'Administration qui recrute': it.administration,
      'Spécialités requises': it.specialties || '',
      'Postes': it.posts || '',
      'Diplômes': it.diplomas || ''
    },
  }));

  // Split items into already-classified (skip AI) and new (send to AI).
  // This avoids wasting free-tier API calls re-classifying unchanged items.
  const known = existingClassifications ?? new Map<string, { aiRelevant?: boolean; aiReason?: string }>();
  const toClassify: MatchedConcours[] = [];
  const alreadyClassified: MatchedConcours[] = [];

  for (const item of out) {
    const existing = known.get(item.id);
    if (existing && existing.aiRelevant !== undefined) {
      item.aiRelevant = existing.aiRelevant;
      item.aiReason = existing.aiReason;
      alreadyClassified.push(item);
    } else {
      toClassify.push(item);
    }
  }
  console.log(`[wadifa] ${alreadyClassified.length} already classified, ${toClassify.length} need AI classification`);

  // Bulk AI Classification Step (only takes 1 HTTP subrequest) — only for new items
  let aiFiltered = toClassify;
  if (toClassify.length > 0) {
    try {
      aiFiltered = await filterWithAI(toClassify, env);
      const relevant = aiFiltered.filter(it => it.aiRelevant === true).length;
      const notRelevant = aiFiltered.filter(it => it.aiRelevant === false).length;
      const unclassified = aiFiltered.filter(it => it.aiRelevant === undefined).length;
      console.log(`[wadifa] AI filter results: ${relevant} relevant, ${notRelevant} not relevant, ${unclassified} unclassified (out of ${aiFiltered.length}) in ${t.mark()}ms`);
    } catch (e) {
      console.warn('[wadifa] AI bulk filter failed:', e);
    }
  } else {
    console.log('[wadifa] No new items to classify, skipping AI call.');
  }

  const combined = [...alreadyClassified, ...aiFiltered];

  // Only fetch details for the ones the AI deemed relevant (or all if AI failed)
  // This drastically reduces HTTP subrequests and avoids Cloudflare 50 subrequest limit
  const finalOut: MatchedConcours[] = [];
  let detailFetches = 0;

  for (const item of combined) {
    if (item.aiRelevant !== false) {
      if (detailFetches < 10) {
        detailFetches++;
        try {
          const detail = await fetchWadifaDetail(item.wadifaUrl);
          item.sourceUrl = detail.sourceUrl;
          item.details = { ...item.details, ...detail.details };
          if (detail.title) item.title = detail.title;
          if (detail.depositDeadlineIso && !item.depositDeadlineIso) item.depositDeadlineIso = detail.depositDeadlineIso;
          if (detail.concoursDateIso && !item.concoursDateIso) item.concoursDateIso = detail.concoursDateIso;
        } catch (e) {
          console.warn(`[wadifa] detail fetch failed for ${item.wadifaUrl}:`, e instanceof Error ? e.message : e);
        }
      } else {
        console.warn(`[wadifa] Skipping detail fetch for ${item.wadifaUrl} to avoid subrequest limits.`);
      }
    }
    finalOut.push(item);
  }

  console.log(`[wadifa] Returning ${finalOut.length} total items (${detailFetches} detail pages fetched) in ${t.mark()}ms (total ${t.total()}ms)`);
  return finalOut;
}
