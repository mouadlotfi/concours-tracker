import { expect, test } from 'bun:test';
import { load } from 'cheerio';
import { app } from './index';
import type { Env } from './lib/config';

async function home(deadlines: (string | null)[]) {
  const env = {
    DB: {
      prepare: () => ({
        all: async () => ({
          results: deadlines.map((depositDeadlineIso, index) => ({
            id: String(index),
            title: `Concours ${index}`,
            wadifaUrl: `https://example.com/${index}`,
            depositDeadlineIso,
            aiRelevant: 1,
          })),
        }),
      }),
    },
  } as unknown as Env;
  const response = await app.request('http://localhost/', {}, env);
  expect(response.status).toBe(200);
  return load(await response.text());
}

function nextWeekdayDeadline() {
  const date = new Date();
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return `${date.toISOString().slice(0, 10)}T23:59:59.999Z`;
}

test('home puts sorting beside RSS when no concours are pinned', async () => {
  const $ = await home([null]);
  expect($('.pinnedBlock').length).toBe(0);
  expect($('.sectionHeadSortable .sortBar').length).toBe(1);
  expect($('.sectionHeadSortable a[href="/feed.xml"]').length).toBe(1);
  expect($('.sortBar').length).toBe(1);
  expect($('#sort-limite').length).toBe(1);
  expect($('#sort-concours').length).toBe(1);
  expect($('#concours-container').length).toBe(1);
});

test('home keeps sorting below pinned concours', async () => {
  const $ = await home([nextWeekdayDeadline(), null]);
  expect($('.pinnedHeading').text()).toBe('Épinglés');
  expect($('.sectionHead .sortBar').length).toBe(0);
  expect($('.pinnedBlock + .sortBar').length).toBe(1);
  expect($('.sortBar').length).toBe(1);
});

test('home omits sorting for empty and pinned-only lists', async () => {
  for (const deadlines of [[], [nextWeekdayDeadline()]]) {
    const $ = await home(deadlines);
    expect($('.sortBar').length).toBe(0);
    expect($('.sectionHead a[href="/feed.xml"]').length).toBe(1);
  }
});
