/**
 * Worker service (spec 5.2). HOMI-13 gives it its first real job:
 * posting due recurring bills. Job rules from day one:
 * - every job idempotent and retry-safe (H4): bill materialization is
 *   keyed on (template_id, period) with a unique constraint;
 * - all schedules computed in the house timezone, server-side (H5);
 * - alert on "expected job did not run", not only on errors.
 *
 * A poll loop, not a queue: the due-scan is one indexed query and the
 * unique key makes overlapping runs harmless, so BullMQ machinery buys
 * nothing yet. Revisit when jobs need retries with backoff (HOMI-18/19).
 */
import { createDb, createPool } from '@homi/db';
import { Redis } from 'ioredis';
import { postDueBills, type PublishHint } from './bills/post-due-bills';

const POLL_INTERVAL_MS = 60_000;

function buildPublisher(): { publish: PublishHint; close: () => Promise<void> } {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      // same rule as the API: prod without the shared bus is silently wrong
      throw new Error('REDIS_URL must be set in production (realtime fan-out)');
    }
    // dev without Redis: hints cannot cross processes anyway; a missed
    // hint self-heals on the next snapshot refetch (H6)
    return { publish: () => undefined, close: async () => undefined };
  }
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  return {
    publish: (houseId, hint) => {
      void redis
        .publish(`house:${houseId}`, JSON.stringify(hint))
        .catch((err) => console.error('[worker] publish failed', err));
    },
    close: async () => {
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool(url);
  const db = createDb(pool);
  const publisher = buildPublisher();
  console.log('HOMI worker up (bill posting every 60s)');

  let stopping = false;
  let running = false;

  const tick = async () => {
    if (running || stopping) return; // a slow run must not stack a second one
    running = true;
    try {
      const result = await postDueBills(db, new Date(), publisher.publish);
      if (result.posted.length || result.alreadyPosted.length || result.paused.length) {
        console.log(
          `[bills] posted=${result.posted.length} alreadyPosted=${result.alreadyPosted.length} paused=${result.paused.length}`,
        );
      }
    } catch (err) {
      // one bad tick must not kill the worker; the next tick retries
      console.error('[bills] posting run failed', err);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
  void tick();

  const shutdown = async () => {
    stopping = true;
    clearInterval(interval);
    await publisher.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
