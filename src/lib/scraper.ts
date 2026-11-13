import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { Buffer } from 'node:buffer';

import { configDefaults } from './config';
import type { Env } from './config';
import { endOfDayIsoUtc, parseDdMmYyyyToIsoUtc } from './date';
import { normalizeText } from './normalize';
import { filterWithAI } from './ai-filter';
import { timer } from './log';
import { SUBREQUEST_LIMIT, resetSubrequestBudget, subrequestsUsed, takeSubrequest } from './subrequest-budget';
import {
  CLASSIFIER_VERSION,
  classificationContentHash,
  classifyByRules,
} from './classification';
import type { RuleDecision, StoredClassification, ClassificationSource } from './classification';

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
  classificationVersion?: string;
  classificationHash?: string;
  classificationSource?: ClassificationSource;
  classificationModel?: string;
  classifiedAt?: string;
  classificationContext?: string;
  classificationDocumentUrl?: string;
  classificationDocumentDataUrl?: string;
  notifiedAt?: string;
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

async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number.parseInt(res.headers.get('content-length') || '0', 10);
  if (declaredLength > maxBytes) {
    throw new Error(`response too large: ${declaredLength} bytes`);
  }
  if (!res.body) return '';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function readBoundedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(res.headers.get('content-length') || '0', 10);
  if (declaredLength > maxBytes) {
    await res.body?.cancel();
    throw new Error(`response too large: ${declaredLength} bytes`);
  }
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchResource(url: string, accept: string): Promise<Response> {
  if (!takeSubrequest()) throw new Error(`subrequest budget exhausted (${SUBREQUEST_LIMIT}) before ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': configDefaults.userAgent,
      Accept: accept,
    },
  });
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${url}`);
  }
  return res;
}

async function fetchHtml(url: string, maxBytes = 750_000): Promise<string> {
  const res = await fetchResource(url, 'text/html,application/xhtml+xml');
  return readBoundedText(res, maxBytes);
}

const MAX_SOURCE_CONTEXT_CHARS = 12_000;
const MAX_PDF_BYTES = 3_000_000;

async function pdfResponseToDataUrl(res: Response, sourceUrl: string): Promise<string> {
  const bytes = await readBoundedBytes(res, MAX_PDF_BYTES);
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') throw new Error(`source is not a PDF: ${sourceUrl}`);
  console.log(JSON.stringify({ event: 'official-pdf-attached', sourceUrl, bytes: bytes.byteLength }));
  return `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`;
}

type SourceContext = {
  text: string;
  officialDocumentUrl?: string;
  officialDocumentDataUrl?: string;
};

