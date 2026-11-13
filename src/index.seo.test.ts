import { expect, test } from 'bun:test';
import { load } from 'cheerio';
import { app } from './index';
import { configDefaults } from './lib/config';
import type { Env } from './lib/config';

const base = configDefaults.appBaseUrl.replace(/\/+$/, '');

const details = JSON.stringify({
  'Administration qui recrute': 'Ministère de la Santé',
  'Date de publication': '13/10/2026',
  'Diplômes': 'Bac+5',
  'Région': 'Casablanca-Settat',
  'Postes': '2',
  'Date limite de dépôt des candidatures': '15/01/2027',
});

function makeEnv(rows: Record<string, unknown>[]) {
  const stmt = {
    all: async () => ({ results: rows }),
    bind: () => stmt,
  };
  return {
    DB: {
      prepare: () => stmt,
    },
  } as unknown as Env;
}

const RELEVANT = {
  id: '0',
  title: 'Concours développeur web',
  wadifaUrl: 'https://example.com/0',
  sourceUrl: 'https://example.com/src/0',
  depositDeadlineIso: '2027-01-15T23:59:59.999Z',
  concoursDateIso: '2027-02-01T00:00:00.000Z',
  details,
  matchReason: 'Développement web et applications',
  aiRelevant: 1,
  classifiedAt: '2026-11-01T10:00:00.000Z',
};

const REJECTED = {
  id: '1',
  title: 'Concours comptable',
  wadifaUrl: 'https://example.com/1',
  sourceUrl: 'https://example.com/src/1',
  depositDeadlineIso: '2027-01-20T23:59:59.999Z',
  concoursDateIso: '2027-02-05T00:00:00.000Z',
  details,
  matchReason: 'Comptabilité',
  aiRelevant: 0,
  classifiedAt: '2026-11-01T10:00:00.000Z',
};

const NO_DATE = {
  id: '2',
  title: 'Concours développeur web sans date',
  wadifaUrl: 'https://example.com/2',
  sourceUrl: 'https://example.com/src/2',
  depositDeadlineIso: '2027-01-15T23:59:59.999Z',
  concoursDateIso: '2027-02-01T00:00:00.000Z',
  details: JSON.stringify({
    'Administration qui recrute': 'X',
    'Région': 'Rabat',
  }),
  matchReason: 'Développement web et applications',
  aiRelevant: 1,
  classifiedAt: '2026-11-01T10:00:00.000Z',
};

const EXPIRED = {
  id: '3',
  title: 'Concours développeur web expiré',
  wadifaUrl: 'https://example.com/3',
  sourceUrl: 'https://example.com/src/3',
  depositDeadlineIso: '2020-01-01T00:00:00.000Z',
  concoursDateIso: null,
  details,
  matchReason: 'Développement web et applications',
  aiRelevant: 1,
  classifiedAt: '2026-11-01T10:00:00.000Z',
};

const baseRows = [RELEVANT, REJECTED, NO_DATE, EXPIRED];

test('1. Home returns 200 with meta description, canonical ending with /, alternate RSS, and WebSite JSON-LD', async () => {
  const env = makeEnv(baseRows);
  const response = await app.request('http://localhost/', {}, env);
  expect(response.status).toBe(200);

  const $ = load(await response.text());

  const description = $('meta[name="description"]').attr('content');
  expect(description).toBeDefined();
  expect(description?.trim().length).toBeGreaterThan(0);

  const canonical = $('link[rel="canonical"]').attr('href');
  expect(canonical).toBeDefined();
  expect(canonical?.endsWith('/')).toBe(true);

  const rssAlternate = $('link[rel="alternate"][type="application/rss+xml"]');
  expect(rssAlternate.length).toBeGreaterThan(0);

  const firstLdJsonText = $('script[type="application/ld+json"]').first().text();
  expect(firstLdJsonText).toBeDefined();
  expect(firstLdJsonText.trim().length).toBeGreaterThan(0);
  const ldJson = JSON.parse(firstLdJsonText);
  expect(ldJson['@type']).toBe('WebSite');
});

