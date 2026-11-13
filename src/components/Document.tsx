import { html, raw } from 'hono/html';

export interface PageHeadInput {
  title: string;
  description: string;
  path: string;    // '/' or '/c/123'
  baseUrl: string; // may have a trailing slash
}

export function pageHead(input: PageHeadInput) {
  const base = input.baseUrl.replace(/\/+$/, '');
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const canonical = `${base}${path}`;

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
    <meta property="og:image" content="${base}/screenshot.png">
    <meta property="og:site_name" content="Concours Tracker">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${input.title}">
    <meta name="twitter:description" content="${input.description}">
    <meta name="twitter:image" content="${base}/screenshot.png">
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
