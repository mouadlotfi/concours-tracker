import { config } from './config';
import { isoToRfc822 } from './date';
import type { MatchedConcours } from './wadifa';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
;
}

function cdata(value: string): string {
  // Avoid breaking CDATA.
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function buildRss(items: MatchedConcours[]): string {
  const now = new Date().toUTCString();

  const channelTitle = 'Concours Développement Web';
  const channelLink = config.appBaseUrl;
  const channelDesc = 'Concours publics lies au developpement web';

  const renderedItems = items
    .map((it) => {
      const title = escapeXml(it.title || 'Sans titre');
      const bestLink = it.sourceUrl || it.wadifaUrl;
      const link = escapeXml(bestLink);
      const guid = escapeXml(it.id);
      const pub = it.depositDeadlineIso ? isoToRfc822(it.depositDeadlineIso) : now;

      const lines: string[] = [];
      if (it.depositDeadlineIso) lines.push(`<p><strong>Date limite</strong>: ${escapeXml(it.depositDeadlineIso.slice(0, 10).split('-').reverse().join('-'))}</p>`);
      if (it.concoursDateIso) lines.push(`<p><strong>Date du concours</strong>: ${escapeXml(it.concoursDateIso.slice(0, 10).split('-').reverse().join('-'))}</p>`);
      lines.push(
        `<p><strong>Wadifa</strong>: <a href="${escapeXml(it.wadifaUrl)}">${escapeXml(it.wadifaUrl)}</a></p>`
      );
      if (it.sourceUrl) {
        lines.push(
          `<p><strong>Lien du concours</strong>: <a href="${escapeXml(it.sourceUrl)}">${escapeXml(it.sourceUrl)}</a></p>`
        );
      }

      const detailEntries = Object.entries(it.details || {}).filter(([k, v]) => k && v);
      if (detailEntries.length) {
        const rows = detailEntries
          .slice(0, 24)
          .map(([k, v]) => `<tr><td><strong>${escapeXml(k)}</strong></td><td>${escapeXml(v)}</td></tr>`)
          .join('');
        lines.push(
          `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`
        );
      }
      const descHtml = lines.join('');
      return `
      <item>
        <title>${title}</title>
        <link>${link}</link>
        <guid isPermaLink="false">${guid}</guid>
        <pubDate>${escapeXml(pub)}</pubDate>
        <description>${cdata(descHtml)}</description>
      </item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDesc)}</description>
    <language>fr</language>
    <lastBuildDate>${escapeXml(now)}</lastBuildDate>${renderedItems}
  </channel>
</rss>`;
}
