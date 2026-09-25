// Config defaults that don't depend on secrets
export const configDefaults = {
  baseUrl: 'https://www.wadifa-info.com',
  listPath: '/fr/concours-emplois-publics-maroc',
  listSortBy: 4,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  maxPages: 5,
  maxFeedItems: 30,
  cacheSeconds: 3600,
  appBaseUrl: 'https://concours.mouadlotfi.com',
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
  MAILPIT_URL?: string;
  SUBSCRIBE_CONFIRM_SECRET?: string;
  NOTIFY_HOURS?: string;
  NOTIFY_TIMEZONE?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  APP_BASE_URL?: string;
}

export function getAppBaseUrl(env: Env): string {
  return env.APP_BASE_URL || configDefaults.appBaseUrl;
}

export function mailEnabled(env: Env): boolean {
  if (env.MAILPIT_URL) return true;
  return Boolean(env.SMTP_API_KEY && env.SMTP_SENDER_EMAIL);
}

/** Whether outgoing mail is captured by a local Mailpit instance instead of Brevo. */
export function mailpitEnabled(env: Env): boolean {
  return Boolean(env.MAILPIT_URL);
}

/** Whether a real Turnstile pair is configured; the subscribe route fails closed without it. */
export function turnstileEnabled(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export function subscribersEnabled(env: Env): boolean {
  return Boolean(env.SMTP_API_KEY && env.SMTP_LIST_ID);
}

export function unsubscribeEnabled(env: Env): boolean {
  return Boolean(env.UNSUBSCRIBE_SECRET);
}

/** Secret used to sign subscription-confirmation links; falls back to the unsubscribe secret. */
export function confirmSecret(env: Env): string | undefined {
  return env.SUBSCRIBE_CONFIRM_SECRET || env.UNSUBSCRIBE_SECRET;
}

/** Local hours during which notification emails may be sent (default: 08:00 and 18:00). */
const defaultNotifyHours = [8, 18];

export function getNotifyHours(env: Env): number[] {
  const raw = env.NOTIFY_HOURS;
  if (!raw) return [...defaultNotifyHours];
  const hours = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return hours.length ? hours : [...defaultNotifyHours];
}

export function getNotifyTimezone(env: Env): string {
  return env.NOTIFY_TIMEZONE || 'Africa/Casablanca';
}
