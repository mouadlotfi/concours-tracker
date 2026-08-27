# Repository Guidelines

## Project Overview

**concours-tracker** is a serverless application deployed to Cloudflare Workers that monitors and indexes Moroccan public-sector IT recruitment competitions (*concours*) from [wadifa-info.com](https://www.wadifa-info.com). It runs a hybrid rules + AI classification pipeline to filter listings specifically for software and web development roles, persists active listings in Cloudflare D1 (SQLite), and serves an SSR web interface, an RSS feed, and email notifications via Brevo.

---

## Architecture & Data Flow

```
[Cron Trigger (every 5h) / GET /api/refresh]
                    │
                    ▼
          [src/lib/scraper.ts]
      (Scrapes wadifa-info.com)
                    │
                    ▼
       [src/lib/classification.ts]
      (Rules: Strong Dev vs Generic IT)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
    [Definite]             [Ambiguous]
(Accept / Reject)               │
                                ▼
                      [src/lib/ai-filter.ts]
                    (OpenRouter LLM + PDF OCR)
                                │
                                ▼
                    [isAdmissibleAiEvidence]
                      (Guardrail validation)
                                │
                    ┌───────────┘
                    ▼
         [src/lib/concours-store.ts]
          (Merge, Prune & Sync to D1)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  [src/lib/mailer.ts]     [src/index.tsx]
 (Notify via Brevo)     (SSR Web & /feed.xml)
```

1. **Scraping**: `src/lib/scraper.ts` fetches listings via Cheerio, decodes HTML entities, and normalizes URLs and deadline timestamps.
2. **Hybrid Classification**:
   - **Deterministic Rules (`src/lib/classification.ts`)**: Fast regex patterns for French and Arabic keywords (e.g., *développement web*, *برمجة*) reject management roles, accept explicit software roles, and flag generic IT (*informatique*) as ambiguous.
   - **AI Filter (`src/lib/ai-filter.ts`)**: Ambiguous listings and attached official PDFs are batched in pairs to OpenRouter (`openrouter/free` or configured model).
   - **Guardrail**: Strict validation ensures AI decisions cite exact quotes from the listing or PDF text before marking an item as relevant.
3. **Storage & Pruning (`src/lib/concours-store.ts`)**: Merges fresh listings with existing D1 database records, preserving prior classification decisions and pruning expired deadlines.
4. **Distribution**:
   - Web UI (Hono JSX SSR) at `/`.
   - RSS Feed at `/feed.xml` with XSL stylesheet formatting (`/feed.xsl`).
   - Transactional & digest email notifications via Brevo (`/api/subscribe`, `/api/unsubscribe`, `/unsubscribe`).

---

## Key Directories

```
.
├── src/
│   ├── index.tsx              # Hono application routing, worker fetch & scheduled handler
│   ├── components/            # SSR JSX UI components (ConcoursList, SubscribeCard)
│   └── lib/                   # Core business logic, scraping, classification, storage, mailer
├── migrations/                # Cloudflare D1 SQL schema migrations
├── public/                    # Static assets (CSS, self-hosted fonts, SVG icons, feed.xsl)
└── schema.sql                 # D1 base SQLite schema reference
```

- `src/lib/`: Domain modules (pure utilities, scrapers, API clients, DB operations).
- `src/components/`: Hono HTML template components using `hono/html`.
- `public/`: Static files served directly by Cloudflare Workers asset binding.

---

## Development Commands

Always use **Bun** for local development, testing, and script execution:

```bash
# Install dependencies
bun install

# Start local worker with Wrangler
bun run dev             # wranger dev (http://localhost:8787)

# Run full test suite
bun test

# Run a specific test file
bun test src/lib/classification.test.ts

# Typecheck / Lint without emit
bun run lint            # tsc -p tsconfig.json --noEmit

# Deploy to Cloudflare Workers
bun run deploy          # wrangler deploy
```

---

## Code Conventions & Common Patterns

### TypeScript & Typing
- **No `any`**: Strictly avoid `any` or `as any`. Use domain interfaces, `unknown` with type guards, or Zod schemas for external payloads.
- **Environment Bindings**: Worker environment variables and bindings are typed via `Env` in `src/lib/config.ts`. Hand handlers receive `c.env`.
- **Path Aliases**: `@/*` maps to `./src/*` (configured in `tsconfig.json`).

### Async & Error Handling
- **Graceful Degradation**: External API failures (OpenRouter, Brevo, remote scraping) log structured JSON errors and return fallbacks rather than crashing worker execution.
- **Bounded Streams**: `readBoundedText` and `readBoundedBytes` in `src/lib/scraper.ts` prevent memory exhaustion on large remote downloads (PDF cap at 3MB).
- **Subrequest Budgeting**: To stay within Cloudflare Worker subrequest limits, detail scraping is restricted to ambiguous or relevant items.

### Feature Flags & Configuration
- External services are gated by helper functions in `src/lib/config.ts`:
  - `mailEnabled(env)`: checks `SMTP_API_KEY` and `SMTP_SENDER_EMAIL`.
  - `subscribersEnabled(env)`: checks `SMTP_API_KEY` and `SMTP_LIST_ID`.
  - `unsubscribeEnabled(env)`: checks `UNSUBSCRIBE_SECRET`.

### Security & Tokens
- **HMAC Tokens**: Email unsubscribe links use stateless HMAC-SHA256 tokens (`src/lib/unsubscribe-token.ts`) with timing-safe validation (`timingSafeEqual`) and native `base64url` serialization.
- **Turnstile Captcha**: Cloudflare Turnstile token validation protects `/api/subscribe` against spam.

---

## Important Files

| File | Purpose |
|------|---------|
| `src/index.tsx` | Main worker entry point, Hono routes, and `scheduled()` cron handler. |
| `src/lib/config.ts` | Configuration defaults, `Env` interface, and service feature flags. |
| `src/lib/scraper.ts` | Web scraper for Moroccan public sector listings via Cheerio. |
| `src/lib/classification.ts` | Deterministic regex rules, Arabic/French keyword matching, and content hash generator. |
| `src/lib/ai-filter.ts` | OpenRouter LLM API client with Cloudflare AI PDF parser integration. |
| `src/lib/concours-store.ts` | D1 SQLite load, merge, prune, and transaction sync operations. |
| `src/lib/mailer.ts` | Brevo email dispatcher for welcome messages and new concours alerts. |
| `wrangler.toml` | Cloudflare Worker runtime config, D1 bindings, cron schedules, and observability. |

---

## Runtime/Tooling Preferences

- **Runtime & Package Manager**: **Bun** (`bun`, `bun install`, `bun test`). Do not use `npm` or `yarn`.
- **Deployment Platform**: **Cloudflare Workers** with `nodejs_compat` enabled.
- **Database**: **Cloudflare D1** (`concours-db`).
- **Templating**: **Hono JSX / HTML** (`hono/html`), avoiding heavy frontend frameworks.

---

## Testing & QA

- **Framework**: `bun:test` built-in test runner.
- **Conventions**:
  - Tests are co-located with source files using the `*.test.ts` naming convention.
  - Test files are excluded from the `tsc` build output.
  - Tests are deterministic, fast unit/integration suites without live external network calls.
  - Deterministic time is passed explicitly via `Date` objects (e.g. `now = new Date('...')`) rather than global mocks.
- **Run Tests**:
  ```bash
  bun test
  ```
- **Coverage Areas**:
  - `classification.test.ts`: Rule outcomes (accept/reject/ambiguous), Arabic/French keyword parsing, content hash stability.
  - `scraper.test.ts`: HTML card extraction and field merging invariants.
  - `unsubscribe-token.test.ts`: HMAC signature generation, tamper detection, and malformed token rejection.
  - `ConcoursList.test.ts`: SSR JSX markup, business-day pinning cutoff, and empty state rendering.
