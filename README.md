<div align="center">

# Concours Tracker

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-Framework-e36002?style=flat-square)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-UI-61dafb?style=flat-square&logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

:star: If you find this project helpful, please consider starring it on GitHub!

[Overview](#overview) • [Features](#features) • [Architecture](#architecture) • [Getting Started](#getting-started) • [Deployment](#deployment)

</div>

## Overview

**Concours Tracker** is a fully serverless application designed to monitor the Moroccan public sector job portal (`emploi-public.ma`), intelligently filter for specific IT and Web Development roles using AI, and distribute these opportunities to subscribers via Email and RSS.

Built entirely on the Edge using Cloudflare Workers, Hono, and D1, the application requires zero traditional server infrastructure and scales infinitely.

## Features

- **Serverless Architecture**: Runs entirely on Cloudflare Workers edge network.
- **AI-Powered Filtering**: Uses OpenRouter AI to semantically understand job postings and filter strictly for relevant IT/Web Development positions, bypassing unreliable keyword matching.
- **Automated Scraping**: Periodically scrapes the public job board using Cloudflare Cron Triggers.
- **Email Subscriptions**: Integrated with email (Sendinblue) to automatically send HTML email notifications to subscribers when new jobs are detected.
- **RSS Feed Generation**: Exposes a standard XML RSS feed for easy integration with feed readers and automation tools.
- **Bot Protection**: Subscription forms are protected by Cloudflare Turnstile CAPTCHA.

## Architecture

This project is built using modern edge technologies:

- **Hono API**: Lightweight, ultra-fast web framework tailored for edge networks.
- **Cloudflare D1**: Serverless SQL database built on SQLite to persistently store job postings and AI filtering states.
- **Cloudflare Workers Cron Triggers**: Scheduled background tasks to perform periodic scraping and email dispatching.
- **React (JSX) & Vite**: Renders the frontend interface server-side using Hono's JSX features.

## Getting Started

### Prerequisites

You need the following tools installed locally:

- [Bun](https://bun.sh/) (or Node.js >= 18)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

You will also need API keys for:
- [OpenRouter](https://openrouter.ai/) (for AI filtering)
- [SMTP (e.g. Brevo)](https://app.brevo.com/) (for email distribution)
- [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) (for CAPTCHA)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mouadlotfi/concours-tracker.git
   cd concours-tracker
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Configure environment variables:**
   Create a `.dev.vars` file in the root directory with the following keys:
   ```env
   APP_BASE_URL="http://127.0.0.1:8787"
   SMTP_API_KEY="your-email-key"
   SMTP_SENDER_EMAIL="your-sender-email"
   SMTP_LIST_ID="your-email-list-id"
   SMTP_SENDER_NAME="Concours Tracker"
   CRON_SECRET="your-secure-secret"
   UNSUBSCRIBE_SECRET="your-unsubscribe-secret"
   NEXT_PUBLIC_TURNSTILE_SITE_KEY="1x00000000000000000000AA" # Local testing key
   TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA" # Local testing secret
   OPENROUTER_API_KEY="your-openrouter-key"
   OPENROUTER_MODEL="openrouter/free"
   ```

4. **Initialize local database:**
   ```bash
   bunx wrangler d1 execute concours-db --local --file=schema.sql
   ```

5. **Run the local development server:**
   ```bash
   bunx wrangler dev
   ```

### Local Testing

To manually trigger the scraping and AI-filtering logic in your local environment, run:

```bash
curl "http://127.0.0.1:8787/api/refresh?secret=your-secure-secret&force_email=true"
```
*(The `force_email` flag ensures that a test email is sent to your configured `TEST_EMAIL` address regardless of whether the jobs are new or not).*

To exercise the complete scraper and classifier without changing D1 or sending email, use:

```bash
curl "http://127.0.0.1:8787/api/refresh?secret=your-secure-secret&reclassify=true&dry_run=true"
```

Use `notify=false` without `dry_run=true` when you want to persist the refreshed classifications but suppress email.

Generic IT listings are not rejected from their summary alone. The classifier follows the official Emploi Public page, attaches its decision PDF (including scanned PDFs) for ambiguous listings, and explicitly uses OpenRouter's free `cloudflare-ai` PDF parser with the `openrouter/free` router. PDFs are capped at 3 MB and AI requests are batched in pairs.

## Deployment

Deploying the application to production requires linking your project to Cloudflare and provisioning the necessary resources.

1. **Authenticate Wrangler:**
   ```bash
   bunx wrangler login
   ```

2. **Create Production D1 Database:**
   ```bash
   bunx wrangler d1 create concours-db
   ```
   *Update your `wrangler.toml` with the generated `database_id`.*

3. **Initialize Production Database:**
   ```bash
   bunx wrangler d1 execute concours-db --remote --file=schema.sql
   ```

   For an existing database, apply the checked-in migrations instead:
   ```bash
   bunx wrangler d1 migrations apply concours-db --remote
   ```

4. **Set Production Secrets:**
   You must securely upload all `.dev.vars` secrets into your production Cloudflare Worker using:
   ```bash
   bunx wrangler secret put OPENROUTER_API_KEY
   # Repeat for all other secrets...
   ```

5. **Deploy:**
   ```bash
   bunx wrangler deploy
   ```

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.
