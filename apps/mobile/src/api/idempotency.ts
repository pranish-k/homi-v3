/**
 * The idempotency key's lifecycle for a money mutation (H1), kept free of
 * Expo imports so it runs under plain vitest.
 *
 * A key names one intended write, and the server enforces exactly that:
 * the same key with an identical body replays the stored response, and the
 * same key with a different body is a 409 (apps/api/src/lib/idempotency.ts).
 * So the key is bound to the serialized request body:
 *
 * - retrying an unchanged form reuses the key, so a timeout followed by a
 *   second tap cannot post twice;
 * - editing the form after a failure is a different request, so it gets a
 *   new key rather than a guaranteed 409.
 */

export type PendingRequest = { key: string; body: string };

/** Reuses `pending` when `body` is unchanged, otherwise mints a new key. */
export function bindIdempotencyKey(
  pending: PendingRequest | undefined,
  body: unknown,
  mint: () => string,
): PendingRequest {
  const serialized = JSON.stringify(body);
  if (pending !== undefined && pending.body === serialized) return pending;
  return { key: mint(), body: serialized };
}

/**
 * HTTP 409 on a money write means the key was already used for a different
 * request, so whether the earlier one landed is unknown from here. The key
 * must be dropped (it can never succeed again) and the person pointed at
 * the ledger rather than told to retry into a possible duplicate.
 */
export const IDEMPOTENCY_CONFLICT = 409;
