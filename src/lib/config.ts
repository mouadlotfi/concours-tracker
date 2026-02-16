import { resolve } from 'node:path';

function parseIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  baseUrl: process.env.BASE_URL || 'https://www.wadifa-info.com',
  listPath: process.env.LIST_PATH || '/fr/concours-emplois-publics-maroc',
  listSortBy: parseIntOr(process.env.LIST_SORT_BY, 4),
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  maxPages: parseIntOr(process.env.MAX_PAGES, 5),
  maxFeedItems: parseIntOr(process.env.MAX_FEED_ITEMS, 30),
  keywords: parseCsv(
    process.env.KEYWORDS ||
      'developpement,informatique'
  ),
  excludeKeywords: parseCsv(process.env.EXCLUDE_KEYWORDS || ''),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  cronSecret: process.env.CRON_SECRET || '',
  cacheSeconds: parseIntOr(process.env.CACHE_SECONDS, 3600),
  /** Cron expression for the background refresh scheduler (default: every 5 hours). */
  refreshCron: process.env.REFRESH_CRON || '0 */5 * * *',
  /** Directory for persistent data (concours JSON file). */
  dataDir: resolve(process.env.DATA_DIR || './data'),
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || '',
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || '',
    senderName: process.env.BREVO_SENDER_NAME || 'Concours Developpement Web',
    listId: parseIntOr(process.env.BREVO_LIST_ID, 0),
  },
};

export function mailEnabled(): boolean {
  return Boolean(config.brevo.apiKey && config.brevo.senderEmail);
}

export function subscribersEnabled(): boolean {
  return Boolean(config.brevo.apiKey && config.brevo.listId);
}

export function unsubscribeEnabled(): boolean {
  return Boolean(config.unsubscribeSecret);
}
