export function isoToRfc822(iso: string): string {
  const d = new Date(iso);
  // If invalid, fall back to now.
  const use = Number.isNaN(d.getTime()) ? new Date() : d;
  return use.toUTCString();
}

export function parseDdMmYyyyToIsoUtc(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;

  const day = Number.parseInt(m[1] || '', 10);
  const month = Number.parseInt(m[2] || '', 10);
  const year = Number.parseInt(m[3] || '', 10);
  const hour = m[4] ? Number.parseInt(m[4], 10) : 0;
  const minute = m[5] ? Number.parseInt(m[5], 10) : 0;

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const dt = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0));
  if (Number.isNaN(dt.getTime())) return null;

  // Reject dates that rolled over (e.g. 31/02 -> 03/03).
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;

  return dt.toISOString();
}

export function endOfDayIsoUtc(ddmmyyyy: string): string | null {
  const base = parseDdMmYyyyToIsoUtc(ddmmyyyy);
  if (!base) return null;
  const d = new Date(base);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}
