import { html } from 'hono/html';
import type { MatchedConcours } from '../lib/scraper';

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  const ymd = iso.split('T')[0];
  const parts = ymd.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export const ConcoursList = ({
  items,
  maxItems,
}: {
  items: MatchedConcours[];
  maxItems: number;
}) => {
  const displayItems = items.slice(0, maxItems);

  return html`
    <div class="sortBar">
      <span class="sortLabel">Trier par</span>
      <button class="sortBtn sortBtnActive" id="sort-limite" onclick="toggleSort('limite')">
        Date limite de dépôt
      </button>
      <button class="sortBtn" id="sort-concours" onclick="toggleSort('concours')">
        Date du concours
      </button>
    </div>

    <div class="list" id="concours-container">
      ${displayItems.map((it) => html`
        <article class="item" data-limite="${it.depositDeadlineIso || ''}" data-concours="${it.concoursDateIso || ''}">
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
              <span class="pill">Date limite de dépôt: ${fmtDate(it.depositDeadlineIso)}</span>
            </div>
            <div class="itemMeta">
              <span class="metaGroup">
                <span class="metaKey">Administration</span>
                <span class="metaVal">
                  ${it.details['Administration qui recrute'] || it.details['Administration qui recrute :'] || 'n/a'}
                </span>
              </span>
              ${it.concoursDateIso ? html`<span class="pill">Date du concours: ${fmtDate(it.concoursDateIso)}</span>` : ''}
              
              <!-- AI Badge for transparency -->
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
      `)}
    </div>

    <script>
      let currentSort = 'limite';
      function toggleSort(key) {
        const container = document.getElementById('concours-container');
        const items = Array.from(container.children);
        
        const btnLimite = document.getElementById('sort-limite');
        const btnConcours = document.getElementById('sort-concours');
        
        if (currentSort === key) {
          return;
        }
        
        currentSort = key;
        if (key === 'limite') {
          btnLimite.classList.add('sortBtnActive');
          btnConcours.classList.remove('sortBtnActive');
          items.sort((a, b) => {
            const da = a.dataset.limite;
            const db = b.dataset.limite;
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.localeCompare(db);
          });
        } else if (key === 'concours') {
          btnConcours.classList.add('sortBtnActive');
          btnLimite.classList.remove('sortBtnActive');
          items.sort((a, b) => {
            const da = a.dataset.concours;
            const db = b.dataset.concours;
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.localeCompare(db);
          });
        }
        
        // Re-append
        items.forEach(it => container.appendChild(it));
      }
    </script>
  `;
};
