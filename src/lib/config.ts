

export function parseIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Config defaults that don't depend on secrets
export const configDefaults = {
  baseUrl: 'https://www.wadifa-info.com',
  listPath: '/fr/concours-emplois-publics-maroc',
  listSortBy: 4,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  maxPages: 5,
  maxFeedItems: 30,
  cacheSeconds: 3600,
  keywords: ['developpement', 'informatique', 'informatiques', 'المعلوميات'],
  excludeKeywords: [],
  appBaseUrl: 'https://cfconcours.mouadlotfi.com',
};

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  CRON_SECRET?: string;
  UNSUBSCRIBE_SECRET?: string;
  TEST_EMAIL?: string;
  SMTP_API_KEY?: string;
  SMTP_SENDER_EMAIL?: string;
  SMTP_SENDER_NAME?: string;
  SMTP_LIST_ID?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  APP_BASE_URL?: string;
}

export function getAppBaseUrl(env: Env): string {
  return env.APP_BASE_URL || configDefaults.appBaseUrl;
}

export function mailEnabled(env: Env): boolean {
  return Boolean(env.SMTP_API_KEY && env.SMTP_SENDER_EMAIL);
}

export function subscribersEnabled(env: Env): boolean {
  return Boolean(env.SMTP_API_KEY && env.SMTP_LIST_ID);
}

export function unsubscribeEnabled(env: Env): boolean {
  return Boolean(env.UNSUBSCRIBE_SECRET);
}
