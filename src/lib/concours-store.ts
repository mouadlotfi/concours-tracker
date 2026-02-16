import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import type { MatchedConcours } from './wadifa';
import { isOpenDeadline } from './wadifa';

export type MergeResult = { all: MatchedConcours[]; newItems: MatchedConcours[] };

const FILENAME = 'concours.json';

function filePath(): string {
  return join(config.dataDir, FILENAME);
}

function ensureDir(): void {
  mkdirSync(config.dataDir, { recursive: true });
}

/* ── Read / Write ─────────────────────────────────── */

export function loadAll(): MatchedConcours[] {
  try {
    const raw = readFileSync(filePath(), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveAll(items: MatchedConcours[]): void {
  ensureDir();
  // Atomic write: write to temp file, then rename (POSIX atomic).
  const tmp = filePath() + '.tmp';
  writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
  renameSync(tmp, filePath());
}

/* ── Merge & Prune ────────────────────────────────── */

let mergeLock: Promise<MergeResult> | null = null;

/**
 * Upsert freshly-scraped items into the persistent store,
 * prune concours whose deadline has passed, and return the
 * full list plus the genuinely new items.
 *
 * Uses a simple in-process lock to prevent concurrent
 * read-modify-write races.
 */
export async function mergeAndPrune(
  freshItems: MatchedConcours[],
): Promise<MergeResult> {
  // Serialize concurrent calls
  while (mergeLock) {
    await mergeLock;
  }

  let resolve!: (v: MergeResult) => void;
  mergeLock = new Promise<MergeResult>((r) => {
    resolve = r;
  });

  try {
    const stored = loadAll();
    const map = new Map<string, MatchedConcours>();
    for (const item of stored) map.set(item.id, item);

    const newItems: MatchedConcours[] = [];
    for (const item of freshItems) {
      if (!map.has(item.id)) newItems.push(item);
      map.set(item.id, item);
    }

    // Prune expired (deadline passed)
    for (const [id, item] of map) {
      if (!isOpenDeadline(item.depositDeadlineIso)) {
        map.delete(id);
      }
    }

    // Sort by deadline ascending (null = no deadline → sort last)
    const all = [...map.values()].sort((a, b) => {
      const ta = a.depositDeadlineIso
        ? new Date(a.depositDeadlineIso).getTime()
        : Infinity;
      const tb = b.depositDeadlineIso
        ? new Date(b.depositDeadlineIso).getTime()
        : Infinity;
      return ta - tb;
    });

    saveAll(all);
    const result: MergeResult = { all, newItems };
    resolve(result);
    return result;
  } finally {
    mergeLock = null;
  }
}
