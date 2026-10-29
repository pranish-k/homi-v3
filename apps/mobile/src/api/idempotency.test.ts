import { describe, expect, it } from 'vitest';

import { bindIdempotencyKey } from './idempotency';

const counter = () => {
  let n = 0;
  return () => `key-${++n}`;
};

describe('bindIdempotencyKey', () => {
  it('mints a key for the first attempt', () => {
    const mint = counter();
    expect(bindIdempotencyKey(undefined, { amountCents: 500 }, mint).key).toBe('key-1');
  });

  it('reuses the key while the body is identical, so a retry cannot double-post', () => {
    const mint = counter();
    const first = bindIdempotencyKey(undefined, { amountCents: 500, paidBy: 'a' }, mint);
    const retry = bindIdempotencyKey(first, { amountCents: 500, paidBy: 'a' }, mint);
    expect(retry.key).toBe(first.key);
  });

  it('mints a new key when the body changes, so an edit is not a guaranteed 409', () => {
    const mint = counter();
    const first = bindIdempotencyKey(undefined, { amountCents: 500 }, mint);
    const edited = bindIdempotencyKey(first, { amountCents: 600 }, mint);
    expect(edited.key).not.toBe(first.key);
    expect(edited.body).toBe(JSON.stringify({ amountCents: 600 }));
  });
});
