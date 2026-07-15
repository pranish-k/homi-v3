import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';

export { isUniqueViolation } from '@homi/db';

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
): Promise<{ status: number; body: unknown } | null> {
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
