import { html } from 'hono/html';
import type { MatchedConcours } from '../lib/scraper';

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  const ymd = iso.split('T')[0];
  const parts = ymd.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function businessDayCutoff(now: Date): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let remainingDays = 3;

  while (remainingDays > 0) {
    cutoff.setUTCDate(cutoff.getUTCDate() + 1);
    if (isWeekday(ymd(cutoff))) remainingDays--;
  }

  return ymd(cutoff);
}

export function selectPinnedItems(items: MatchedConcours[], now: Date): MatchedConcours[] {
  const today = ymd(now);
  const cutoff = businessDayCutoff(now);

  return items
    .filter((item) => {
      const deadline = item.depositDeadlineIso?.slice(0, 10);
      return deadline !== undefined && isWeekday(deadline) && deadline >= today && deadline <= cutoff;
    })
    .sort((a, b) => a.depositDeadlineIso!.localeCompare(b.depositDeadlineIso!));
}

function renderItem(it: MatchedConcours, pinned = false) {
  return html`
    <article
      class="item${pinned ? ' itemPinned' : ''}"
      data-limite="${it.depositDeadlineIso || ''}"
      data-concours="${it.concoursDateIso || ''}"
    >
      <div class="itemMain">
        <div class="itemTitleRow">
          <h3 class="itemTitle">
            <a
              class="itemTitleLink"
              href="${it.sourceUrl || it.wadifaUrl}"
              target="_blank"
              rel="noreferrer noopener"
            >
              ${it.title}
            </a>
          </h3>
          <span class="pill pillDeadline">Date limite de dépôt: ${fmtDate(it.depositDeadlineIso)}</span>
        </div>
        <div class="itemMeta">
          <span class="metaGroup">
            <span class="metaKey">Administration</span>
            <span class="metaVal">
              ${it.details['Administration qui recrute'] || it.details['Administration qui recrute :'] || 'n/a'}
            </span>
          </span>
          ${it.concoursDateIso ? html`<span class="pill">Date du concours: ${fmtDate(it.concoursDateIso)}</span>` : ''}

          ${it.aiRelevant === false ? html`
            <span class="pill" style="color: #dc2626; background: rgba(220, 38, 38, 0.1); border-color: rgba(220, 38, 38, 0.2);" title="${it.aiReason || ''}">
              ⚠️ Masqué (Non lié au dev web)
            </span>
          ` : ''}
        </div>

        <div class="itemLinks">
          ${it.sourceUrl ? html`
            <a
              class="linkBtn"
              href="${it.sourceUrl}"
              target="_blank"
              rel="noreferrer noopener"
            >
              Lien du concours
            </a>
          ` : ''}
        </div>
      </div>

      <details class="details">
        <summary class="summary">Détails du concours</summary>
        <div class="detailsGrid">
          ${Object.entries(it.details || {})
            .filter(([k, v]) => k && v)
            .slice(0, 20)
            .map(([k, v]) => html`
              <div class="detailRow">
                <div class="detailK">${k}</div>
                <div class="detailV">${v}</div>
              </div>
            `)}
        </div>
      </details>
    </article>
  `;
}

export function compareConcoursDates(
  aDate: string | null | undefined,
  bDate: string | null | undefined,
  direction: 'asc' | 'desc'
): number {
  const da = aDate || '';
  const db = bDate || '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return direction === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
}

export const ConcoursList = ({
  items,
  maxItems,
  now = new Date(),
}: {
  items: MatchedConcours[];
  maxItems: number;
  now?: Date;
}) => {
  const displayItems = items.slice(0, maxItems);
  const pinnedItems = selectPinnedItems(displayItems, now);
  const pinnedIds = new Set(pinnedItems.map((item) => item.id));
  const regularItems = displayItems.filter((item) => !pinnedIds.has(item.id));

  return html`
    ${pinnedItems.length ? html`
      <div class="pinnedBlock">
        <div class="list">${pinnedItems.map((item) => renderItem(item, true))}</div>
      </div>
    ` : ''}

    ${regularItems.length ? html`
      <div class="sortBar">
        <span class="sortLabel">Trier par</span>
        <button type="button" class="sortBtn sortBtnActive" id="sort-limite" onclick="toggleSort('limite')">
          Date limite de dépôt<span class="sortArrow" id="sort-limite-arrow"> ↑</span>
        </button>
        <button type="button" class="sortBtn" id="sort-concours" onclick="toggleSort('concours')">
          Date du concours<span class="sortArrow" id="sort-concours-arrow"></span>
        </button>
      </div>

      <div class="list" id="concours-container">
        ${regularItems.map((it) => renderItem(it))}
      </div>

      <script>
      let currentSort = 'limite';
      let currentDir = 'asc';

      function toggleSort(key) {
        const container = document.getElementById('concours-container');
        const items = Array.from(container.children);
        
        const btnLimite = document.getElementById('sort-limite');
        const btnConcours = document.getElementById('sort-concours');
        const arrowLimite = document.getElementById('sort-limite-arrow');
        const arrowConcours = document.getElementById('sort-concours-arrow');

        if (currentSort === key) {
          currentDir = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = key;
          currentDir = 'asc';
        }

        if (currentSort === 'limite') {
          btnLimite.classList.add('sortBtnActive');
          btnConcours.classList.remove('sortBtnActive');
          arrowLimite.textContent = currentDir === 'asc' ? ' ↑' : ' ↓';
          arrowConcours.textContent = '';
        } else if (currentSort === 'concours') {
          btnConcours.classList.add('sortBtnActive');
          btnLimite.classList.remove('sortBtnActive');
          arrowConcours.textContent = currentDir === 'asc' ? ' ↑' : ' ↓';
          arrowLimite.textContent = '';
        }

        items.sort((a, b) => {
          const da = a.dataset[key] || '';
          const db = b.dataset[key] || '';
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return currentDir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
        });
        
        items.forEach(it => container.appendChild(it));
      }
      </script>
    ` : ''}
  `;
};
