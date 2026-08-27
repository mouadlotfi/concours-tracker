import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from './config';
import { unsubscribeEnabled } from './config';

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function createUnsubscribeToken(email: string, env: Env): string {
  if (!unsubscribeEnabled(env)) {
    throw new Error('UNSUBSCRIBE_SECRET not set');
  }
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(payloadB64, env.UNSUBSCRIBE_SECRET!);
  return `${payloadB64}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, env: Env): { ok: true; email: string } | { ok: false } {
  if (!unsubscribeEnabled(env)) return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const payloadB64 = parts[0] || '';
  const sig = parts[1] || '';
  if (!payloadB64 || !sig) return { ok: false };

  const expected = sign(payloadB64, env.UNSUBSCRIBE_SECRET!);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };
  if (!timingSafeEqual(a, b)) return { ok: false };

  try {
    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadRaw) as { email?: unknown };
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    if (!email) return { ok: false };
    return { ok: true, email };
  } catch {
    return { ok: false };
  }
}
