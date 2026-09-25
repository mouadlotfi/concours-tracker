import { describe, expect, test } from 'bun:test';
import type { Env } from './config';
import { CONFIRM_TTL_SECONDS, createConfirmToken, verifyConfirmToken } from './confirm-token';
import { createUnsubscribeToken } from './unsubscribe-token';

const env = { SUBSCRIBE_CONFIRM_SECRET: 'confirm-secret-123' } as Env;

describe('confirm-token', () => {
  test('creates and verifies a round-trip token', () => {
    const email = 'user@example.com';
    const now = new Date('2026-09-25T12:00:00.000Z');
    const token = createConfirmToken(email, env, now);
    expect(verifyConfirmToken(token, env, now)).toEqual({ ok: true, email });
  });

  test('rejects a tampered token', () => {
    const token = createConfirmToken('user@example.com', env);
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyConfirmToken(tampered, env)).toEqual({ ok: false, reason: 'invalid' });
  });

  test('rejects a malformed token', () => {
    expect(verifyConfirmToken('not-a-token', env)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyConfirmToken('', env)).toEqual({ ok: false, reason: 'invalid' });
  });

  test('expires after the TTL', () => {
    const issued = new Date('2026-09-25T12:00:00.000Z');
    const token = createConfirmToken('user@example.com', env, issued);
    const justInside = new Date(issued.getTime() + (CONFIRM_TTL_SECONDS - 1) * 1000);
    const justOutside = new Date(issued.getTime() + (CONFIRM_TTL_SECONDS + 1) * 1000);
    expect(verifyConfirmToken(token, env, justInside)).toEqual({ ok: true, email: 'user@example.com' });
    expect(verifyConfirmToken(token, env, justOutside)).toEqual({ ok: false, reason: 'expired' });
  });

  test('refuses an unsubscribe token used as a confirmation token', () => {
    const shared = { UNSUBSCRIBE_SECRET: 'shared-secret' } as Env;
    const unsubscribeToken = createUnsubscribeToken('user@example.com', shared);
    expect(verifyConfirmToken(unsubscribeToken, shared)).toEqual({ ok: false, reason: 'invalid' });
  });

  test('throws when no secret is configured', () => {
    expect(() => createConfirmToken('user@example.com', {} as Env)).toThrow();
  });

  test('falls back to the unsubscribe secret', () => {
    const fallback = { UNSUBSCRIBE_SECRET: 'only-unsub' } as Env;
    const token = createConfirmToken('user@example.com', fallback);
    expect(verifyConfirmToken(token, fallback)).toEqual({ ok: true, email: 'user@example.com' });
  });
});
