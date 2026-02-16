import { z } from 'zod';

import { mailEnabled, subscribersEnabled } from '@/lib/config';
import { brevoContactExistsInList, brevoUpsertContact } from '@/lib/brevo';
import { sendWelcomeEmail } from '@/lib/mailer';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const checkLimit = rateLimit({ limit: 5, windowMs: 60_000 });

const Schema = z.object({
  email: z.string().trim().email(),
});

export async function POST(req: Request) {
  /* ── Rate limit by IP ──────────────────────────── */
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!checkLimit(ip).ok) {
    return Response.json(
      { ok: false, message: 'Too many requests. Try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, detail: 'Invalid email.' }, { status: 400 });
  }

  const email = parsed.data.email;
  if (!subscribersEnabled()) {
    return Response.json(
      { ok: false, message: 'Subscriptions not configured.' },
      { status: 500 }
    );
  }

  const alreadySubscribed = await brevoContactExistsInList(email);
  if (alreadySubscribed) {
    return Response.json(
      { ok: false, message: 'Vous êtes déjà abonné(e).' },
      { status: 409 }
    );
  }

  const ok = await brevoUpsertContact(email);
  if (!ok) {
    return Response.json(
      { ok: false, message: 'Failed to subscribe.' },
      { status: 502 }
    );
  }

  if (mailEnabled()) {
    try {
      const sent = await sendWelcomeEmail(email);
      if (!sent) {
        console.warn('[subscribe] welcome email failed');
      }
    } catch {
      console.error('[subscribe] welcome email error');
    }
  }

  return Response.json({
    ok: true,
    message: 'Abonnement confirmé avec succès.',
  });
}
