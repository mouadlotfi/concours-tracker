import { afterEach, describe, expect, test } from 'bun:test';
import type { Env } from './lib/config';
import { app } from './index';

const env = {
  MAILPIT_URL: 'http://mailpit.test',
  UNSUBSCRIBE_SECRET: 'test-secret',
  SMTP_API_KEY: 'test-key',
  SMTP_LIST_ID: '7',
  APP_BASE_URL: 'https://concours.test',
  TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-turnstile-site',
} as unknown as Env;

const originalFetch = globalThis.fetch;

type Sent = { url: string; body: string };

/** Stub Turnstile, Brevo and Mailpit so the routes can be driven end to end. */
function stubNetwork(sent: Sent[]): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';

    if (url.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes('api.brevo.com') && method === 'GET') {
      return new Response('', { status: 404 }); // not yet in the list
    }
    if (url.includes('api.brevo.com') && method === 'POST') {
      sent.push({ url, body });
      return new Response('{}', { status: 201 });
    }
    if (url.includes('/api/v1/send')) {
      sent.push({ url, body });
      return new Response('{}', { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function subscribe(email: string) {
  return app.request(
    'http://localhost/api/subscribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken: 'token' }),
    },
    env
  );
}

/** Pull the confirmation token out of the Mailpit message body we captured. */
function tokenFrom(sent: Sent[]): string {
  const raw = sent.find((s) => s.url.includes('/api/v1/send'))!.body;
  const { HTML } = JSON.parse(raw) as { HTML: string };
  return decodeURIComponent(HTML.match(/\/confirm\?token=([^"&]+)/)![1]!);
}

describe('double opt-in subscription', () => {
  test('subscribe sends a confirmation email without adding the contact', async () => {
    const sent: Sent[] = [];
    stubNetwork(sent);

    const res = await subscribe('user@example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Vérifiez votre boîte mail pour confirmer votre abonnement.',
    });

    // One email (the confirmation), and no Brevo contact write yet.
    const emails = sent.filter((s) => s.url.includes('/api/v1/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0]!.body).toContain('Confirmez votre abonnement');
    expect(emails[0]!.body).toContain('/confirm?token=');
    expect(sent.some((s) => s.url.includes('api.brevo.com'))).toBe(false);
  });

  test('confirming the token adds the contact and sends the welcome email', async () => {
    const sent: Sent[] = [];
    stubNetwork(sent);

    await subscribe('user@example.com');
    const token = tokenFrom(sent);

    const emailCountBefore = sent.filter((s) => s.url.includes('/api/v1/send')).length;
    const confirmed = await app.request(
      'http://localhost/api/confirm',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) },
      env
    );

    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ ok: true, message: 'Abonnement confirmé avec succès.' });

    // Brevo contact write happened, plus a welcome email.
    expect(sent.some((s) => s.url.includes('api.brevo.com') && s.body.includes('user@example.com'))).toBe(true);
    const emails = sent.filter((s) => s.url.includes('/api/v1/send'));
    expect(emails.length).toBe(emailCountBefore + 1);
    expect(emails[emails.length - 1]!.body).toContain('Abonnement confirm');
  });

  test('rejects a tampered confirmation token', async () => {
    const sent: Sent[] = [];
    stubNetwork(sent);

    await subscribe('user@example.com');
    const token = tokenFrom(sent);

    const res = await app.request(
      'http://localhost/api/confirm',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.slice(0, -4) + 'abcd' }) },
      env
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
    // No contact write for an invalid token.
    expect(sent.some((s) => s.url.includes('api.brevo.com'))).toBe(false);
  });

  test('an already-subscribed address gets the same generic response and no email', async () => {
    const sent: Sent[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('challenges.cloudflare.com')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (url.includes('api.brevo.com') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ listIds: [7] }), { status: 200 });
      }
      sent.push({ url, body: '' });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await subscribe('user@example.com');
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Vérifiez votre boîte mail pour confirmer votre abonnement.',
    });
    expect(sent).toHaveLength(0);
  });
});
