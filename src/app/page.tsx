import styles from './page.module.css';
import { config } from '@/lib/config';
import { getMatchedConcoursCached } from '@/lib/wadifa-cache';

import { SubscribeCard } from './subscribe-card';

import type { MatchedConcours } from '@/lib/wadifa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default async function HomePage() {
  let items: MatchedConcours[] = [];
  let error: string | null = null;

  try {
    const result = await getMatchedConcoursCached();
    items = result.items;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className={styles.container}>
      <header className={styles.hero}>
        <div className={styles.badge}>concours</div>
        <h1 className={styles.title}>
          Concours Développement Web
        </h1>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Concours en cours</h2>
          <div className={styles.sectionMeta}>
            <a href="/feed.xml">RSS</a>
          </div>
        </div>

        {error ? (
          <div className={`${styles.statusMsg} ${styles.err}`}>
            <span className={`${styles.dot} ${styles.errDot}`} />
            Erreur scrape: {error}
          </div>
        ) : items.length ? (
          <div className={styles.list}>
            {items.slice(0, config.maxFeedItems).map((it) => (
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
                    <span className={styles.pill}>limite: {fmtDate(it.depositDeadlineIso)}</span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.metaKey}>Administration</span>
                    <span className={styles.metaVal}>
                      {it.details['Administration qui recrute'] || it.details['Administration qui recrute :'] || 'n/a'}
                    </span>
                    <span className={styles.metaSep} />
                    <span className={styles.metaKey}>Date concours</span>
                    <span className={styles.metaVal}>{fmtDate(it.concoursDateIso)}</span>
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
        ) : (
          <div className={styles.empty}>
            Aucun concours disponible pour l'instant.
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Notifications email</h2>
          <div className={styles.sectionMeta} />
        </div>
        <p className={styles.sectionText}>
          Inscrivez-vous pour recevoir les nouveaux concours dans votre boite mail.
        </p>
        <SubscribeCard />
      </section>

      <div className={styles.footer}>
        <a href="https://www.emploi-public.ma" target="_blank" rel="noreferrer noopener">
          source: emploi-public.ma
        </a>
        <span className={styles.sep} />
        <a href="/feed.xml">RSS</a>
        <span className={styles.sep} />
        <a href="https://github.com/mouadlotfi/concours-tracker" target="_blank" rel="noreferrer noopener">
          Github
        </a>
      </div>
    </main>
  );
}
