import { describe, expect, test } from 'bun:test';
import type { Env } from './config';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';

describe('unsubscribe-token', () => {
  const env = { UNSUBSCRIBE_SECRET: 'super-secret-key-123' } as Env;

  test('creates and verifies round-trip token', () => {
    const email = 'user@example.com';
    const token = createUnsubscribeToken(email, env);
    const result = verifyUnsubscribeToken(token, env);
    expect(result).toEqual({ ok: true, email });
  });

  test('rejects tampered token', () => {
    const token = createUnsubscribeToken('user@example.com', env);
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyUnsubscribeToken(tampered, env)).toEqual({ ok: false });
  });

  test('rejects malformed token', () => {
    expect(verifyUnsubscribeToken('invalid-token', env)).toEqual({ ok: false });
  });
});
