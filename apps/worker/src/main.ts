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
import { Redis } from 'ioredis';
import { postDueBills, type PublishHint } from './bills/post-due-bills';
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

  // HOMI-26: hourly retention pass; the env override exists for tests
  // and emergencies, not tuning
  const retentionDays = process.env.IDEMPOTENCY_RETENTION_DAYS
    ? Number(process.env.IDEMPOTENCY_RETENTION_DAYS)
    : DEFAULT_RETENTION_DAYS;
  const prune = async () => {
    if (stopping) return;
    try {
      const { deleted } = await pruneIdempotencyKeys(db, retentionDays);
      if (deleted > 0) console.log(`[prune] removed ${deleted} idempotency keys`);
    } catch (err) {
      console.error('[prune] failed', err);
    }
  };

  if (process.env.WORKER_MODE === 'http') {
    // Cloud Run (HOMI-14): a poll loop needs always-allocated CPU there,
    // which costs more than the database. Instead Cloud Scheduler POSTs
    // /tick and /prune on the same cadence the loop used, the instance
    // scales to zero between runs, and platform IAM (OIDC run.invoker)
    // keeps the endpoints private - no in-app auth. `running` already
    // makes an overlapping tick a no-op, same as in loop mode.
    const server = createServer((req, res) => {
      const respond = (status: number, body: string) => {
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(body);
      };
      if (req.method === 'GET' && req.url === '/healthz') return respond(200, 'ok');
      if (req.method !== 'POST') return respond(405, 'method not allowed');
      if (req.url === '/tick') {
        void tick().then(() => respond(200, 'tick done'));
        return;
      }
      if (req.url === '/prune') {
        void prune().then(() => respond(200, 'prune done'));
        return;
      }
      return respond(404, 'not found');
    });
    const port = Number(process.env.PORT ?? 8080);
    server.listen(port, () => console.log(`[worker] http mode on :${port}`));

    const shutdown = async () => {
      stopping = true;
      server.close();
      await publisher.close();
      await pool.end();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    return;
  }

  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
  const pruneInterval = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  void tick();
  void prune();

  const shutdown = async () => {
    stopping = true;
    clearInterval(interval);
    clearInterval(pruneInterval);
    await publisher.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
