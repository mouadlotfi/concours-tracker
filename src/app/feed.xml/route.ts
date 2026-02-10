import { config } from '@/lib/config';
import { buildRss } from '@/lib/rss';
import { getMatchedConcoursCached } from '@/lib/wadifa-cache';

export const runtime = 'nodejs';

export async function GET() {
  const { items: all } = await getMatchedConcoursCached();
  const items = all.slice(0, config.maxFeedItems);
  const xml = buildRss(items);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Cache at the edge to keep Vercel Hobby fast.
      'Cache-Control': `public, s-maxage=${config.cacheSeconds}, stale-while-revalidate=86400`,
    },
  });
}

export async function HEAD() {
  return new Response(null, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, s-maxage=${config.cacheSeconds}, stale-while-revalidate=86400`,
    },
  });
}
