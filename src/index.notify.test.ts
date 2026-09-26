import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Env } from './lib/config';
import { loadAll, mergeAndPrune } from './lib/concours-store';
import type { MatchedConcours } from './lib/scraper';
import { flushPendingNotifications } from './index';
import { timer } from './lib/log';

function makeEnv(sqlite: Database, failClaim = false, beforeBatch?: () => void): Env {
  const prepare = (sql: string) => ({
    sql,
    params: [] as unknown[],
    all: async () => ({ results: sqlite.query(sql).all() }),
    bind: (...params: unknown[]) => ({
      sql,
      params,
    }),
  });
  return {
    DB: {
      prepare,
      batch: async (stmts: Array<{ sql: string; params: unknown[] }>) => {
        beforeBatch?.();
        return sqlite.transaction(() => stmts.map((stmt) => {
          if (failClaim && stmt.sql.startsWith('UPDATE concours SET notifiedAt')) throw new Error('D1 write failed');
          const result = sqlite.query(stmt.sql).run(...stmt.params);
          return { success: true, results: [], meta: { changes: result.changes } };
        }))();
      },
    } as unknown as D1Database,
    MAILPIT_URL: 'http://mailpit.test',
    APP_BASE_URL: 'https://concours.test',
    SMTP_LIST_ID: '7',
    SMTP_API_KEY: 'key',
  };
}

function makeDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE concours (
    id TEXT PRIMARY KEY, title TEXT, wadifaUrl TEXT, sourceUrl TEXT,
    depositDeadlineIso TEXT, concoursDateIso TEXT, details TEXT, matchReason TEXT,
    aiRelevant BOOLEAN, aiReason TEXT, classificationVersion TEXT, classificationHash TEXT,
    classificationSource TEXT, classificationModel TEXT, classifiedAt TEXT, notifiedAt TEXT
  )`);
  return sqlite;
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

function insert(sqlite: Database, item: MatchedConcours): void {
  sqlite.query('INSERT INTO concours (id, title, wadifaUrl, details, matchReason, depositDeadlineIso, aiRelevant, notifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    item.id, item.title, item.wadifaUrl, JSON.stringify(item.details), item.matchReason,
    item.depositDeadlineIso, item.aiRelevant === undefined ? null : Number(item.aiRelevant), item.notifiedAt ?? null
  );
}

const originalFetch = globalThis.fetch;

function stubNetwork(sendStatus: number): string[] {
  const messages: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('api.brevo.com')) {
      return new Response(JSON.stringify({ contacts: [{ email: 'a@example.com' }] }), { status: 200 });
    }
    if (url.includes('/api/v1/send')) {
      messages.push(String(init?.body));
      return new Response(sendStatus === 200 ? '{}' : 'boom', { status: sendStatus });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return messages;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('flushPendingNotifications', () => {
  test('sends only pending relevant listings, never resending them at the next slot', async () => {
    const sqlite = makeDb();
    const messages = stubNetwork(200);
    const env = makeEnv(sqlite);
    for (const item of [
      concours('1', true),
      concours('2', true, '2026-09-01T00:00:00.000Z'),
      concours('3', false),
      concours('4', undefined),
    ]) insert(sqlite, item);

    expect(await flushPendingNotifications(env, await loadAll(env), timer())).toBe(1);
    expect(await flushPendingNotifications(env, await loadAll(env), timer())).toBe(0);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!) as { Text: string }).toMatchObject({ Text: expect.stringContaining('https://example.com/1') });
    expect((await loadAll(env)).filter((item) => item.notifiedAt).map((item) => item.id)).toEqual(['1', '2']);
    sqlite.close();
  });

  test('does not send at all when the notification claim cannot be saved', async () => {
    const sqlite = makeDb();
    const messages = stubNetwork(200);
    insert(sqlite, concours('1', true));
    const env = makeEnv(sqlite, true);

    await expect(flushPendingNotifications(env, await loadAll(env), timer())).rejects.toThrow('D1 write failed');
    expect(messages).toHaveLength(0);
    sqlite.close();
  });

  test('does not resend after an uncertain provider failure', async () => {
    const sqlite = makeDb();
    const messages = stubNetwork(500);
    insert(sqlite, concours('1', true));
    const env = makeEnv(sqlite);

    expect(await flushPendingNotifications(env, await loadAll(env), timer())).toBe(0);
    expect(await flushPendingNotifications(env, await loadAll(env), timer())).toBe(0);
    expect(messages).toHaveLength(1);
    sqlite.close();
  });

  test('two runs with the same stale snapshot can claim a listing only once', async () => {
    const sqlite = makeDb();
    const messages = stubNetwork(200);
    insert(sqlite, concours('1', true));
    const env = makeEnv(sqlite);
    const snapshot = await loadAll(env);

    expect(await flushPendingNotifications(env, snapshot, timer())).toBe(1);
    expect(await flushPendingNotifications(env, snapshot, timer())).toBe(0);
    expect(messages).toHaveLength(1);
    sqlite.close();
  });

  test('a missing notification column prevents a send', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE concours (
      id TEXT PRIMARY KEY, title TEXT, wadifaUrl TEXT, details TEXT,
      matchReason TEXT, depositDeadlineIso TEXT, aiRelevant BOOLEAN
    )`);
    sqlite.query('INSERT INTO concours (id, title, wadifaUrl, details, matchReason, aiRelevant) VALUES (?, ?, ?, ?, ?, ?)').run(
      '1', 'Développeur', 'https://example.com/1', '{}', 'dev', 1
    );
    const messages = stubNetwork(200);
    const env = makeEnv(sqlite);

    await expect(flushPendingNotifications(env, await loadAll(env), timer())).rejects.toThrow();
    expect(messages).toHaveLength(0);
    sqlite.close();
  });

  test('a stale scrape cannot erase a notification claimed while merging', async () => {
    const sqlite = makeDb();
    insert(sqlite, concours('1', true));
    const env = makeEnv(sqlite, false, () => {
      sqlite.query('UPDATE concours SET notifiedAt = ? WHERE id = ?').run('2026-09-01T00:00:00.000Z', '1');
    });

    await mergeAndPrune([concours('1', true)], env);

    expect((await loadAll(env))[0]?.notifiedAt).toBe('2026-09-01T00:00:00.000Z');
    sqlite.close();
  });

  test('a failed merge is not reported as saved', async () => {
    const sqlite = makeDb();
    const env = makeEnv(sqlite, false, () => { throw new Error('D1 merge failed'); });

    await expect(mergeAndPrune([concours('1', true)], env)).rejects.toThrow('D1 merge failed');
    expect((await loadAll(env))).toEqual([]);
    sqlite.close();
  });
});
