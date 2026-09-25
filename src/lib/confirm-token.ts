import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from './config';
import { confirmSecret } from './config';

/** Confirmation links expire after 48 hours. */
export const CONFIRM_TTL_SECONDS = 48 * 60 * 60;

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Create a short-lived, purpose-bound token for a double opt-in confirmation link.
 * The `purpose` field stops an unsubscribe token from being replayed as a confirmation.
 */
export function createConfirmToken(email: string, env: Env, now: Date = new Date()): string {
  const secret = confirmSecret(env);
  if (!secret) {
    throw new Error('SUBSCRIBE_CONFIRM_SECRET not set');
  }
  const payload = {
    email,
    purpose: 'confirm',
    iat: Math.floor(now.getTime() / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type ConfirmTokenResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyConfirmToken(
  token: string,
  env: Env,
  now: Date = new Date()
): ConfirmTokenResult {
  const secret = confirmSecret(env);
  if (!secret) return { ok: false, reason: 'invalid' };

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const payloadB64 = parts[0] || '';
  const sig = parts[1] || '';
  if (!payloadB64 || !sig) return { ok: false, reason: 'invalid' };

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'invalid' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };

  try {
    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadRaw) as { email?: unknown; purpose?: unknown; iat?: unknown };

    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    if (!email) return { ok: false, reason: 'invalid' };
    if (parsed.purpose !== 'confirm') return { ok: false, reason: 'invalid' };

    const iat = typeof parsed.iat === 'number' ? parsed.iat : 0;
    const ageSeconds = Math.floor(now.getTime() / 1000) - iat;
    if (ageSeconds > CONFIRM_TTL_SECONDS) return { ok: false, reason: 'expired' };

    return { ok: true, email };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