test('2. Home response header cache-control contains s-maxage', async () => {
  const env = makeEnv(baseRows);
  const response = await app.request('http://localhost/', {}, env);
  const cacheControl = response.headers.get('cache-control');
  expect(cacheControl).not.toBeNull();
  expect(cacheControl).toContain('s-maxage');
});

test('3. /c/0 returns 200 with title in h1, canonical ending in /c/0, JobPosting JSON-LD, and external link', async () => {
  const env = makeEnv(baseRows);
  const response = await app.request('http://localhost/c/0', {}, env);
  expect(response.status).toBe(200);

  const $ = load(await response.text());
  expect($('h1').text()).toContain('Concours développeur web');

  const canonical = $('link[rel="canonical"]').attr('href');
  expect(canonical).toBeDefined();
  expect(canonical?.endsWith('/c/0')).toBe(true);

  const scripts = $('script[type="application/ld+json"]').toArray();
  const ldJsonObjects = scripts.map((s) => {
    try {
      return JSON.parse($(s).text());
    } catch {
      return null;
    }
  });
  const jobPosting = ldJsonObjects.find((obj) => obj && obj['@type'] === 'JobPosting');

  expect(jobPosting).toBeDefined();
  expect(jobPosting['@type']).toBe('JobPosting');
  expect(jobPosting.datePosted).toBe('2026-10-13');
  expect(jobPosting.validThrough).toBe('2027-01-15T23:59:59.999Z');
  expect(jobPosting.jobLocation?.address?.addressCountry).toBe('MA');

  const externalLink = $('a[href="https://example.com/src/0"]');
  expect(externalLink.length).toBeGreaterThan(0);
});

test('4. Unknown, invalid, rejected, and expired concours return 404', async () => {
  const env = makeEnv(baseRows);

  const res999 = await app.request('http://localhost/c/999', {}, env);
  expect(res999.status).toBe(404);

  const resAbc = await app.request('http://localhost/c/abc', {}, env);
  expect(resAbc.status).toBe(404);

  const res1 = await app.request('http://localhost/c/1', {}, env);
  expect(res1.status).toBe(404);

  const resExpired = await app.request('http://localhost/c/3', {}, env);
  expect(resExpired.status).toBe(404);
});

test('5. /c/2 (no publication date) returns 200 and has no JobPosting JSON-LD', async () => {
  const env = makeEnv(baseRows);
  const response = await app.request('http://localhost/c/2', {}, env);
  expect(response.status).toBe(200);

  const $ = load(await response.text());
  const scripts = $('script[type="application/ld+json"]').toArray();
  const jobPosting = scripts
    .map((s) => {
      try {
        return JSON.parse($(s).text());
      } catch {
        return null;
      }
    })
    .find((obj) => obj && obj['@type'] === 'JobPosting');

  expect(jobPosting).toBeUndefined();
});

test('6. /sitemap.xml returns 200 XML with /c/0 loc and without /c/1', async () => {
  const env = makeEnv(baseRows);
  const response = await app.request('http://localhost/sitemap.xml', {}, env);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('xml');

  const body = await response.text();
  expect(body).toContain(`<loc>${base}/c/0</loc>`);
  expect(body).not.toContain(`<loc>${base}/c/1</loc>`);
  expect(body).not.toContain(`<loc>${base}/c/3</loc>`);
});

test('7. /confirm and /unsubscribe responses have header x-robots-tag equal to noindex', async () => {
  const env = makeEnv(baseRows);

  const resConfirm = await app.request('http://localhost/confirm', {}, env);
  expect(resConfirm.headers.get('x-robots-tag')).toBe('noindex');

  const resUnsub = await app.request('http://localhost/unsubscribe', {}, env);
  expect(resUnsub.headers.get('x-robots-tag')).toBe('noindex');
});
