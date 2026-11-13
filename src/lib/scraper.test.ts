import { expect, test } from 'bun:test';
import * as cheerio from 'cheerio';

import type { Env } from './config';
import { loadAll, mergeConcours } from './concours-store';
import { fetchWadifaDetail, listWadifaItems, normalizeDetailValue, normalizeDetails, parseListCard, type MatchedConcours } from './scraper';

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

test('collapses duplicate detail labels and hides redundant application-mode rows', () => {
  expect(normalizeDetails({
    Postes: '2 postes',
    'Nombre de postes': '2 postes',
    'Diplômes': 'Diplôme de Technicien',
    'Diplômes requis': 'Diplôme de Technicien Spécialisé',
    'Salaire estimé': '5,200 – 7,100 DH',
    'Type de dépôt': 'Dépôt électronique du dossier de candidature',
    'Mode de dépôt': 'Dépôt électronique',
    'Région': 'Casablanca-Settat',
    'Champ vide': '   ',
  })).toEqual({
    Postes: '2 postes',
    'Diplômes': 'Diplôme de Technicien Spécialisé',
    'Salaire': '5,200 – 7,100 DH',
    'Dépôt': 'Électronique',
    'Région': 'Casablanca-Settat',
  });
});

test('reduces the submission channel to Papier or Électronique', () => {
  expect(normalizeDetails({
    'Type de dépôt': 'Dépôt papier du dossier de candidature — préparer le dossier →',
  })).toEqual({ 'Dépôt': 'Papier' });
  expect(normalizeDetails({ 'Type de dépôt': 'Dépôt électronique du dossier de candidature' }))
    .toEqual({ 'Dépôt': 'Électronique' });
  expect(normalizeDetails({ 'Type de dépôt': 'Dépôt sur place' })).toEqual({ 'Dépôt': 'Dépôt sur place' });
});

test('drops the "Aucun poste" placeholder instead of showing zero openings', () => {
  expect(normalizeDetails({ 'Nombre de postes': 'Aucun poste', Postes: 'Aucun poste' })).toEqual({});
  expect(normalizeDetails({ Postes: 'Aucun poste précisé' })).toEqual({});
  expect(normalizeDetails({ Postes: '3 postes' })).toEqual({ Postes: '3 postes' });
});

test('reads the current nested card markup (title link inside the card)', () => {
  const $ = cheerio.load(`
    <div class="job-listing">
      <img class="wf-emp-logo" alt="Ministère de l'Intérieur">
      <h3 class="job-listing-title"><a class="wf-card-link" href="/fr/176907/x">Techniciens 3ème grade informatique</a>
        <span class="wf-fresh-new">Nouveau</span></h3>
      <ul class="job-listing-footer">
        <li> 7 postes</li>
        <li><a class="diplomas">Licence</a></li>
        <li><a class="speciliteList">développement informatique</a></li>
        <li><time class="wf-datechip wf-datechip-orange" title="Date limite : 19/11/2026">15 jours</time></li>
        <li><span class="wf-datechip wf-datechip-green">Concours : 28/11/2026</span></li>
      </ul>
    </div>
  `);
  const parsed = parseListCard($('.job-listing'));

  expect(parsed.title).toBe('Techniciens 3ème grade informatique');
  expect(parsed.administration).toBe("Ministère de l'Intérieur");
  expect(parsed.posts).toBe('7 postes');
  expect(parsed.diplomas).toBe('Licence');
  expect(parsed.specialties).toBe('développement informatique');
  expect(parsed.depositDeadlineIso).toBe('2026-11-19T23:59:59.999Z');
  expect(parsed.concoursDateIso).toBe('2026-11-28T00:00:00.000Z');
});

test('reads the red deadline chip used once the deadline closes in', () => {
  const $ = cheerio.load(`
    <div class="job-listing">
      <h3 class="job-listing-title"><a href="/fr/146601/x">Responsable supervision</a></h3>
      <li><time class="wf-datechip wf-datechip-red" datetime="2026-11-09" title="Date limite : 09/11/2026">5 jours restants</time></li>
    </div>
  `);

  expect(parseListCard($('.job-listing')).depositDeadlineIso).toBe('2026-11-09T23:59:59.999Z');
});

test('skips site-wide promo links that appear before the card for the same listing', async () => {
  const originalFetch = globalThis.fetch;
  const firstPage = `
    <div class="wf-cbar"><a href="/fr/176892/promo?utm_source=site">8 360 postes de professeurs Voir →</a></div>
    <div class="job-listing">
      <img class="wf-emp-logo" alt="Ministère de l'Education Nationale">
      <h3 class="job-listing-title"><a class="wf-card-link" href="/fr/176892/real">8360 Professeur du collégial</a></h3>
      <ul class="job-listing-footer">
        <li>8360 postes</li>
        <li><time class="wf-datechip wf-datechip-orange" title="Date limite : 19/11/2026">15 jours restants</time></li>
      </ul>
    </div>
  `;
  globalThis.fetch = (async () => new Response(firstPage)) as typeof fetch;
  try {
    const items = await listWadifaItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('8360 Professeur du collégial');
    expect(items[0].administration).toBe("Ministère de l'Education Nationale");
    expect(items[0].posts).toBe('8360 postes');
    expect(items[0].depositDeadlineIso).toBe('2026-11-19T23:59:59.999Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reads the current detail markup (wf-ov values and dates table)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`
    <h1>Concours de recrutement de 2 Techniciens</h1>
    <table class="wf-dates-t"><tbody>
      <tr><th>Date de publication</th><td><time datetime="2026-11-04">04/11/2026</time></td></tr>
      <tr><th>Date limite de candidature</th><td><strong>19/11/2026</strong>
        <span class="wf-dates-left">15 jours restants</span></td></tr>
    </tbody></table>
    <div id="InfosJob"><div class="job-overview-inner"><ul>
      <li><span>Nombre de postes</span><div class="wf-ov">2 postes</div></li>
      <li><span>Région</span><div class="wf-ov">Casablanca-Settat</div></li>
    </ul></div></div>
  `)) as typeof fetch;
  try {
    const detail = await fetchWadifaDetail('https://www.wadifa-info.com/fr/176907/');
    expect(detail.details['Nombre de postes']).toBe('2 postes');
    expect(detail.details['Région']).toBe('Casablanca-Settat');
    expect(detail.details['Date limite de dépôt des candidatures']).toBe('19/11/2026');
    expect(detail.depositDeadlineIso).toBe('2026-11-19T23:59:59.999Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ignores the 0-post placeholder in detail titles', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    '<h1>Concours de recrutement de 0 Maître de conférences grade a</h1>'
  )) as typeof fetch;
  try {
    const detail = await fetchWadifaDetail('https://www.wadifa-info.com/fr/176900/');
    expect(detail.title).toBeNull();
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
