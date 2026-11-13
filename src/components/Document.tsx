import { html, raw } from 'hono/html';

export interface PageHeadInput {
  title: string;
  description: string;
  path: string;    // '/' or '/c/123'
  baseUrl: string; // may have a trailing slash
}

export function pageHead(input: PageHeadInput) {
  const base = input.baseUrl.replace(/\/+$/, '');
  const canonical = `${base}${input.path}`;

  return html`
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${input.title}</title>
    <meta name="description" content="${input.description}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${input.title}">
    <meta property="og:description" content="${input.description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${base}/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Concours informatique au Maroc : offres dev web">
    <meta property="og:site_name" content="Concours Tracker">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="alternate" type="application/rss+xml" title="Concours Développement Informatique" href="${base}/feed.xml">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/css/globals.css">
    <link rel="stylesheet" href="/css/page.css">
  `;
}

export function jsonLd(data: unknown) {
  const json = (JSON.stringify(data) ?? 'null').replace(/</g, '\\u003c');
  return html`<script type="application/ld+json">${raw(json)}</script>`;
}

export function SiteFooter() {
  return html`
    <div class="footer">
      <a href="https://www.emploi-public.ma" target="_blank" rel="noreferrer noopener">source: emploi-public.ma</a>
      <span class="sep"></span>
      <a href="/feed.xml">RSS</a>
      <span class="sep"></span>
      <a href="https://github.com/mouadlotfi/concours-tracker" target="_blank" rel="noreferrer noopener">Github</a>
    </div>
  `;
}
