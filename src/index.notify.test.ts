import { afterEach, describe, expect, test } from 'bun:test';
import type { Env } from './lib/config';
import type { MatchedConcours } from './lib/scraper';
import { flushPendingNotifications } from './index';
import { timer } from './lib/log';

type Update = { sql: string; params: unknown[] };

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    MAILPIT_URL: 'http://mailpit.test',
    APP_BASE_URL: 'https://concours.test',
    SMTP_LIST_ID: '7',
    SMTP_API_KEY: 'key',
  } as unknown as Env;
}

/** Minimal D1 stand-in that records the UPDATEs issued by markNotified. */
function makeDb(updates: Update[]): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({ sql, params }),
    }),
    batch: async (stmts: Array<{ sql: string; params: unknown[] }>) => {
      for (const stmt of stmts) updates.push(stmt);
      return [];
    },
  } as unknown as D1Database;
}

function concours(id: string, aiRelevant: boolean | undefined, notifiedAt?: string): MatchedConcours {
  return {
    id,
    wadifaUrl: `https://example.com/${id}`,
    sourceUrl: null,
    title: id,
    matchReason: 'dev',
    aiRelevant,
    notifiedAt,
    depositDeadlineIso: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
    concoursDateIso: null,
    details: {},
  };
}

const originalFetch = globalThis.fetch;

/** Stub the Brevo subscriber lookup and the Mailpit send (with a chosen status). */
function stubNetwork(sendStatus: number): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('api.brevo.com')) {
      return new Response(JSON.stringify({ contacts: [{ email: 'a@example.com' }] }), { status: 200 });
    }
    if (url.includes('/api/v1/send')) {
      return new Response(sendStatus === 200 ? '{}' : 'boom', { status: sendStatus });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('flushPendingNotifications', () => {
  test('sends pending relevant listings and marks exactly those notified', async () => {
    const updates: Update[] = [];
    stubNetwork(200);

    const items = [
      concours('1', true), // pending -> notified
      concours('2', true, '2026-09-01T00:00:00.000Z'), // already notified -> skipped
      concours('3', false), // not relevant -> skipped
      concours('4', undefined), // unclassified -> skipped
    ];

    const count = await flushPendingNotifications(makeEnv(makeDb(updates)), items, timer());

    expect(count).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toContain('UPDATE concours SET notifiedAt');
    expect(updates[0]!.params[1]).toBe('1');
  });

  test('leaves listings unmarked when the send fails, so the next slot retries', async () => {
    const updates: Update[] = [];
    stubNetwork(500);

    const count = await flushPendingNotifications(
      makeEnv(makeDb(updates)),
      [concours('1', true)],
      timer()
    );

    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
  });

  test('does nothing when there is nothing pending', async () => {
    const updates: Update[] = [];
    stubNetwork(200);

    const count = await flushPendingNotifications(
      makeEnv(makeDb(updates)),
      [concours('1', true, '2026-09-01T00:00:00.000Z')],
      timer()
    );

    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
