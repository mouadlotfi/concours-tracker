import type { Env } from './config';
import { getNotifyHours, getNotifyTimezone } from './config';

/** Local hour (0-23) for an instant in the given IANA timezone. */
export function localHour(now: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(formatted, 10);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/**
 * Whether the current local time falls inside a configured notification slot.
 * The IANA timezone handles offset changes automatically.
 */
export function isNotifySlot(now: Date, env: Env): boolean {
  return getNotifyHours(env).includes(localHour(now, getNotifyTimezone(env)));
}
