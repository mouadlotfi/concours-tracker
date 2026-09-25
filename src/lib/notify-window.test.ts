import { describe, expect, test } from 'bun:test';
import type { Env } from './config';
import { isNotifySlot, localHour } from './notify-window';

describe('localHour', () => {
  test('resolves the hour in the requested timezone', () => {
    const at = new Date('2026-09-25T07:00:00.000Z');
    expect(localHour(at, 'UTC')).toBe(7);
    expect(localHour(at, 'Asia/Tokyo')).toBe(16); // UTC+9, no DST
    expect(localHour(at, 'Africa/Casablanca')).toBe(8); // UTC+1
  });
});

describe('isNotifySlot', () => {
  test('matches the default 08:00 and 18:00 Casablanca slots', () => {
    const env = {} as Env;
    // Casablanca is UTC+1 in September, so 07:00Z and 17:00Z are the slots.
    expect(isNotifySlot(new Date('2026-09-25T07:00:00.000Z'), env)).toBe(true);
    expect(isNotifySlot(new Date('2026-09-25T17:00:00.000Z'), env)).toBe(true);
    expect(isNotifySlot(new Date('2026-09-25T06:00:00.000Z'), env)).toBe(false); // 07:00 local
    expect(isNotifySlot(new Date('2026-09-25T08:00:00.000Z'), env)).toBe(false); // 09:00 local
    expect(isNotifySlot(new Date('2026-09-25T16:00:00.000Z'), env)).toBe(false); // 17:00 local
    expect(isNotifySlot(new Date('2026-09-25T18:00:00.000Z'), env)).toBe(false); // 19:00 local
  });

  test('is minute-independent within the slot hour', () => {
    const env = {} as Env;
    expect(isNotifySlot(new Date('2026-09-25T07:30:00.000Z'), env)).toBe(true);
  });

  test('does not treat 00:00 as a slot', () => {
    const env = {} as Env;
    expect(isNotifySlot(new Date('2026-09-25T00:00:00.000Z'), env)).toBe(false); // 01:00 local
  });

  test('honours a custom timezone and hours', () => {
    const env = { NOTIFY_TIMEZONE: 'Asia/Tokyo', NOTIFY_HOURS: '9,21' } as Env;
    expect(isNotifySlot(new Date('2026-09-25T00:00:00.000Z'), env)).toBe(true); // 09:00 JST
    expect(isNotifySlot(new Date('2026-09-25T07:00:00.000Z'), env)).toBe(false); // 16:00 JST
  });

  test('follows the Morocco UTC+0 offset change', () => {
    const env = {} as Env;
    // With the offset at UTC+0 the slot moves to 08:00Z, not 07:00Z.
    expect(isNotifySlot(new Date('2027-02-15T08:00:00.000Z'), env)).toBe(true);
    expect(isNotifySlot(new Date('2027-02-15T07:00:00.000Z'), env)).toBe(false);
  });

  test('falls back to defaults for invalid configuration', () => {
    expect(isNotifySlot(new Date('2026-09-25T07:00:00.000Z'), { NOTIFY_HOURS: 'nope' } as Env)).toBe(true);
  });
});
