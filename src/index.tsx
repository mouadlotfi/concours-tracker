import { Hono } from 'hono';
import { html } from 'hono/html';

import { configDefaults, getAppBaseUrl } from './lib/config';
import type { Env } from './lib/config';
import { loadAll } from './lib/concours-store';
import { buildRss } from './lib/rss';
import { ConcoursList } from './components/ConcoursList';

const app = new Hono<{ Bindings: Env }>();

// Home Page
app.get('/', async (c) => {
  let items = [];
  let error = null;
  try {
    items = await loadAll(c.env);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return c.html(
    html`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Concours Développeur</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="/css/globals.css">
        <link rel="stylesheet" href="/css/page.css">
      </head>
      <body>
        <main class="container">
          <header class="hero">
            <div class="badge">concours</div>
            <h1 class="title">Concours Développeur Full-Stack & Logiciel</h1>
          </header>
          <section class="section">
            <div class="sectionHead">
              <h2 class="sectionTitle">Concours en cours</h2>
              <div class="sectionMeta"><a href="/feed.xml">RSS</a></div>
            </div>
            ${error ? html`<div class="statusMsg err">Erreur: ${error}</div>` : items.length ? ConcoursList({ items, maxItems: configDefaults.maxFeedItems }) : html`<div class="empty">Aucun concours disponible pour l'instant.</div>`}
          </section>
        </main>
      </body>
    </html>`
  );
});

// RSS Feed
app.get('/feed.xml', async (c) => {
  const all = await loadAll(c.env);
  const xml = buildRss(all.slice(0, configDefaults.maxFeedItems), getAppBaseUrl(c.env));
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', `public, s-maxage=${configDefaults.cacheSeconds}, stale-while-revalidate=86400`);
  return c.body(xml);
});

export default app;
