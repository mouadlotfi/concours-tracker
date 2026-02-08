# Concours Dev Web RSS

A Next.js application that aggregates public-sector competitive examination ("concours") postings related to web development and IT from [wadifa-info.com](https://www.wadifa-info.com). It filters listings by configurable keywords, serves results as an RSS feed, displays them on a web dashboard, and optionally notifies email subscribers when new concours are found.

## Features

- **Web scraping** -- Paginates through wadifa-info.com listing pages and scrapes detail pages using Cheerio
- **Keyword filtering** -- Matches concours by configurable include/exclude keywords (no AI, pure text matching)
- **RSS feed** -- Serves a valid RSS 2.0 feed at `/feed.xml` with edge caching
- **Web dashboard** -- Displays matched concours with expandable details, deadlines, and source links
- **Email subscriptions** -- Subscribers receive digest emails when new matching concours are found (via Brevo)
- **Persistent history** -- Scraped results are stored in Vercel KV (Redis) and survive across deployments
- **Cron-triggered refresh** -- External schedulers can trigger scraping and email notifications via a secured API endpoint
- **Secure unsubscribe** -- HMAC-SHA256 signed one-click unsubscribe links in every email

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| Language | TypeScript 5.9 |
| UI | React 19, CSS Modules |
| Scraping | [Cheerio](https://cheerio.js.org) |
| Validation | [Zod](https://zod.dev) 4 |
| Email | [Brevo](https://www.brevo.com) (transactional SMTP API) |
| Storage | [@vercel/kv](https://vercel.com/docs/storage/vercel-kv) (Redis) |
| Fonts | [Geist](https://vercel.com/font) (self-hosted woff2) |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (package manager)
- Node.js 22+

### Local Development

```sh
cp .env.example .env    # configure your environment variables
bun install
bun run dev             # starts dev server on http://localhost:3000
```

### Production Build

```sh
bun run build
bun run start
```

### Docker

```sh
cp .env.example .env    # configure your environment variables
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## Deployment

### Vercel (Recommended)

1. Import the repository into [Vercel](https://vercel.com)
2. Add a [Vercel KV](https://vercel.com/docs/storage/vercel-kv) store to your project
3. Configure environment variables in the Vercel dashboard (see [Configuration](#configuration))
4. Deploy -- the app runs statelessly with edge-cached RSS

### Docker / Self-Hosted

Use the included `Dockerfile` and `docker-compose.yml`. All configuration is passed via `.env`.

> **Note:** When self-hosting, you need an external Redis instance for Vercel KV, or you can run without persistent history (the app will still work using in-memory cache).

## Configuration

All configuration is via environment variables. See `.env.example` for a template.

### Required

| Variable | Description |
|---|---|
| `APP_BASE_URL` | Public URL of your deployment (e.g. `https://concours.mouadlotfi.com`) |

### Email (Brevo)

| Variable | Description |
|---|---|
| `BREVO_API_KEY` | Brevo API key for transactional emails and contact management |
| `BREVO_LIST_ID` | Brevo contact list ID for subscribers |
| `BREVO_SENDER_EMAIL` | Sender email address for notifications |
| `BREVO_SENDER_NAME` | Sender display name (default: `Concours Developpement Web`) |

### Security

| Variable | Description |
|---|---|
| `CRON_SECRET` | Secret token to authenticate cron refresh requests (recommended) |
| `UNSUBSCRIBE_SECRET` | HMAC secret for signing unsubscribe tokens (falls back to `BREVO_API_KEY`) |

### Scraper (Optional)

| Variable | Default | Description |
|---|---|---|
| `KEYWORDS` | `developpement,informatique` | Comma-separated include keywords |
| `EXCLUDE_KEYWORDS` | _(empty)_ | Comma-separated exclude keywords |
| `MAX_PAGES` | `5` | Max listing pages to scrape |
| `MAX_FEED_ITEMS` | `30` | Max items in the RSS feed |
| `CACHE_SECONDS` | `3600` | In-memory cache TTL in seconds |
| `BASE_URL` | `https://www.wadifa-info.com` | Scraper target base URL |
| `LIST_PATH` | `/fr/concours-emplois-publics-maroc` | Listing page path |
| `LIST_SORT_BY` | `4` | Sort parameter for listings |
| `USER_AGENT` | Chrome 120 UA string | HTTP User-Agent for scraper requests |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Web dashboard with matched concours |
| `GET` | `/feed.xml` | RSS 2.0 feed (edge-cached) |
| `GET` | `/healthz` | Health check (`{ ok: true }`) |
| `GET` | `/unsubscribe?token=...` | Unsubscribe confirmation page |
| `POST` | `/api/subscribe` | Add email subscriber |
| `POST` | `/api/unsubscribe` | Remove email subscriber (token-verified) |
| `POST` | `/api/cron/refresh` | Trigger scrape + email notifications |

### Cron Refresh

`POST /api/cron/refresh` scrapes for new matches and emails subscribers a digest.

- If `CRON_SECRET` is set, include `x-cron-secret: <secret>` header
- Add `?dryRun=1` to scrape without sending emails
- Add `?force=1` to bypass the in-memory cache

Trigger this endpoint from an external scheduler like [cron-job.org](https://cron-job.org), GitHub Actions, or a system crontab.

## Project Structure

```
src/
  app/
    page.tsx                    # Home page (server component)
    subscribe-card.tsx          # Email subscription form (client component)
    layout.tsx                  # Root layout
    globals.css                 # Theme, fonts, CSS variables
    icon.svg                    # Favicon
    feed.xml/route.ts           # RSS feed endpoint
    healthz/route.ts            # Health check
    unsubscribe/                # Unsubscribe confirmation page
    api/
      subscribe/route.ts        # Subscribe API
      unsubscribe/route.ts      # Unsubscribe API
      cron/refresh/route.ts     # Cron refresh API
  lib/
    config.ts                   # Central configuration
    wadifa.ts                   # Web scraper + keyword matcher
    wadifa-cache.ts             # In-memory TTL cache
    concours-store.ts           # Vercel KV persistence
    rss.ts                      # RSS 2.0 feed builder
    brevo.ts                    # Brevo API client
    mailer.ts                   # Email composition + sending
    date.ts                     # Date parsing utilities
    normalize.ts                # Text normalization
    unsubscribe-token.ts        # HMAC token signing/verification
scripts/
  smoke-http.ts                 # HTTP smoke test suite
  selftest.ts                   # End-to-end self-test
```

## Testing

```sh
# Smoke tests against a running server
bun run test:smoke -- --url=http://localhost:3000

# Full self-test (build, start server, run smoke tests, shutdown)
bun run test:self
```

## License

GNU v3.0
