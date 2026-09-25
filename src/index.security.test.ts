import { afterEach, describe, expect, test } from 'bun:test';
import type { Env } from './lib/config';
import { app } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Replace fetch with a recorder, so a rejected request can prove it made no outbound call. */
function stubNetwork(): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    return new Response('', { status: 500 });
  }) as typeof fetch;
  return calls;
}

const baseEnv = {
  MAILPIT_URL: 'http://mailpit.test',
  SMTP_API_KEY: 'key',
  SMTP_LIST_ID: '7',
  UNSUBSCRIBE_SECRET: 'unsub-secret',
  APP_BASE_URL: 'https://concours.test',
} as unknown as Env;

function subscribe(env: Env) {
  return app.request(
    'http://localhost/api/subscribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', turnstileToken: 'token' }),
    },
    env
  );
}

describe('GET /api/refresh fails closed', () => {
  test('rejects when CRON_SECRET is not configured', async () => {
    const calls = stubNetwork();
    const res = await app.request('http://localhost/api/refresh', {}, baseEnv);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('rejects a mismatched secret', async () => {
    const calls = stubNetwork();
    const res = await app.request(
      'http://localhost/api/refresh?secret=wrong',
      {},
      { ...baseEnv, CRON_SECRET: 'right' } as unknown as Env
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/subscribe fails closed without Turnstile', () => {
  test('rejects when neither Turnstile key is set', async () => {
    const calls = stubNetwork();
    const res = await subscribe(baseEnv);
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(0);
  });

  test('rejects when the site key is missing', async () => {
    const calls = stubNetwork();
    const res = await subscribe({ ...baseEnv, TURNSTILE_SECRET_KEY: 'secret' } as unknown as Env);
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(0);
  });
});