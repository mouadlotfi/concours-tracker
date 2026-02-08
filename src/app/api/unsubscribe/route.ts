import { z } from 'zod';

import { brevoRemoveContact } from '@/lib/brevo';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token';

export const runtime = 'nodejs';

const Schema = z.object({
  token: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    // Keep the same behavior as the old API: return HTTP 200 with ok=false.
    return Response.json({ ok: false, message: 'Invalid token.' });
  }

  const v = verifyUnsubscribeToken(parsed.data.token);
  if (!v.ok) {
    return Response.json({ ok: false, message: 'Invalid token.' });
  }

  const ok = await brevoRemoveContact(v.email);
  if (ok) return Response.json({ ok: true, message: 'Desabonne avec succes.' });
  return Response.json({ ok: false, message: 'Echec desabonnement.' });
}
