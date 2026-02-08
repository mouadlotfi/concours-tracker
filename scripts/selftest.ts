import { spawn } from 'node:child_process';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getArgValue(prefix: string): string | null {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length);
}

function port(): number {
  const raw = (getArgValue('--port=') || process.env.TEST_PORT || '3100').trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 3100;
  return n;
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.ok === true) return true;
      }
    } catch {
      // ignore
    }
    await sleep(250);
  }
  return false;
}

async function runCmd(cmd: string, args: string[], env?: Record<string, string>): Promise<number> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...(env || {}) },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const p = port();
  const baseUrl = `http://localhost:${p}`;

  console.log(`[selftest] build`);
  const buildCode = await runCmd('bun', ['run', 'build']);
  if (buildCode !== 0) process.exit(buildCode);

  console.log(`[selftest] start server port=${p}`);
  const server = spawn('bunx', ['next', 'start', '-p', String(p)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Make sure generated links match the server we're testing.
      APP_BASE_URL: baseUrl,
    },
  });

  const healthy = await waitForHealthy(baseUrl, 30_000);
  if (!healthy) {
    console.error('[selftest] server did not become healthy in time');
    server.kill('SIGTERM');
    process.exit(1);
  }

  console.log(`[selftest] run smoke checks`);
  const smokeCode = await runCmd('bun', ['run', './scripts/smoke-http.ts', `--url=${baseUrl}`], {
    TEST_BASE_URL: baseUrl,
  });

  console.log('[selftest] stop server');
  server.kill('SIGTERM');
  await sleep(500);
  if (!server.killed) server.kill('SIGKILL');

  process.exit(smokeCode);
}

await main();
