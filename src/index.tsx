import { Hono } from 'hono';
import { html } from 'hono/html';

import { configDefaults, getAppBaseUrl } from './lib/config';
import type { Env } from './lib/config';
import { loadAll, mergeAndPrune } from './lib/concours-store';
import { scrapeMatchedConcours } from './lib/scraper';
import { buildRss } from './lib/rss';

import { ConcoursList } from './components/ConcoursList';
import { SubscribeCard } from './components/SubscribeCard';
import { emailListSubscribers } from './lib/subscriptions';
import { notifySubscribers } from './lib/mailer';
import { timer } from './lib/log';

const app = new Hono<{ Bindings: Env }>();

// Home Page
app.get('/', async (c) => {
  let items: import('./lib/scraper').MatchedConcours[] = [];
  let error = null;

  try {
    const all = await loadAll(c.env);
    // Only show items that AI explicitly confirmed as relevant to web dev
    items = all.filter(it => it.aiRelevant === true);
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
        <title>Concours Développement Web</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="/css/globals.css">
        <link rel="stylesheet" href="/css/page.css">
      </head>
      <body>
        <main class="container">
          <header class="hero">
            <div class="badge">concours</div>
            <h1 class="title">
              Concours Développement Web
            </h1>
          </header>

          <section class="section">
            <div class="sectionHead">
              <h2 class="sectionTitle">Concours en cours</h2>
              <div class="sectionMeta">
                <a href="/feed.xml">RSS</a>
              </div>
            </div>

            ${error ? html`
              <div class="statusMsg err">
                <span class="dot errDot"></span>
                Erreur scrape: ${error}
              </div>
            ` : items.length ? ConcoursList({ items, maxItems: configDefaults.maxFeedItems }) : html`
              <div class="empty">
                Aucun concours disponible pour l'instant.
              </div>
            `}
          </section>

          <section class="section">
            <div class="sectionHead">
              <h2 class="sectionTitle">Notifications email</h2>
              <div class="sectionMeta"></div>
            </div>
            <p class="sectionText">
              Inscrivez-vous pour recevoir les nouveaux concours dans votre boite mail.
            </p>
            ${SubscribeCard({ siteKey: c.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY })}
          </section>

          <div class="footer">
            <a href="https://www.emploi-public.ma" target="_blank" rel="noreferrer noopener">
              source: emploi-public.ma
            </a>
            <span class="sep"></span>
            <a href="/feed.xml">RSS</a>
            <span class="sep"></span>
            <a href="https://github.com/mouadlotfi/concours-tracker" target="_blank" rel="noreferrer noopener">
              Github
            </a>
          </div>
        </main>
      </body>
    </html>
    `
  );
});

// RSS Feed
app.get('/feed.xml', async (c) => {
  const all = await loadAll(c.env);
  const items = all.filter(it => it.aiRelevant === true).slice(0, configDefaults.maxFeedItems);
  const xml = buildRss(items, getAppBaseUrl(c.env));
  
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', `public, s-maxage=${configDefaults.cacheSeconds}, stale-while-revalidate=86400`);
  
  return c.body(xml);
});

// Secure Manual Refresh API
app.get('/api/refresh', async (c) => {
  const secret = c.req.query('secret');
  if (c.env.CRON_SECRET && secret !== c.env.CRON_SECRET) {
    return c.text('Unauthorized', 401);
  }

  try {
    const t = timer();
    console.log('[manual-refresh] Starting manual refresh...');
    const stored = await loadAll(c.env);
    const existingClassifications = new Map<string, { aiRelevant?: boolean; aiReason?: string }>();
    for (const it of stored) {
      if (it.aiRelevant !== undefined) {
        existingClassifications.set(it.id, { aiRelevant: it.aiRelevant, aiReason: it.aiReason });
      }
    }
    console.log(`[manual-refresh] Loaded ${stored.length} stored items (${existingClassifications.size} classified) in ${t.mark()}ms`);

    const fresh = await scrapeMatchedConcours(c.env, existingClassifications);
    const { newItems, all } = await mergeAndPrune(fresh, c.env);
    console.log(`[manual-refresh] Scrape+merge done in ${t.mark()}ms: ${fresh.length} scraped, ${newItems.length} new, ${all.length} total`);

    const forceEmail = c.req.query('force_email') === 'true';
    let itemsToNotify = forceEmail
      ? all.filter(it => it.aiRelevant === true).slice(0, 5)
      : newItems.filter(it => it.aiRelevant === true);

    if (forceEmail && itemsToNotify.length === 0 && all.length > 0) {
      // For testing purposes, if no jobs are relevant, just grab the first one anyway
      itemsToNotify = all.slice(0, 1);
    }

    let sent = false;
    if (itemsToNotify.length > 0) {
      const testEmail = c.env.TEST_EMAIL;
      const subscribers = forceEmail
        ? (testEmail ? [{ email: testEmail }] : [])
        : await emailListSubscribers(c.env);

      if (subscribers.length > 0) {
        sent = await notifySubscribers(subscribers, itemsToNotify, c.env);
        console.log(`[manual-refresh] Sent email notifications for ${itemsToNotify.length} items to ${subscribers.length} subscribers in ${t.mark()}ms.`);
      } else {
        console.log(`[manual-refresh] No subscribers to notify.`);
      }
    } else {
      console.log(`[manual-refresh] No new relevant items to notify.`);
    }

    console.log(`[manual-refresh] Done in ${t.total()}ms: ${fresh.length} scraped, ${newItems.length} new, sent=${sent}`);
    return c.text(`Success: Scraped ${fresh.length} valid items, ${newItems.length} new items. Notifications sent: ${sent}`);
  } catch (err) {
    console.error('[manual-refresh] failed:', err instanceof Error ? err.stack || err.message : err);
    return c.text(`Error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

// Subscription API
import { z } from 'zod';
import { emailContactExistsInList, emailUpsertContact } from './lib/subscriptions';
import { sendWelcomeEmail } from './lib/mailer';
import { subscribersEnabled, mailEnabled } from './lib/config';

const Schema = z.object({
  email: z.string().trim().email(),
  turnstileToken: z.string().min(1, 'Captcha token required'),
});

app.post('/api/subscribe', async (c) => {
  // Simple rate limiting by IP would go here, but Workers needs a KV binding or Durable Object for robust rate limiting.
  // We rely on Turnstile for spam protection on the free tier.
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || 'unknown';

  const body = await c.req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, detail: 'Invalid request data.' }, 400);
  }

  const { email, turnstileToken } = parsed.data;

  // Verify Turnstile
  const turnstileSecret = c.env.TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
  try {
    const verifyForm = new URLSearchParams();
    verifyForm.append('secret', turnstileSecret);
    verifyForm.append('response', turnstileToken);
    verifyForm.append('remoteip', ip);

    const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyForm.toString(),
    });
    
    const verifyData = await verifyResponse.json() as any;
    if (!verifyData.success) {
      return c.json(
        { ok: false, message: "Échec de la validation du captcha. Veuillez réessayer." },
        400
      );
    }
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return c.json(
      { ok: false, message: "Erreur lors de la validation du captcha." },
      500
    );
  }

  if (!subscribersEnabled(c.env)) {
    return c.json(
      { ok: false, message: 'Subscriptions not configured.' },
      500
    );
  }

  const alreadySubscribed = await emailContactExistsInList(email, c.env);
  if (alreadySubscribed) {
    return c.json(
      { ok: false, message: 'Vous êtes déjà abonné(e).' },
      409
    );
  }

  const ok = await emailUpsertContact(email, c.env);
  if (!ok) {
    console.error(`[subscribe] upsert contact failed for ${email}`);
    return c.json(
      { ok: false, message: 'Failed to subscribe.' },
      502
    );
  }
  console.log(`[subscribe] New subscriber added: ${email}`);

  if (mailEnabled(c.env)) {
    try {
      const sent = await sendWelcomeEmail(email, c.env);
      if (!sent) {
        console.warn(`[subscribe] welcome email failed for ${email}`);
      }
    } catch (err) {
      console.error(`[subscribe] welcome email error for ${email}:`, err instanceof Error ? err.message : err);
    }
  }

  return c.json({
    ok: true,
    message: 'Abonnement confirmé avec succès.',
  });
});

