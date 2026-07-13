import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool, schema, type Db } from '@homi/db';
import { pruneIdempotencyKeys } from '../src/prune/prune-idempotency-keys';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

const pool = createPool(process.env.DATABASE_URL);
const db: Db = createDb(pool);

describe('pruneIdempotencyKeys (HOMI-26)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('deletes only keys older than the retention window', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ name: 'Prune', email: `prune-${randomUUID().slice(0, 8)}@example.com` })
      .returning();
    const userId = user!.id;

    const now = new Date('2026-07-13T12:00:00Z');
    const ageDays = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const row = (endpoint: string, createdAt: Date) => ({
      key: randomUUID(),
      userId,
      endpoint,
      requestHash: 'h',
      responseStatus: 201,
      responseBody: {},
      createdAt,
    });
    await db
      .insert(schema.idempotencyKeys)
      .values([row('old', ageDays(31)), row('edge', ageDays(29)), row('fresh', ageDays(1))]);

    const { deleted } = await pruneIdempotencyKeys(db, 30, now);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ endpoint: schema.idempotencyKeys.endpoint })
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.userId, userId));
    expect(remaining.map((r) => r.endpoint).sort()).toEqual(['edge', 'fresh']);
  });

  it('rejects a nonsensical retention window instead of deleting everything', async () => {
    await expect(pruneIdempotencyKeys(db, 0)).rejects.toThrow();
    await expect(pruneIdempotencyKeys(db, Number.NaN)).rejects.toThrow();
  });
});
