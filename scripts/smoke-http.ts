export {};

type CheckResult = { ok: true } | { ok: false; error: string };

function getArgValue(prefix: string): string | null {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length);
}

function baseUrl(): string {
  const fromArg = getArgValue('--url=');
  const fromEnv = process.env.TEST_BASE_URL;
  const url = (fromArg || fromEnv || 'http://localhost:3000').trim();
  return url.replace(/\/$/, '');
}

async function checkHealth(): Promise<CheckResult> {
  const res = await fetch(`${baseUrl()}/healthz`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { ok: false, error: `/healthz status ${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== true) return { ok: false, error: `/healthz body not ok=true` };
  return { ok: true };
}

async function checkUnsubscribeInvalid(): Promise<CheckResult> {
  const res = await fetch(`${baseUrl()}/api/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: 'invalid-token' }),
  });
  if (!res.ok) return { ok: false, error: `/api/unsubscribe status ${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== false) return { ok: false, error: `/api/unsubscribe should return ok=false on invalid token` };
  return { ok: true };
}

async function checkSubscribeInvalid(): Promise<CheckResult> {
  const res = await fetch(`${baseUrl()}/api/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  if (res.status !== 400) return { ok: false, error: `/api/subscribe invalid email expected 400, got ${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== false) return { ok: false, error: `/api/subscribe invalid email should return ok=false` };
  return { ok: true };
}

async function checkFeedXml(): Promise<CheckResult> {
  const res = await fetch(`${baseUrl()}/feed.xml`, { headers: { Accept: 'application/rss+xml' } });
  if (!res.ok) return { ok: false, error: `/feed.xml status ${res.status}` };
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/rss+xml') && !ct.includes('application/xml') && !ct.includes('text/xml')) {
    return { ok: false, error: `/feed.xml unexpected content-type: ${ct}` };
  }
  const xml = await res.text();
  if (!xml.includes('<rss') || !xml.includes('<channel>')) return { ok: false, error: `/feed.xml is not an RSS feed` };
  return { ok: true };
}

async function checkCronDryRun(): Promise<CheckResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.CRON_SECRET) headers['x-cron-secret'] = process.env.CRON_SECRET;

  const res = await fetch(`${baseUrl()}/api/cron/refresh?dryRun=1`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) return { ok: false, error: `/api/cron/refresh dryRun status ${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== true) return { ok: false, error: `/api/cron/refresh dryRun should return ok=true` };
  if (!data.result || data.result.dryRun !== true) return { ok: false, error: `/api/cron/refresh dryRun should report dryRun=true` };
  return { ok: true };
}

async function run() {
  const checks: Array<[string, () => Promise<CheckResult>]> = [
    ['healthz', checkHealth],
    ['feed.xml', checkFeedXml],
    ['subscribe invalid', checkSubscribeInvalid],
    ['unsubscribe invalid', checkUnsubscribeInvalid],
    ['cron refresh dryRun', checkCronDryRun],
  ];

  console.log(`[smoke] baseUrl=${baseUrl()}`);

  let failed = 0;
  for (const [name, fn] of checks) {
    try {
      const r = await fn();
      if (r.ok) {
        console.log(`[ok] ${name}`);
      } else {
        failed++;
        console.log(`[fail] ${name}: ${r.error}`);
      }
    } catch (e) {
      failed++;
      console.log(`[fail] ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failed) {
    console.log(`[smoke] FAIL (${failed} check(s))`);
    process.exit(1);
  }
  console.log('[smoke] OK');
}

await run();
