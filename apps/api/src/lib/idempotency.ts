import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isUniqueViolation, schema, type Db } from '@homi/db';
import { hashRequest } from './request-hash';

export { isUniqueViolation };

/** A Db or a transaction handle within one; both run the same query builders. */
export type DbConn = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Records the mutation's response under (key, user, endpoint). MUST be
 * called on the mutation's own transaction handle so the response
 * commits or rolls back with the write it describes.
 */
export type StoreResponse = (tx: DbConn, response: StoredResponse) => Promise<void>;

/**
 * H1 replay lookup, shared by every idempotency-keyed mutation. Scoped
 * to (key, user, endpoint); a matching key with a different body is a
 * client bug and gets a 409, never someone else's stored response.
 */
export async function findStoredResponse(
  db: Db,
  key: string,
  userId: string,
  endpoint: string,
  requestHash: string,
): Promise<StoredResponse | null> {
  const [row] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.key, key),
        eq(schema.idempotencyKeys.userId, userId),
        eq(schema.idempotencyKeys.endpoint, endpoint),
      ),
    );
  if (!row) return null;
  if (row.requestHash !== requestHash) {
    throw new ConflictException('Idempotency-Key was already used with a different request');
  }
  return { status: row.responseStatus, body: row.responseBody };
}

/**
 * Sprint 4 review carryover: every idempotency-keyed mutation is H1 by
 * construction, not by copying the same three-step dance. The wrapper
 * owns the dance - replay lookup before executing, and the replay-after-
 * losing-a-race when a concurrent duplicate trips the idempotency_keys
 * primary key (or any unique index inside the mutation, e.g. a bill
 * period already posted).
 *
 * `execute` runs the mutation and must call `store(tx, response)` inside
 * its transaction once the response body is known, so the stored
 * response commits atomically with the write itself.
 */
export async function withIdempotency(
  db: Db,
  opts: { key: string; userId: string; endpoint: string; scope: unknown },
  execute: (store: StoreResponse) => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const requestHash = hashRequest(opts.scope);
  const replayed = await findStoredResponse(db, opts.key, opts.userId, opts.endpoint, requestHash);
  if (replayed) return replayed;

  const store: StoreResponse = async (tx, response) => {
    await tx.insert(schema.idempotencyKeys).values({
      key: opts.key,
      userId: opts.userId,
      endpoint: opts.endpoint,
      requestHash,
      responseStatus: response.status,
      responseBody: response.body,
    });
  };

  try {
    return await execute(store);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const stored = await findStoredResponse(db, opts.key, opts.userId, opts.endpoint, requestHash);
      if (stored) return stored;
    }
    throw err;
  }
}
