<div align="center">

# Concours Tracker

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-Framework-e36002?style=flat-square)](https://hono.dev/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-f38020?style=flat-square&logo=cloudflare)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

:star: If you find this project helpful, please consider starring it on GitHub!

[Overview](#overview) • [Features](#features) • [Architecture](#architecture) • [Getting Started](#getting-started) • [Email Flows](#email-flows) • [Deployment](#deployment)

<img src="public/screenshot.png" alt="Concours Tracker homepage listing Moroccan public-sector IT concours" width="900">

</div>

## Overview

**Concours Tracker** checks Moroccan public-sector job listings on `wadifa-info.com`, keeps software and web development roles, and shares them on the website, by email, and through RSS.

The app runs on Cloudflare Workers and stores listings in D1.

## Features

- **Cloudflare Workers and D1** run the app and store listings.
- **French and Arabic classification rules** filter listings first. OpenRouter with PDF parsing reviews ambiguous cases, and a guardrail requires evidence from the listing or its official document.
- **Scheduled scraping** refreshes listings every five hours and removes expired competitions.
- **Double opt-in subscriptions** add an address to the mailing list only after its owner confirms by email.
- **Email digests** go out during configured local hours.
- **Website and RSS feed** show relevant listings.
- **Cloudflare Turnstile** protects the subscription form from bots.

## Architecture

The worker has two entry points. Hono's `fetch` handler serves the website, RSS feed, and API routes. The `scheduled` handler runs the cron jobs.

```
Cron "0 */5 * * *"  ──► scrape ──► classify (rules, then AI if needed) ──► save listings (D1)
Cron "0 * * * *"    ──► check for unclaimed listings (only during NOTIFY_HOURS)
                                 │
GET /api/refresh  ───────────────┘
                                 ▼
                      email: Brevo or local Mailpit
```

Main dependencies:

- **Hono** handles routes and server-rendered HTML.
- **Cloudflare D1** stores listings in SQLite.
- **Cron Triggers** run scraping and notification checks.
- **Cheerio** parses listing pages.
- **Zod** validates request data.
- **Brevo** delivers email and stores the mailing list.
- **OpenRouter** classifies ambiguous listings.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) for development, package management, and tests
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Optional for local email capture: Docker and Mailpit
- For production email and classification: [Brevo](https://app.brevo.com/), [OpenRouter](https://openrouter.ai/), and [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) accounts

### Installation

```bash
git clone https://github.com/mouadlotfi/concours-tracker.git
cd concours-tracker
bun install
```

### Configure the local environment

```bash
cp .env.dev.example .env.dev
```

`.env.dev` is gitignored. `bun run dev` loads it through `wrangler dev --env-file .env.dev`. See [`.env.example`](.env.example) for variable descriptions.

To test email without contacting subscribers, run [Mailpit](https://mailpit.axllent.org/). It captures outgoing messages in a local inbox at <http://127.0.0.1:8025>:

```bash
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit   # Docker
brew install mailpit && mailpit                             # Homebrew
sudo sh < <(curl -sL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh) && mailpit   # script (Linux & macOS)
```

The example `.env.dev` sets `MAILPIT_URL`, so the local worker sends mail to Mailpit instead of Brevo.

### Initialize the local database

```bash
bunx wrangler d1 execute concours-db --local --file=schema.sql
```

### Start the local app

```bash
bun run dev          # http://127.0.0.1:8787
```

### Local testing

The example `.env.dev` sets `CRON_SECRET`. `/api/refresh` returns 401 unless the request includes the matching `secret`.

Run the scrape and classification pipeline without saving results or sending email:

```bash
curl "http://127.0.0.1:8787/api/refresh?secret=dev-cron-secret&dry_run=true&reclassify=true"
```

To inspect a test notification in Mailpit, first confirm `.env.dev` has `MAILPIT_URL` set. Then send a test message to `TEST_EMAIL`. This test route bypasses the notification schedule and does not mark listings as notified:

```bash
curl "http://127.0.0.1:8787/api/refresh?secret=dev-cron-secret&force_email=true"
```

Use `notify=false` to save refreshed listings without sending a notification.

The notification regression tests use an in-memory database and mocked email requests. They never send real email:

```bash
bun test src/index.notify.test.ts
```

### Commands

| Command | Purpose |
|---|---|
| `bun run dev` | Start the local worker and load `.env.dev` |
| `bun test` | Test suite |
| `bun run lint` | Typecheck (`tsc --noEmit`) |
| `bun run db:seed` | Load `seeds/dev.sql` into local D1 |
| `bun run db:reset` | Delete all local listings |
| `bun run deploy` | Deploy to Cloudflare |

## Email flows

The app sends three types of email:

1. **Confirmation.** `POST /api/subscribe` sends a signed link that expires after 48 hours.
2. **Welcome.** After the recipient confirms, the app adds the address to the Brevo list and sends a welcome message.
3. **New listings.** Subscribers receive one digest during each notification slot, ordered by application deadline.

The app adds subscribers to the mailing list only through `POST /api/confirm`, not `POST /api/subscribe`. Both new and existing addresses get the same response from the subscribe endpoint, so it does not reveal whether an address is already subscribed.

Unsubscribe uses a stateless HMAC link (`/unsubscribe` → `POST /api/unsubscribe`).

### Notification schedule

The scraper runs every five hours. The notification check runs hourly and sends only during `NOTIFY_HOURS`, interpreted in `NOTIFY_TIMEZONE`. The defaults in `wrangler.toml` are 08:00 and 18:00 in `Africa/Casablanca`.

- Listings found between notification slots wait until the next slot.
- Before sending, the worker claims each relevant listing in D1. Later runs skip claimed listings, including overlapping runs.
- If the claim cannot be saved, the worker does not send the email.
- If the email provider returns an error or the result is uncertain, the worker does not retry automatically. Check the logs and provider delivery history before retrying, since a retry could duplicate messages.
- A manual `GET /api/refresh` sends pending notifications immediately, without waiting for a scheduled slot.

## Deployment

1. **Log in to Cloudflare.**

   ```bash
   bunx wrangler login
   ```

2. **Create the production database** on the first deploy. Copy its `database_id` into `wrangler.toml`:

   ```bash
   bunx wrangler d1 create concours-db
   ```

3. **Initialize the schema** on the first deploy.

   > `schema.sql` drops and recreates its tables. Run it only against a new, empty database.

   ```bash
   bunx wrangler d1 execute concours-db --remote --file=schema.sql
   ```

   For a database that already contains data, add the notification column and backfill it. The backfill prevents the next notification pass from emailing every existing listing.

   ```bash
   bunx wrangler d1 execute concours-db --remote --command \
     "ALTER TABLE concours ADD COLUMN notifiedAt DATETIME; UPDATE concours SET notifiedAt = CURRENT_TIMESTAMP WHERE notifiedAt IS NULL;"
   ```

   If the database tracks migrations, use `bunx wrangler d1 migrations apply concours-db --remote` instead. You can check by running `SELECT name FROM d1_migrations` against the database.

   Before deploying, check `notifiedAt` for listings that were already emailed. If any have a `NULL` value, update only the IDs confirmed as delivered. Otherwise, the next notification check may send those listings again. For a partially delivered batch, check each recipient's delivery history before changing notification state.

4. **Set production secrets.** See [`.env.example`](.env.example) for the full list:

   ```bash
   bunx wrangler secret put SMTP_API_KEY
   bunx wrangler secret put SMTP_SENDER_EMAIL
   bunx wrangler secret put SMTP_LIST_ID
   bunx wrangler secret put UNSUBSCRIBE_SECRET
   bunx wrangler secret put SUBSCRIBE_CONFIRM_SECRET   # optional; falls back to UNSUBSCRIBE_SECRET
   bunx wrangler secret put CRON_SECRET
   bunx wrangler secret put OPENROUTER_API_KEY
   bunx wrangler secret put NEXT_PUBLIC_TURNSTILE_SITE_KEY
   bunx wrangler secret put TURNSTILE_SECRET_KEY
   ```

5. **Deploy the worker.**

   ```bash
   bun run deploy
   ```

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.
