import { config, subscribersEnabled } from './config';

type BrevoContact = {
  email: string;
};

function authHeaders(): HeadersInit {
  return {
    'api-key': config.brevo.apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export async function brevoUpsertContact(email: string): Promise<boolean> {
  if (!subscribersEnabled()) return false;

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      listIds: [config.brevo.listId],
      updateEnabled: true,
    }),
  });

  // Brevo returns 201 on create, 204 on update in some cases.
  if (res.ok) return true;
  const raw = await res.text().catch(() => '');
  console.error('[brevo] upsert contact failed', { status: res.status, body: raw.slice(0, 1200) });
  return false;
}

export async function brevoContactExistsInList(email: string): Promise<boolean> {
  if (!subscribersEnabled()) return false;

  const res = await fetch(
    `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
    { headers: authHeaders() }
  );

  if (!res.ok) return false;

  try {
    const data = (await res.json()) as { listIds?: number[] };
    return Array.isArray(data.listIds) && data.listIds.includes(config.brevo.listId);
  } catch {
    return false;
  }
}

export async function brevoRemoveContact(email: string): Promise<boolean> {
  if (!subscribersEnabled()) return false;

  const res = await fetch(`https://api.brevo.com/v3/contacts/lists/${config.brevo.listId}/contacts/remove`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ emails: [email] }),
  });

  if (res.ok) return true;
  const raw = await res.text().catch(() => '');
  console.error('[brevo] remove contact failed', { status: res.status, body: raw.slice(0, 1200) });
  return false;
}

/**
 * Fetch all subscribers from the Brevo list.
 * Paginates in groups of 50 until exhausted.
 */
export async function brevoListSubscribers(): Promise<BrevoContact[]> {
  if (!subscribersEnabled()) return [];
  const out: BrevoContact[] = [];

  let offset = 0;
  const pageSize = 50;
  for (;;) {
    const u = new URL(`https://api.brevo.com/v3/contacts/lists/${config.brevo.listId}/contacts`);
    u.searchParams.set('limit', String(pageSize));
    u.searchParams.set('offset', String(offset));

    const res = await fetch(u.toString(), { headers: authHeaders() });
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[brevo] list contacts failed', { status: res.status, body: raw.slice(0, 1200) });
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
