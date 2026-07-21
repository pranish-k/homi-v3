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
import { createServer } from 'node:http';
import { createDb, createPool } from '@homi/db';
import * as Sentry from '@sentry/node';
import { Redis } from 'ioredis';
import { postDueBills, type PublishHint } from './bills/post-due-bills';
import { createRequestHandler } from './http-server';
import { initSentry } from './observability/sentry';
import { DEFAULT_RETENTION_DAYS, pruneIdempotencyKeys } from './prune/prune-idempotency-keys';

const POLL_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;

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
  // first, so Sentry's global handlers catch startup and process-level
  // crashes too (HOMI-15a); a no-op without SENTRY_DSN
  initSentry();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool(url);
  const db = createDb(pool);
  const publisher = buildPublisher();
  console.log('HOMI worker up (bill posting every 60s)');

  let stopping = false;
  let running = false;

  // returns false only when a run actually executed and threw; a skipped
  // overlap and a clean run both return true (nothing for a caller to alert on)
  const tick = async (): Promise<boolean> => {
    if (running || stopping) return true; // a slow run must not stack a second one
    running = true;
    try {
      const result = await postDueBills(db, new Date(), publisher.publish);
      if (result.posted.length || result.alreadyPosted.length || result.paused.length) {
        console.log(
          `[bills] posted=${result.posted.length} alreadyPosted=${result.alreadyPosted.length} paused=${result.paused.length}`,
        );
      }
      return true;
    } catch (err) {
      // one bad tick must not kill the worker; the next tick retries
      console.error('[bills] posting run failed', err);
      Sentry.captureException(err, { tags: { job: 'bills' } });
      return false;
    } finally {
      running = false;
    }
  };

  // HOMI-26: hourly retention pass; the env override exists for tests
  // and emergencies, not tuning
  const retentionDays = process.env.IDEMPOTENCY_RETENTION_DAYS
    ? Number(process.env.IDEMPOTENCY_RETENTION_DAYS)
    : DEFAULT_RETENTION_DAYS;
  const prune = async (): Promise<boolean> => {
    if (stopping) return true;
    try {
      const { deleted } = await pruneIdempotencyKeys(db, retentionDays);
      if (deleted > 0) console.log(`[prune] removed ${deleted} idempotency keys`);
      return true;
    } catch (err) {
      console.error('[prune] failed', err);
      Sentry.captureException(err, { tags: { job: 'prune' } });
      return false;
    }
  };

  // One teardown for both modes: flip the guard, run the mode-specific
  // stop step, then release shared resources and exit. Registering it
  // once here keeps the two modes from drifting apart (e.g. a future
  // Sentry flush must not be added to only one of them).
  const gracefulShutdown = (stop: () => Promise<void>) => async () => {
    stopping = true;
    await stop();
    await publisher.close();
    await pool.end();
    // flush any queued events before the process goes away (no-op when
    // Sentry was never initialized); bounded so shutdown cannot hang
    await Sentry.close(2000);
    process.exit(0);
  };
  const onSignals = (handler: () => void) => {
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  };

  if (process.env.WORKER_MODE === 'http') {
    const server = createServer(createRequestHandler({ tick, prune }));
    const port = Number(process.env.PORT ?? 8080);
    server.listen(port, () => console.log(`[worker] http mode on :${port}`));

    // await server.close so an in-flight /tick drains (finishes its run
    // and flushes its response) before the pool it is querying closes
    const shutdown = gracefulShutdown(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    onSignals(() => void shutdown());
    return;
  }

  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
  const pruneInterval = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  void tick();
  void prune();

  const shutdown = gracefulShutdown(async () => {
    clearInterval(interval);
    clearInterval(pruneInterval);
  });
  onSignals(() => void shutdown());
}

void main();