async function fetchSourceContext(sourceUrl: string): Promise<SourceContext> {
  const res = await fetchResource(sourceUrl, 'text/html,application/xhtml+xml,application/pdf');
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/pdf')) {
    const officialDocumentDataUrl = await pdfResponseToDataUrl(res, sourceUrl);
    return { text: '', officialDocumentUrl: sourceUrl, officialDocumentDataUrl };
  }

  const html = await readBoundedText(res, 500_000);
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const mainText = $('main').first().text() || $('body').text();
  const htmlContext = decodeEntities(mainText).replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_CONTEXT_CHARS);

  const pdfUrls: string[] = [];
  $('a[href]').each((_, element) => {
    const href = ($(element).attr('href') || '').trim();
    const label = decodeEntities($(element).text()).replace(/\s+/g, ' ').trim();
    if (!href) return;
    const looksLikeOfficialDocument =
      /\/concours\/download\//i.test(href)
      || /\.pdf(?:$|[?#])/i.test(href)
      || /(?:arrete|arrêté|decision|décision|قرار)/i.test(label);
    if (!looksLikeOfficialDocument) return;
    try {
      const absolute = new URL(href, sourceUrl).toString();
      if (!pdfUrls.includes(absolute)) pdfUrls.push(absolute);
    } catch {
      // Ignore malformed third-party links.
    }
  });

  const officialPdfUrl = pdfUrls[0];
  let officialDocumentDataUrl: string | undefined;
  if (officialPdfUrl) {
    try {
      const pdfResponse = await fetchResource(officialPdfUrl, 'application/pdf');
      officialDocumentDataUrl = await pdfResponseToDataUrl(pdfResponse, officialPdfUrl);
    } catch (error) {
      console.warn(`[wadifa] official PDF fetch failed for ${officialPdfUrl}:`, error instanceof Error ? error.message : error);
    }
  }
  return { text: htmlContext, officialDocumentUrl: officialPdfUrl, officialDocumentDataUrl };
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

export function parseListCard(card: cheerio.Cheerio<AnyNode>): Omit<WadifaListItem, 'id' | 'wadifaUrl'> {
  const parsed = parseListCardText(decodeEntities(card.text() || ''));
  const titleNode = card.find('.job-listing-title').clone();
  titleNode.find('.wf-fresh-new').remove();

  // The chip is orange far out and red when close, so match its label; class*= also covers the older orange-only markup.
  const deadlineText = card.find('[class*="wf-datechip"][title*="Date limite"]').attr('title')?.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]
    || parsed.deadlineText;
  const concoursDateText = card.find('.wf-datechip-green').text().match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]
    || parsed.concoursDateText;

  return {
    ...parsed,
    title: titleNode.text().replace(/\s+/g, ' ').trim() || parsed.title,
    administration: (card.find('.wf-emp-logo').attr('alt') || '').trim() || parsed.administration,
    posts: card.find('li').filter((_, el) => /postes?/i.test(card.find(el).text())).first().text().replace(/\s+/g, ' ').trim()
      || parsed.posts,
    diplomas: card.find('.diplomas').map((_, el) => card.find(el).text().trim()).get().filter(Boolean).join(' ') || parsed.diplomas,
    specialties: card.find('.speciliteList').map((_, el) => card.find(el).text().trim()).get().filter(Boolean).join(' ') || parsed.specialties,
    deadlineText,
    concoursDateText,
    depositDeadlineIso: deadlineText ? endOfDayIsoUtc(deadlineText) : null,
    concoursDateIso: concoursDateText ? parseDdMmYyyyToIsoUtc(concoursDateText) : null,
  };
}

export async function listWadifaItems(): Promise<WadifaListItem[]> {
  const items: WadifaListItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= Math.max(1, configDefaults.maxPages); page++) {
    const u = new URL(absUrl(configDefaults.listPath));
    if (page > 1) u.searchParams.set('pageNumber', String(page));
    if (configDefaults.listSortBy) u.searchParams.set('sortBy', String(configDefaults.listSortBy));
    u.searchParams.set('pageSize', String(configDefaults.listPageSize));

    let html: string;
    try {
      html = await fetchHtml(u.toString());
    } catch (error) {
      // The budget guard throws once subrequests are spent; stop paging instead of losing the scrape.
      console.warn(`[wadifa] list page ${page} fetch failed, stopping pagination:`, error instanceof Error ? error.message : error);
      break;
    }
    const $ = cheerio.load(html);

    $("a[href*='/fr/']").each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      const id = href.match(/\/fr\/(\d{4,6})\//)?.[1];
      if (!id) return;

      // Current markup nests the title link inside the card; older markup wrapped the whole card.
      // Anything else (site-wide promo banner) links the same id with no card around it.
      const card = $(el).closest('.job-listing');
      if (!card.length) return;

      const wadifaUrl = absUrl(`/fr/${id}/`);
      if (seen.has(wadifaUrl)) return;
      seen.add(wadifaUrl);

      const parsed = parseListCard(card);

      items.push({
        id,
        wadifaUrl,
        ...parsed,
      });
    });
  }

  return items;
}

