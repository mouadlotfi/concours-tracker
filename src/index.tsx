import { Hono } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';

import { configDefaults, getAppBaseUrl, mailEnabled, subscribersEnabled, turnstileEnabled } from './lib/config';
import type { Env } from './lib/config';
import { claimNotifications, loadAll, mergeAndPrune } from './lib/concours-store';
import { scrapeMatchedConcours } from './lib/scraper';
import type { MatchedConcours } from './lib/scraper';
import { buildRss } from './lib/rss';
import { ConcoursList, selectPinnedItems } from './components/ConcoursList';
import { SubscribeCard } from './components/SubscribeCard';
import { emailContactExistsInList, emailListSubscribers, emailRemoveContact, emailUpsertContact } from './lib/subscriptions';
import { notifySubscribers, sendConfirmEmail, sendWelcomeEmail } from './lib/mailer';
import { timer } from './lib/log';
import type { StoredClassification } from './lib/classification';
import { verifyUnsubscribeToken } from './lib/unsubscribe-token';
import { verifyConfirmToken } from './lib/confirm-token';
import { isNotifySlot } from './lib/notify-window';
export const app = new Hono<{ Bindings: Env }>();

function buildClassificationMap(items: MatchedConcours[]): Map<string, StoredClassification> {
  const classifications = new Map<string, StoredClassification>();
  for (const item of items) {
    if (item.aiRelevant === undefined) continue;
    classifications.set(item.id, {
      aiRelevant: item.aiRelevant,
      aiReason: item.aiReason,
      classificationVersion: item.classificationVersion,
      classificationHash: item.classificationHash,
      classificationSource: item.classificationSource,
      classificationModel: item.classificationModel,
      classifiedAt: item.classifiedAt,
    });
  }
  return classifications;
}

/** Relevant listings that have not been attempted yet, nearest deadline first. */
function pendingNotifications(items: MatchedConcours[]): MatchedConcours[] {
  return items
    .filter((item) => item.aiRelevant === true && !item.notifiedAt)
    .slice(0, configDefaults.maxFeedItems);
}

/** Claim pending listings before sending. `items` must already be deadline-ascending. */
export async function flushPendingNotifications(
  env: Env,
  items: MatchedConcours[],
  t: ReturnType<typeof timer>
): Promise<number> {
  const pending = pendingNotifications(items);
  if (!pending.length) {
    console.log('[notify] No pending listings.');
    return 0;
  }

  if (!mailEnabled(env)) {
    console.warn('[notify] Mail is not configured; holding pending listings.');
    return 0;
  }

  const subscribers = await emailListSubscribers(env);
  if (!subscribers.length) {
    console.log(`[notify] ${pending.length} pending listings but no subscribers.`);
    return 0;
  }

  const claimed = new Set(await claimNotifications(pending.map((item) => item.id), env));
  const toSend = pending.filter((item) => claimed.has(item.id));
  if (!toSend.length) {
    console.log('[notify] Pending listings were claimed by another run.');
    return 0;
  }

  let ok = false;
  try {
    ok = await notifySubscribers(subscribers, toSend, env);
  } catch (err) {
    console.error('[notify] Delivery outcome uncertain; claimed listings will not be resent automatically.', {
      ids: toSend.map((item) => item.id), error: err,
    });
    return 0;
  }
  if (!ok) {
    console.warn('[notify] Delivery outcome uncertain; not resending automatically.', {
      ids: toSend.map((item) => item.id), subscribers: subscribers.length,
    });
    return 0;
  }

  console.log(`[notify] Notified ${toSend.length} listings to ${subscribers.length} subscribers in ${t.mark()}ms.`);
  return toSend.length;
}

/** Cron notification pass: holds pending listings until a configured local slot. */
async function sendPendingNotifications(
  env: Env,
  items: MatchedConcours[],
  t: ReturnType<typeof timer>
): Promise<number> {
  if (!isNotifySlot(new Date(), env)) {
    console.log('[notify] Outside notification window; holding pending listings.');
    return 0;
  }
  return flushPendingNotifications(env, items, t);
}

