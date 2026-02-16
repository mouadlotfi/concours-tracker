import { createHmac, timingSafeEqual } from 'node:crypto';

import { config, unsubscribeEnabled } from './config';

function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function sign(payloadB64: string): string {
  const h = createHmac('sha256', config.unsubscribeSecret);
  h.update(payloadB64);
  return b64urlEncode(h.digest());
}

export function createUnsubscribeToken(email: string): string {
  if (!unsubscribeEnabled()) {
    throw new Error('UNSUBSCRIBE_SECRET (or BREVO_API_KEY fallback) not set');
  }
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): { ok: true; email: string } | { ok: false } {
  if (!unsubscribeEnabled()) return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const payloadB64 = parts[0] || '';
  const sig = parts[1] || '';
  if (!payloadB64 || !sig) return { ok: false };

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };
  if (!timingSafeEqual(a, b)) return { ok: false };

  try {
    const payloadRaw = Buffer.from(b64urlDecode(payloadB64)).toString('utf8');
    const parsed = JSON.parse(payloadRaw) as { email?: unknown };
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';
    if (!email) return { ok: false };
    return { ok: true, email };
  } catch {
    return { ok: false };
  }
}
