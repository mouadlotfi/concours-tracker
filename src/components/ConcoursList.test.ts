import { expect, test } from 'bun:test';

import type { MatchedConcours } from '../lib/scraper';
import { ConcoursList, selectPinnedItems } from './ConcoursList';

function concours(id: string, deadline: string | null): MatchedConcours {
  return {
    id,
    title: id,
    wadifaUrl: `https://example.com/${id}`,
    sourceUrl: null,
    depositDeadlineIso: deadline,
    concoursDateIso: null,
    details: {},
    matchReason: 'test',
  };
}

test('pins deadlines through the next three business days and keeps them out of the sortable list', () => {
  const now = new Date('2026-07-31T10:00:00.000Z');
  const items = [
    concours('friday', '2026-07-31T23:59:59.999Z'),
    concours('weekend', '2026-08-01T23:59:59.999Z'),
    concours('monday', '2026-08-03T23:59:59.999Z'),
    concours('tuesday', '2026-08-04T23:59:59.999Z'),
    concours('wednesday', '2026-08-05T23:59:59.999Z'),
    concours('thursday', '2026-08-06T23:59:59.999Z'),
    concours('unknown-deadline', null),
  ];

  expect(selectPinnedItems(items, now).map((item) => item.id)).toEqual(['friday', 'monday', 'tuesday', 'wednesday']);

  const markup = String(ConcoursList({
    items,
    maxItems: 10,
    now,
  }));

  const pinned = markup.slice(markup.indexOf('class="pinnedBlock"'), markup.indexOf('class="sortBar"'));
  const regular = markup.slice(markup.indexOf('id="concours-container"'));

  expect(pinned).toContain('friday');
  expect(pinned).toContain('monday');
  expect(pinned).toContain('tuesday');
  expect(pinned).toContain('wednesday');
  expect(pinned).not.toContain('weekend');
  expect(pinned).not.toContain('thursday');
  expect(regular).not.toContain('friday');
  expect(regular).not.toContain('monday');
  expect(regular).not.toContain('tuesday');
  expect(regular).not.toContain('wednesday');

  expect(String(ConcoursList({ items: [], maxItems: 10 }))).not.toContain('sortBar');
  expect(String(ConcoursList({ items: [concours('only', '2026-08-03T23:59:59.999Z')], maxItems: 10, now }))).not.toContain('sortBar');
});