// Home Page
app.get('/', async (c) => {
  let items: MatchedConcours[] = [];
  let error = null;

  try {
    const all = await loadAll(c.env);
    // Only show items that AI explicitly confirmed as relevant to web dev
    items = all.filter(it => it.aiRelevant === true);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const now = new Date();
  const hasPinned = items.length > 0
    && selectPinnedItems(items.slice(0, configDefaults.maxFeedItems), now).length > 0;

  return c.html(
    html`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Concours Développement Informatique</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="/css/globals.css">
        <link rel="stylesheet" href="/css/page.css">
      </head>
      <body>
        <main class="container">
          <header class="hero">
            <h1 class="title">
              Concours Développement Informatique
              <img class="titleFlag" src="/morocco-flag.svg" alt="Drapeau du Maroc" width="900" height="600">
            </h1>
          </header>

          <section class="section">
            <div class="sectionHead">
              ${hasPinned ? html`<h2 class="pinnedHeading">Épinglés</h2>` : ''}
              <div class="sectionMeta">
                <a href="/feed.xml">RSS</a>
              </div>
            </div>

            ${error ? html`
              <div class="statusMsg err">
                <span class="dot errDot"></span>
                Erreur scrape: ${error}
              </div>
            ` : items.length ? ConcoursList({ items, maxItems: configDefaults.maxFeedItems, now }) : html`
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

        <button type="button" class="scrollTopBtn" id="scroll-top-btn" aria-label="Remonter en haut de la page" title="Remonter en haut">
          ↑
        </button>

        <script>
          (function() {
            var btn = document.getElementById('scroll-top-btn');
            if (!btn) return;
            var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
            window.addEventListener('scroll', function() {
              if (window.scrollY > 300) {
                btn.classList.add('visible');
              } else {
                btn.classList.remove('visible');
              }
            }, { passive: true });
            btn.addEventListener('click', function() {
              window.scrollTo({
                top: 0,
                behavior: prefersReduced.matches ? 'auto' : 'smooth'
              });
            });
          })();
        </script>
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
  // Fail closed: an unset secret must not leave the pipeline open.
  if (!c.env.CRON_SECRET || secret !== c.env.CRON_SECRET) {
    return c.text('Unauthorized', 401);
  }

  try {
    const t = timer();
    console.log('[manual-refresh] Starting manual refresh...');
    const stored = await loadAll(c.env);
    const reclassify = c.req.query('reclassify') === 'true';
    const dryRun = c.req.query('dry_run') === 'true';
    const notificationsEnabled = !dryRun && c.req.query('notify') !== 'false';
    const existingClassifications = reclassify ? new Map<string, StoredClassification>() : buildClassificationMap(stored);
    console.log(`[manual-refresh] Loaded ${stored.length} stored items (${existingClassifications.size} classified) in ${t.mark()}ms`);

    const fresh = await scrapeMatchedConcours(c.env, existingClassifications);

    if (dryRun) {
      const relevant = fresh.filter((item) => item.aiRelevant === true).length;
      const rejected = fresh.filter((item) => item.aiRelevant === false).length;
      const unclassified = fresh.filter((item) => item.aiRelevant === undefined).length;
      console.log(JSON.stringify({
        event: 'manual-refresh-dry-run',
        scraped: fresh.length,
        relevant,
        rejected,
        unclassified,
        reclassify,
      }));
      return c.json({
        ok: true,
        dryRun: true,
        reclassified: reclassify,
        summary: { scraped: fresh.length, relevant, rejected, unclassified },
        items: fresh.map((item) => ({
          id: item.id,
          title: item.title,
          relevant: item.aiRelevant ?? null,
          reason: item.aiReason || null,
          source: item.classificationSource || null,
          model: item.classificationModel || null,
        })),
      });
    }

    const { newItems, all } = await mergeAndPrune(fresh, c.env, { reclassify });
    console.log(`[manual-refresh] Scrape+merge done in ${t.mark()}ms: ${fresh.length} scraped, ${newItems.length} new, ${all.length} total`);

    const forceEmail = notificationsEnabled && c.req.query('force_email') === 'true';
    let sent = false;

    if (forceEmail) {
      let itemsToNotify = all.filter((it) => it.aiRelevant === true).slice(0, 5);
      if (itemsToNotify.length === 0 && all.length > 0) {
        // For testing purposes, if no jobs are relevant, just grab the first one anyway
        itemsToNotify = all.slice(0, 1);
      }
      const testEmail = c.env.TEST_EMAIL;
      const subscribers = testEmail ? [{ email: testEmail }] : [];

      if (itemsToNotify.length > 0 && subscribers.length > 0) {
        // Test send only: never marks listings as notified.
        sent = await notifySubscribers(subscribers, itemsToNotify, c.env);
        console.log(`[manual-refresh] Sent ${itemsToNotify.length} test items to ${testEmail} in ${t.mark()}ms.`);
      } else {
        console.log(`[manual-refresh] force_email set but nothing to send (items=${itemsToNotify.length}, testEmail=${Boolean(testEmail)}).`);
      }
    } else if (notificationsEnabled) {
      // Manual refresh bypasses the notification window and flushes what is pending.
      sent = (await flushPendingNotifications(c.env, all, t)) > 0;
    } else {
      console.log('[manual-refresh] Notifications disabled.');
    }

    console.log(`[manual-refresh] Done in ${t.total()}ms: ${fresh.length} scraped, ${newItems.length} new, sent=${sent}`);
    return c.text(`Success: Scraped ${fresh.length} valid items, ${newItems.length} new items. Reclassified: ${reclassify}. Dry run: ${dryRun}. Notifications enabled: ${notificationsEnabled}. Notifications sent: ${sent}`);
  } catch (err) {
    console.error('[manual-refresh] failed:', err instanceof Error ? err.stack || err.message : err);
    return c.text(`Error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});


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

  // Fail closed: an unset Turnstile secret would otherwise fall back to
  // Cloudflare's always-pass test pair and silently drop bot protection.
  if (!subscribersEnabled(c.env) || !mailEnabled(c.env) || !turnstileEnabled(c.env)) {
    console.error('[subscribe] Subscriptions not fully configured; rejecting.');
    return c.json({ ok: false, message: 'Subscriptions not configured.' }, 500);
  }

  // Verify Turnstile
  const turnstileSecret = c.env.TURNSTILE_SECRET_KEY!;
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
    
    const verifyData = (await verifyResponse.json()) as { success?: boolean };
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

  // Identical response whether or not the address is already subscribed, so the
  // endpoint cannot be used to probe list membership.
  const genericResponse = {
    ok: true,
    message: 'Vérifiez votre boîte mail pour confirmer votre abonnement.',
  };

  const alreadySubscribed = await emailContactExistsInList(email, c.env);
  if (alreadySubscribed) {
    console.log(`[subscribe] Address already subscribed, not re-sending: ${email}`);
    return c.json(genericResponse);
  }

  const sent = await sendConfirmEmail(email, c.env);
  if (!sent) {
    console.error(`[subscribe] confirmation email failed for ${email}`);
    return c.json(
      { ok: false, message: "Impossible d'envoyer l'email de confirmation." },
      502
    );
  }
  console.log(`[subscribe] Confirmation email sent: ${email}`);

  return c.json(genericResponse);
});


const TokenSchema = z.object({
  token: z.string().trim().min(1),
});

app.post('/api/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TokenSchema.safeParse(body);
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

app.post('/api/confirm', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, message: 'Invalid token.' });
  }

  const v = verifyConfirmToken(parsed.data.token, c.env);
  if (!v.ok) {
    console.warn(`[confirm] Rejected token: ${v.reason}`);
    return c.json({
      ok: false,
      message: v.reason === 'expired'
        ? 'Ce lien a expiré. Veuillez renouveler votre abonnement.'
        : 'Lien de confirmation invalide.',
    });
  }

  if (!subscribersEnabled(c.env)) {
    return c.json({ ok: false, message: 'Subscriptions not configured.' }, 500);
  }

  const ok = await emailUpsertContact(v.email, c.env);
  if (!ok) {
    console.error(`[confirm] upsert contact failed for ${v.email}`);
    return c.json({ ok: false, message: 'Échec de la confirmation.' }, 502);
  }
  console.log(`[confirm] Subscriber confirmed: ${v.email}`);

  if (mailEnabled(c.env)) {
    try {
      const sent = await sendWelcomeEmail(v.email, c.env);
      if (!sent) console.warn(`[confirm] welcome email failed for ${v.email}`);
    } catch (err) {
      console.error(`[confirm] welcome email error for ${v.email}:`, err instanceof Error ? err.message : err);
    }
  }

  return c.json({ ok: true, message: 'Abonnement confirmé avec succès.' });
});

app.get('/confirm', (c) => {
  const token = (c.req.query('token') || '').trim();
  const result = token ? verifyConfirmToken(token, c.env) : ({ ok: false, reason: 'invalid' } as const);
  const valid = result.ok;

  const desc = valid
    ? "Confirmez votre adresse email pour recevoir les nouveaux concours de développement informatique."
    : result.reason === 'expired'
      ? "Ce lien de confirmation a expiré. Veuillez renouveler votre abonnement depuis la page d'accueil."
      : "Ce lien de confirmation est invalide.";

  const button = valid
    ? `<button class="btn" id="confirm-btn" type="button">
            <span class="tick"></span>
            <span class="spinner"></span>
            <span class="label">Confirmer</span>
          </button>`
    : '';

  return c.html(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmation d'abonnement</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="stylesheet" href="/css/globals.css">
        <link rel="stylesheet" href="/css/confirm.css">
      </head>
      <body>
        <main class="card">
          <div class="icon">${valid ? '+' : '!'}</div>
          <h1 class="title">Confirmation</h1>
          <p class="desc">${desc}</p>

          ${button}

          <div id="status-container" class="status"></div>

          <a href="/" class="back">retour</a>
        </main>

        <script>
          (function() {
            const btn = document.getElementById('confirm-btn');
            const statusDiv = document.getElementById('status-container');
            if (!btn) return;

            const params = new URLSearchParams(window.location.search);
            const token = params.get('token') || '';

            btn.addEventListener('click', async function() {
              btn.setAttribute('disabled', 'true');
              btn.classList.add('loading');
              statusDiv.textContent = '';
              statusDiv.className = 'status';

              try {
                const res = await fetch('/api/confirm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                });
                const data = await res.json().catch(function() { return {}; });

                if (res.ok && data && data.ok) {
                  statusDiv.className = 'status statusOk';
                  statusDiv.textContent = data.message || 'Abonnement confirmé.';
                  btn.style.display = 'none';
                } else {
                  statusDiv.className = 'status statusErr';
                  statusDiv.textContent = data.message || 'Erreur.';
                  btn.removeAttribute('disabled');
                  btn.classList.remove('loading');
                }
              } catch (err) {
                statusDiv.className = 'status statusErr';
                statusDiv.textContent = 'Erreur réseau.';
                btn.removeAttribute('disabled');
                btn.classList.remove('loading');
              }
            });
          })();
        </script>
      </body>
    </html>
  `);
});

export default {
  fetch: app.fetch,
  
  // Cloudflare Cron Trigger handler.
  // "0 */5 * * *" scrapes and merges; "0 * * * *" runs the notification pass.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const t = timer();
      const isScrapeRun = event.cron !== '0 * * * *';
      console.log(`[cron] Triggered by "${event.cron}" (scrape=${isScrapeRun})`);
      let stage = 'init';
      let freshCount = 0;
      let newCount = 0;
      let notifiedCount = 0;
      try {
        let items: MatchedConcours[] | null = null;

        if (isScrapeRun) {
          stage = 'loadAll';
          const stored = await loadAll(env);
          const existingClassifications = buildClassificationMap(stored);
          console.log(`[cron] Loaded ${stored.length} stored items (${existingClassifications.size} classified) in ${t.mark()}ms`);

          stage = 'scrape';
          const fresh = await scrapeMatchedConcours(env, existingClassifications);
          freshCount = fresh.length;

          stage = 'merge';
          const result = await mergeAndPrune(fresh, env);
          items = result.all;
          newCount = result.newItems.length;
          console.log(`[cron] Scrape+merge done in ${t.mark()}ms: ${freshCount} scraped, ${newCount} new`);
        }

        stage = 'notify';
        notifiedCount = await sendPendingNotifications(env, items ?? await loadAll(env), t);

        console.log(`[cron] Done in ${t.total()}ms: ${freshCount} scraped, ${newCount} new, ${notifiedCount} notified`);
      } catch (err) {
        console.error(`[cron] refresh failed at stage "${stage}":`, err instanceof Error ? err.stack || err.message : err);
      }
    })());
  }
};
