import { subscribersEnabled } from './config';
import type { Env } from './config';

type emailContact = {
  email: string;
};

function authHeaders(env: Env): HeadersInit {
  return {
    'api-key': env.SMTP_API_KEY || '',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export async function emailUpsertContact(email: string, env: Env): Promise<boolean> {
  if (!subscribersEnabled(env)) return false;

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({
      email,
      listIds: [Number.parseInt(env.SMTP_LIST_ID || '0', 10)],
      updateEnabled: true,
    }),
  });

  if (res.ok) return true;
  const raw = await res.text().catch(() => '');
  console.error('[email] upsert contact failed', { status: res.status, body: raw.slice(0, 1200) });
  return false;
}

export async function emailContactExistsInList(email: string, env: Env): Promise<boolean> {
  if (!subscribersEnabled(env)) return false;

  const res = await fetch(
    `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
    { headers: authHeaders(env) }
  );

  if (!res.ok) return false;

  try {
    const data = (await res.json()) as { listIds?: number[] };
    return Array.isArray(data.listIds) && data.listIds.includes(Number.parseInt(env.SMTP_LIST_ID || '0', 10));
  } catch {
    return false;
  }
}

export async function emailRemoveContact(email: string, env: Env): Promise<boolean> {
  if (!subscribersEnabled(env)) return false;

  const res = await fetch(`https://api.brevo.com/v3/contacts/lists/${env.SMTP_LIST_ID}/contacts/remove`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ emails: [email] }),
  });

  if (res.ok) return true;
  const raw = await res.text().catch(() => '');
  console.error('[email] remove contact failed', { status: res.status, body: raw.slice(0, 1200) });
  return false;
}

export async function emailListSubscribers(env: Env): Promise<emailContact[]> {
  if (!subscribersEnabled(env)) return [];
  const out: emailContact[] = [];

  let offset = 0;
  const pageSize = 50;
  for (;;) {
    const u = new URL(`https://api.brevo.com/v3/contacts/lists/${env.SMTP_LIST_ID}/contacts`);
    u.searchParams.set('limit', String(pageSize));
    u.searchParams.set('offset', String(offset));

    const res = await fetch(u.toString(), { headers: authHeaders(env) });
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[email] list contacts failed', { status: res.status, body: raw.slice(0, 1200) });
      break;
    }

    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    const contacts = Array.isArray(parsed?.contacts) ? (parsed.contacts as any[]) : [];
    for (const c of contacts) {
      const email = typeof c?.email === 'string' ? c.email.trim() : '';
      if (email) out.push({ email });
    }

    if (contacts.length < pageSize) break;
    offset += contacts.length;
  }

  return out;
}
