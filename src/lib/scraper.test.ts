import { expect, test } from 'bun:test';
import * as cheerio from 'cheerio';

import type { Env } from './config';
import { loadAll, mergeConcours } from './concours-store';
import { fetchWadifaDetail, normalizeDetailValue, parseListCard, type MatchedConcours } from './scraper';

test('removes the salary navigation label without changing amounts or other fields', () => {
  expect(normalizeDetailValue('Salaire', '5794.68 DH — Voir le salaire de ce grade →')).toBe('5794.68 DH');
  expect(normalizeDetailValue('Salaire :', '10901.92 DH — Voir le salaire de ce grade →')).toBe('10901.92 DH');
  expect(normalizeDetailValue('Salaire', '5794.68 DH')).toBe('5794.68 DH');
  expect(normalizeDetailValue('Salaire', 'Non précisé')).toBe('Non précisé');
  expect(normalizeDetailValue('Autre', '5794.68 DH — Voir le salaire de ce grade →'))
    .toBe('5794.68 DH — Voir le salaire de ce grade →');
});

test('cleans salary labels in existing stored details when loading listings', async () => {
  const env = {
    DB: {
      prepare: () => ({
        all: async () => ({
          results: [{
            id: 'salary',
            title: 'Technicien',
            wadifaUrl: 'https://example.com/salary',
            details: JSON.stringify({
              Salaire: '5794.68 DH — Voir le salaire de ce grade →',
              Région: 'Oriental',
            }),
          }],
        }),
      }),
    },
  } as unknown as Env;
  const [item] = await loadAll(env);
  expect(item.details).toEqual({ Salaire: '5794.68 DH', Région: 'Oriental' });
});

test('scrapes the salary amount without the source navigation link', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`
    <div id="InfosJob"><div class="job-overview-inner"><ul>
      <li><span>Salaire</span><h5><strong>5794.68 DH</strong>
        — <a href="/salary">Voir le salaire de ce grade →</a></h5></li>
      <li><span>Région</span><h5>Oriental</h5></li>
    </ul></div></div>
  `)) as typeof fetch;
  try {
    const detail = await fetchWadifaDetail('https://www.wadifa-info.com/fr/105018/');
    expect(detail.details).toEqual({ Salaire: '5794.68 DH', Région: 'Oriental' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reads current Wadifa cards and does not erase stored fields', () => {
  const $ = cheerio.load(`
    <a class="job-listing">
      <img class="wf-emp-logo" alt="Ministère des Affaires étrangères">
      <h3 class="job-listing-title">Ingénieur d'etat <span class="wf-fresh-new">Nouveau</span></h3>
      <li><i class="icon-material-outline-group"></i> 16 postes</li>
      <span class="diplomas">Diplôme d Ingénieur d État</span>
      <span class="speciliteList">développement informatique</span>
      <span class="wf-datechip-orange" title="Date limite : 10/08/2026">7 jours</span>
      <span class="wf-datechip-green" title="Date du concours">27/09/2026</span>
    </a>
  `);
  const parsed = parseListCard($('a'));

  expect(parsed.administration).toBe('Ministère des Affaires étrangères');
  expect(parsed.depositDeadlineIso).toBe('2026-08-10T23:59:59.999Z');
  expect(parsed.concoursDateIso).toBe('2026-09-27T00:00:00.000Z');

  const base: MatchedConcours = {
    id: '95377',
    wadifaUrl: 'https://www.wadifa-info.com/fr/95377/Ministère-des-Affaires-étrangères-concours-de-recrutement',
    sourceUrl: null,
    title: parsed.title,
    matchReason: '',
    depositDeadlineIso: null,
    concoursDateIso: null,
    details: { 'Administration qui recrute': '', 'Date limite de dépôt des candidatures': '10/08/2026' },
  };
  const merged = mergeConcours(base, { ...base, details: { 'Administration qui recrute': '' } });

  expect(merged.details['Administration qui recrute']).toBe('Ministère des Affaires étrangères');
  expect(merged.depositDeadlineIso).toBe('2026-08-10T23:59:59.999Z');
});
