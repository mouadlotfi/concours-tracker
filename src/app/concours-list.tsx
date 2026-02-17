'use client';

import { useState, useMemo } from 'react';
import styles from './page.module.css';
import type { MatchedConcours } from '@/lib/wadifa';

type SortKey = 'limite' | 'concours' | null;

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  const ymd = iso.split('T')[0];
  const parts = ymd.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export function ConcoursList({
  items,
  maxItems,
}: {
  items: MatchedConcours[];
  maxItems: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>(null);

  const toggleSort = (key: 'limite' | 'concours') =>
    setSortKey((prev) => (prev === key ? null : key));

  const sorted = useMemo(() => {
    const list = items.slice(0, maxItems);
    if (!sortKey) return list;

    return [...list].sort((a, b) => {
      if (sortKey === 'limite') {
        const da = a.depositDeadlineIso ?? '';
        const db = b.depositDeadlineIso ?? '';
        return da.localeCompare(db);
      }
      const da = a.concoursDateIso ?? '';
      const db = b.concoursDateIso ?? '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }, [items, maxItems, sortKey]);

  return (
    <>
      <div className={styles.sortBar}>
        <span className={styles.sortLabel}>Trier par</span>
        <button
          className={`${styles.sortBtn} ${sortKey === 'limite' ? styles.sortBtnActive : ''}`}
          onClick={() => toggleSort('limite')}
        >
          Date limite de dépôt
        </button>
        <button
          className={`${styles.sortBtn} ${sortKey === 'concours' ? styles.sortBtnActive : ''}`}
          onClick={() => toggleSort('concours')}
        >
          Date du concours
        </button>
      </div>

      <div className={styles.list}>
        {sorted.map((it) => (
          <article key={it.id} className={styles.item}>
            <div className={styles.itemMain}>
              <div className={styles.itemTitleRow}>
                <h3 className={styles.itemTitle}>
                  <a
                    className={styles.itemTitleLink}
                    href={it.sourceUrl || it.wadifaUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {it.title}
                  </a>
                </h3>
                <span className={styles.pill}>Date limite de dépôt: {fmtDate(it.depositDeadlineIso)}</span>
              </div>
              <div className={styles.itemMeta}>
                <span className={styles.metaGroup}>
                  <span className={styles.metaKey}>Administration</span>
                  <span className={styles.metaVal}>
                    {it.details['Administration qui recrute'] || it.details['Administration qui recrute :'] || 'n/a'}
                  </span>
                </span>
                {it.concoursDateIso && (
                  <span className={styles.pill}>Date du concours: {fmtDate(it.concoursDateIso)}</span>
                )}
              </div>

              <div className={styles.itemLinks}>
                {it.sourceUrl && (
                  <a
                    className={styles.linkBtn}
                    href={it.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Lien du concours
                  </a>
                )}
              </div>
            </div>

            <details className={styles.details}>
              <summary className={styles.summary}>Détails du concours</summary>
              <div className={styles.detailsGrid}>
                {Object.entries(it.details || {})
                  .filter(([k, v]) => k && v)
                  .slice(0, 20)
                  .map(([k, v]) => (
                    <div key={k} className={styles.detailRow}>
                      <div className={styles.detailK}>{k}</div>
                      <div className={styles.detailV}>{v}</div>
                    </div>
                  ))}
              </div>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