import { verifyUnsubscribeToken } from './lib/unsubscribe-token';
import { emailRemoveContact } from './lib/subscriptions';

const UnsubscribeSchema = z.object({
  token: z.string().trim().min(1),
});

app.post('/api/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = UnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, message: 'Invalid token.' });
  }

  const v = verifyUnsubscribeToken(parsed.data.token, c.env);
  if (!v.ok) {
    console.warn('[unsubscribe] Invalid or expired token');
    return c.json({ ok: false, message: 'Invalid token.' });
  }

  const ok = await emailRemoveContact(v.email, c.env);
  if (ok) {
    console.log(`[unsubscribe] Removed subscriber: ${v.email}`);
    return c.json({ ok: true, message: 'Desabonne avec succes.' });
  }
  console.error(`[unsubscribe] Failed to remove contact: ${v.email}`);
  return c.json({ ok: false, message: 'Echec desabonnement.' });
});

app.get('/unsubscribe', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Désabonnement</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="/css/globals.css">
        <link rel="stylesheet" href="/css/unsubscribe.css">
      </head>
      <body>
        <main class="card">
          <div class="icon">x</div>
          <h1 class="title">Désabonnement</h1>
          <p class="desc">
            Vous ne recevrez plus de notifications par email concernant les nouveaux concours.
          </p>

          <button
            class="btn"
            id="unsub-btn"
            type="button"
          >
            <span class="tick"></span>
            <span class="spinner"></span>
            <span class="label">Confirmer</span>
          </button>

          <div id="status-container" class="status"></div>

          <a href="/" class="back">retour</a>
        </main>
        
        <script>
          (function() {
            const btn = document.getElementById('unsub-btn');
            const statusDiv = document.getElementById('status-container');
            const params = new URLSearchParams(window.location.search);
            const token = params.get('token') || '';

            btn.addEventListener('click', async function() {
              if (!token) {
                statusDiv.className = 'status statusErr';
                statusDiv.textContent = 'Lien invalide.';
                return;
              }

              btn.setAttribute('disabled', 'true');
              btn.classList.add('loading');
              statusDiv.textContent = '';
              statusDiv.className = 'status';

              try {
                const res = await fetch('/api/unsubscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                });
                const data = await res.json().catch(function() { return {}; });

                if (!res.ok) {
                  statusDiv.className = 'status statusErr';
                  statusDiv.textContent = data.message || 'Erreur.';
                  btn.removeAttribute('disabled');
                  btn.classList.remove('loading');
                  return;
                }

                if (data && data.ok) {
                  statusDiv.className = 'status statusOk';
                  statusDiv.textContent = data.message || 'Desabonne avec succes.';
                  btn.style.display = 'none';
                } else {
                  statusDiv.className = 'status statusErr';
                  statusDiv.textContent = data.message || 'Erreur.';
                  btn.removeAttribute('disabled');
                  btn.classList.remove('loading');
                }
              } catch (err) {
                statusDiv.className = 'status statusErr';
                statusDiv.textContent = 'Erreur reseau.';
                btn.removeAttribute('disabled');
                btn.classList.remove('loading');
              }
            });
          })();
        </script>
      </body>
    </html>
    `
  );
});

export default {
  fetch: app.fetch,
  
  // Cloudflare Cron Trigger handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const t = timer();
      console.log('[cron] Starting background refresh...');
      let stage = 'init';
      let freshCount = 0;
      let newCount = 0;
      try {
        stage = 'loadAll';
        const stored = await loadAll(env);
        const existingClassifications = new Map<string, { aiRelevant?: boolean; aiReason?: string }>();
        for (const it of stored) {
          if (it.aiRelevant !== undefined) {
            existingClassifications.set(it.id, { aiRelevant: it.aiRelevant, aiReason: it.aiReason });
          }
        }
        console.log(`[cron] Loaded ${stored.length} stored items (${existingClassifications.size} classified) in ${t.mark()}ms`);

        stage = 'scrape';
        const fresh = await scrapeMatchedConcours(env, existingClassifications);
        freshCount = fresh.length;

        stage = 'merge';
        const { newItems } = await mergeAndPrune(fresh, env);
        newCount = newItems.length;
        console.log(`[cron] Scrape+merge done in ${t.mark()}ms: ${freshCount} scraped, ${newCount} new`);

        stage = 'notify';
        const itemsToNotify = newItems.filter(it => it.aiRelevant === true);
        if (itemsToNotify.length > 0) {
          const subscribers = await emailListSubscribers(env);
          if (subscribers.length > 0) {
            await notifySubscribers(subscribers, itemsToNotify, env);
            console.log(`[cron] Sent email notifications for ${itemsToNotify.length} items to ${subscribers.length} subscribers in ${t.mark()}ms.`);
          } else {
            console.log(`[cron] No subscribers to notify for ${itemsToNotify.length} new relevant items.`);
          }
        } else {
          console.log(`[cron] No new relevant items to notify.`);
        }

        console.log(`[cron] Done in ${t.total()}ms: ${freshCount} scraped, ${newCount} new`);
      } catch (err) {
        console.error(`[cron] refresh failed at stage "${stage}":`, err instanceof Error ? err.stack || err.message : err);
      }
    })());
  }
};
