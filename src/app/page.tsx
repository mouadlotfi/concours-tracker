import styles from './page.module.css';
import { config } from '@/lib/config';
import { getMatchedConcoursCached } from '@/lib/wadifa-cache';

import { SubscribeCard } from './subscribe-card';
import { ConcoursList } from './concours-list';

import type { MatchedConcours } from '@/lib/wadifa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
          <ConcoursList items={items} maxItems={config.maxFeedItems} />
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