export function normalizeDetailValue(label: string, value: string): string {
  // "Dépôt papier du dossier de candidature — préparer le dossier →" -> "Papier"
  // (no \b: "é" is not a \w character, so a word boundary never forms before "électronique")
  if (/^(?:Type|Mode) de dépôt\s*:?$/i.test(label.trim())) {
    const channel = value.match(/papier|électronique/i)?.[0];
    if (channel) return channel.charAt(0).toUpperCase() + channel.slice(1).toLowerCase();
  }
  if (!/^Salaire\s*:?$/i.test(label.trim())) return value;
  return value.replace(/\s*—\s*Voir le salaire de ce grade\s*→\s*$/, '').trim();
}

// The card and the detail page label the same facts differently; keep one row per label.
const DETAIL_LABELS: Record<string, string | null> = {
  'Nombre de postes': 'Postes',
  'Diplômes requis': 'Diplômes',
  'Salaire estimé': 'Salaire',
  'Type de dépôt': 'Dépôt',
  'Mode de dépôt': null,
};

export function normalizeDetails(details: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(details)
    .filter(([label, value]) => DETAIL_LABELS[label] !== null && value.trim())
    .map(([label, value]) => [
      DETAIL_LABELS[label] || label,
      normalizeDetailValue(label, value.trim()),
    ])
    // Wadifa writes "Aucun poste" when the count is unpublished; showing it reads as zero openings.
    .filter(([label, value]) => !(label === 'Postes' && /^aucun\b/i.test(value))));
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
        .find('h2,h5,h4,.wf-ov')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (!value) return;
    details[label] = normalizeDetailValue(label, value);
  });

  // Current markup lists the dates in a summary table above the overview list.
  $('.wf-dates-t tr').each((_, tr) => {
    const label = decodeEntities($(tr).find('th').first().text().replace(/\s+/g, ' ').trim());
    if (!label) return;
    const value = decodeEntities(
      $(tr).find('td time, td strong').first().text().replace(/\s+/g, ' ').trim()
        || $(tr).find('td').first().text().replace(/\s+/g, ' ').trim()
    );
    if (!value) return;
    const key = /^Date limite de candidature$/i.test(label) ? 'Date limite de dépôt des candidatures' : label;
    details[key] = normalizeDetailValue(key, value);
  });

  const sourceHref = ($('a#UrlJobEmploi').attr('href') || '').trim();
  const sourceUrl = sourceHref ? absUrl(sourceHref) : null;

  const dl = details['Date limite de dépôt des candidatures'] || '';
  const dc = details['Date du concours'] || '';
  const depositDeadlineIso = dl ? endOfDayIsoUtc(dl) : null;
  const concoursDateIso = dc ? parseDdMmYyyyToIsoUtc(dc) : null;

  return {
    wadifaUrl,
    // Wadifa renders "… de 0 <grade>" when the post count is unknown; the card title is better.
    title: /\bde\s+0\s+/i.test(title) ? null : title || null,
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
  existingClassifications?: Map<string, StoredClassification>
): Promise<MatchedConcours[]> {
  resetSubrequestBudget();
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
  const known = existingClassifications ?? new Map<string, StoredClassification>();
  const toClassify: MatchedConcours[] = [];
  const alreadyClassified: MatchedConcours[] = [];

  for (const item of out) {
    const existing = known.get(item.id);
    if (existing?.aiRelevant !== undefined) {
      item.aiRelevant = existing.aiRelevant;
      item.aiReason = existing.aiReason;
      item.classificationVersion = existing.classificationVersion;
      item.classificationHash = existing.classificationHash;
      item.classificationSource = existing.classificationSource;
      item.classificationModel = existing.classificationModel;
      item.classifiedAt = existing.classifiedAt;
      alreadyClassified.push(item);
    } else {
      item.classificationVersion = CLASSIFIER_VERSION;
      item.classificationHash = await classificationContentHash(item);
      toClassify.push(item);
    }
  }
  console.log(`[wadifa] ${alreadyClassified.length} already classified, ${toClassify.length} need classification`);

  const ruleClassified: MatchedConcours[] = [];
  const ambiguous: MatchedConcours[] = [];
  const applyRuleDecision = (item: MatchedConcours, decision: Exclude<RuleDecision, { kind: 'ambiguous' }>) => {
    item.aiRelevant = decision.kind === 'accept';
    item.aiReason = decision.reason;
    item.classificationSource = 'rules';
    item.classificationModel = undefined;
    item.classifiedAt = new Date().toISOString();
    console.log(JSON.stringify({
      event: 'classification-decision',
      id: item.id,
      relevant: item.aiRelevant,
      source: 'rules',
      evidence: decision.kind === 'accept' ? decision.evidence : '',
      classifierVersion: CLASSIFIER_VERSION,
    }));
  };

  for (const item of toClassify) {
    const decision = classifyByRules(item);
    if (decision.kind === 'ambiguous') {
      ambiguous.push(item);
    } else {
      applyRuleDecision(item, decision);
      ruleClassified.push(item);
    }
  }
  console.log(`[wadifa] Rules classified ${ruleClassified.length}; ${ambiguous.length} remain ambiguous`);

  // Enrich only ambiguous listings before asking AI. This keeps subrequests bounded.
  let detailFetches = 0;
  let sourceContextFetches = 0;
  const detailedIds = new Set<string>();
  for (const item of ambiguous) {
    if (detailFetches >= 8) break;
    detailFetches++;
    try {
      const detail = await fetchWadifaDetail(item.wadifaUrl);
      detailedIds.add(item.id);
      item.sourceUrl = detail.sourceUrl;
      item.details = { ...item.details, ...detail.details };
      if (detail.title) item.title = detail.title;
      if (detail.depositDeadlineIso && !item.depositDeadlineIso) item.depositDeadlineIso = detail.depositDeadlineIso;
      if (detail.concoursDateIso && !item.concoursDateIso) item.concoursDateIso = detail.concoursDateIso;

      // Source/PDF context is only consumed by the AI filter; skip those fetches when it is disabled.
      if (detail.sourceUrl && env.OPENROUTER_API_KEY && sourceContextFetches < 3) {
        sourceContextFetches++;
        try {
          const sourceContext = await fetchSourceContext(detail.sourceUrl);
          item.classificationContext = sourceContext.text;
          item.classificationDocumentUrl = sourceContext.officialDocumentUrl;
          item.classificationDocumentDataUrl = sourceContext.officialDocumentDataUrl;
        } catch (error) {
          console.warn(`[wadifa] source context fetch failed for ${detail.sourceUrl}:`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.warn(`[wadifa] ambiguous detail fetch failed for ${item.wadifaUrl}:`, error instanceof Error ? error.message : error);
    }
  }

  // Details can make a previously ambiguous listing deterministic.
  const aiCandidates: MatchedConcours[] = [];
  for (const item of ambiguous) {
    const decision = classifyByRules(item);
    if (decision.kind === 'ambiguous') {
      aiCandidates.push(item);
    } else {
      applyRuleDecision(item, decision);
      ruleClassified.push(item);
    }
  }

  let aiFiltered = aiCandidates;
  if (aiCandidates.length > 0) {
    try {
      aiFiltered = await filterWithAI(aiCandidates, env);
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

  const classifiedById = new Map(
    [...alreadyClassified, ...ruleClassified, ...aiFiltered].map((item) => [item.id, item])
  );
  const combined = out.map((item) => classifiedById.get(item.id) || item);

  // Only fetch details for listings that either rules or AI deemed relevant.
  // This drastically reduces HTTP subrequests and avoids Cloudflare 50 subrequest limit.
  const finalOut: MatchedConcours[] = [];
  let relevantDetailFetches = 0;
  for (const item of combined) {
    if (item.aiRelevant === true && !detailedIds.has(item.id)) {
      if (relevantDetailFetches < 20) {
        relevantDetailFetches++;
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

  console.log(`[wadifa] Returning ${finalOut.length} total items (${detailFetches + relevantDetailFetches} detail pages fetched) in ${t.mark()}ms (total ${t.total()}ms) / ${subrequestsUsed()} subrequests`);
  return finalOut;
}
