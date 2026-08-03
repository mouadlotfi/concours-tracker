import { expect, test } from 'bun:test';
import * as cheerio from 'cheerio';

import { mergeConcours } from './concours-store';
import { parseListCard, type MatchedConcours } from './scraper';

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
