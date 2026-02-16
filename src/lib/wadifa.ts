import * as cheerio from 'cheerio';

import { config } from './config';
import { endOfDayIsoUtc, parseDdMmYyyyToIsoUtc } from './date';
import { normalizeText } from './normalize';

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
  title: string;
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
  depositDeadlineIso: string | null;
  concoursDateIso: string | null;
  details: Record<string, string>;
};

function absUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `${config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${url}`);
  }
  return await res.text();
}

function matchByKeywords(text: string): { matched: boolean; reason: string } {
  const t = normalizeText(text);
  for (const ex of config.excludeKeywords) {
    const n = normalizeText(ex);
    if (n && t.includes(n)) return { matched: false, reason: `excluded: ${ex}` };
  }
  for (const kw of config.keywords) {
    const n = normalizeText(kw);
    if (n && t.includes(n)) return { matched: true, reason: `keyword: ${kw}` };
  }
  return { matched: false, reason: '' };
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

  for (let page = 1; page <= Math.max(1, config.maxPages); page++) {
    const u = new URL(absUrl(config.listPath));
    if (page > 1) u.searchParams.set('pageNumber', String(page));
    if (config.listSortBy) u.searchParams.set('sortBy', String(config.listSortBy));

    const html = await fetchHtml(u.toString());
    const $ = cheerio.load(html);

    $("a[href*='/fr/']").each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!/\/fr\/\d{4,6}\//.test(href)) return;
      const wadifaUrl = absUrl(href);
      if (seen.has(wadifaUrl)) return;
      seen.add(wadifaUrl);

      const id = href.match(/\/fr\/(\d{4,6})\//)?.[1] || wadifaUrl;
      const cardText = $(el).text() || '';
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

  const title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const details: Record<string, string> = {};

  $('#InfosJob .job-overview-inner li').each((_, li) => {
    const label = $(li).find('span').first().text().replace(/\s+/g, ' ').trim();
    if (!label) return;
    const value = $(li)
      .find('h2,h5,h4')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
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
    title: title || wadifaUrl,
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

export async function scrapeMatchedConcours(): Promise<MatchedConcours[]> {
  const list = await listWadifaItems();
  const matched = list
    .map((it) => {
      const haystack = [it.title, it.administration, it.diplomas, it.specialties].filter(Boolean).join('\n');
      const kw = matchByKeywords(haystack);
      return { it, kw };
    })
    .filter(({ it, kw }) => kw.matched && isOpenDeadline(it.depositDeadlineIso));

  const out: MatchedConcours[] = [];
  for (const { it, kw } of matched) {
    try {
      const detail = await fetchWadifaDetail(it.wadifaUrl);
      out.push({
        id: it.id,
        wadifaUrl: it.wadifaUrl,
        sourceUrl: detail.sourceUrl,
        title: detail.title || it.title,
        matchReason: kw.reason,
        depositDeadlineIso: detail.depositDeadlineIso || it.depositDeadlineIso,
        concoursDateIso: detail.concoursDateIso || it.concoursDateIso,
        details: {
          'Administration qui recrute': it.administration,
          ...detail.details,
        },
      });
    } catch (e) {
      // Skip individual items that fail to fetch rather than aborting the entire scrape.
      console.warn(`[wadifa] detail fetch failed for ${it.wadifaUrl}:`, e instanceof Error ? e.message : e);
      out.push({
        id: it.id,
        wadifaUrl: it.wadifaUrl,
        sourceUrl: null,
        title: it.title,
        matchReason: kw.reason,
        depositDeadlineIso: it.depositDeadlineIso,
        concoursDateIso: it.concoursDateIso,
        details: { 'Administration qui recrute': it.administration },
      });
    }
  }

  return out;
}
