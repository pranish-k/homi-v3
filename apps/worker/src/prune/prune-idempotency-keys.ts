import { sql } from 'drizzle-orm';
import { type Db } from '@homi/db';

/**
 * HOMI-26 (review M7): idempotency keys exist so a retry inside its
 * client's retry horizon replays instead of re-executing; after the
 * retention window they are dead weight. 30 days is generous - client
 * retries live in minutes - but keeps a month of "why did this replay"
 * forensics.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/** Bounded per pass so the delete never holds a long lock; loops until done. */
const BATCH = 5000;

export async function pruneIdempotencyKeys(
  db: Db,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error(`retentionDays must be a positive number, got ${retentionDays}`);
  }
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let deleted = 0;
  for (;;) {
    const result = await db.execute(sql`
      delete from idempotency_keys
      where (key, user_id, endpoint) in (
        select key, user_id, endpoint from idempotency_keys
        where created_at < ${cutoff.toISOString()}
        limit ${BATCH}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < BATCH) return { deleted };
  }
}
