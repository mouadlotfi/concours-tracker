import { describe, expect, test } from 'bun:test';
import type { Env } from './config';
import type { MatchedConcours } from './scraper';
import { notifySubscribers, toMailpitMessages } from './mailer';

function concours(id: string, deadline: string | null): MatchedConcours {
  return {
    id,
    wadifaUrl: `https://example.com/${id}`,
    sourceUrl: null,
    title: id,
    matchReason: 'dev',
    depositDeadlineIso: deadline,
    concoursDateIso: null,
    details: {},
  };
}

describe('toMailpitMessages', () => {
  test('maps a single-recipient payload', () => {
    const messages = toMailpitMessages({
      sender: { email: 'from@example.com', name: 'Concours' },
      to: [{ email: 'to@example.com' }],
      subject: 'Nouveau concours',
      htmlContent: '<p>hi</p>',
      textContent: 'hi',
    });

    expect(messages).toEqual([
      {
        From: { Email: 'from@example.com', Name: 'Concours' },
        To: [{ Email: 'to@example.com' }],
        Subject: 'Nouveau concours',
        HTML: '<p>hi</p>',
        Text: 'hi',
      },
    ]);
  });

  test('expands messageVersions into one message each', () => {
    const messages = toMailpitMessages({
      sender: { email: 'from@example.com' },
      subject: 'base subject',
      htmlContent: '<p>base</p>',
      textContent: 'base',
      messageVersions: [
        { to: [{ email: 'a@example.com' }], subject: 'A' },
        { to: [{ email: 'b@example.com' }], htmlContent: '<p>b</p>' },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      To: [{ Email: 'a@example.com' }],
      Subject: 'A',
      HTML: '<p>base</p>',
    });
    expect(messages[1]).toMatchObject({
      To: [{ Email: 'b@example.com' }],
      Subject: 'base subject',
      HTML: '<p>b</p>',
    });
  });
});

describe('notifySubscribers', () => {
  test('orders concours nearest deadline first and sinks missing deadlines', async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      await notifySubscribers(
        [{ email: 'a@example.com' }],
        [concours('FAR', '2026-12-01T00:00:00.000Z'), concours('NONE', null), concours('NEAR', '2026-10-01T00:00:00.000Z')],
        { MAILPIT_URL: 'http://mailpit.test', APP_BASE_URL: 'http://base.test' } as Env
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const html = JSON.parse(bodies[0]!) as { HTML: string };
    const order = ['NEAR', 'FAR', 'NONE'].map((t) => html.HTML.indexOf(t));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });
});
