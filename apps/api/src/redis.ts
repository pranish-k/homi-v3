import { Redis } from 'ioredis';

/**
 * Redis is optional infrastructure this sprint: when REDIS_URL is set
 * (docker-compose, CI, prod) it backs realtime pub/sub (HOMI-17) and
 * rate limiting (HOMI-24); when absent, in-process fallbacks keep a
 * single-node dev/test setup working with zero extra daemons. Prod
 * refuses the fallback: a multi-instance deploy with per-process
 * fan-out and limits would be silently wrong.
 *
 * Module-level singletons mirror db.pool.ts: shared by Nest DI and the
 * Better Auth instance, closed on application shutdown.
 */
let publisher: Redis | undefined;
let subscriber: Redis | undefined;
let closed = false;

export function redisConfigured(): boolean {
  if (process.env.REDIS_URL) return true;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('REDIS_URL must be set in production (realtime fan-out and rate limits)');
  }
  return false;
}

/** Shared connection for commands and PUBLISH. */
export function getRedis(): Redis {
  if (!publisher) {
    publisher = connect();
  }
  return publisher;
}

/** A connection in subscriber mode can run no other commands, so it is dedicated. */
export function getSubscriberRedis(): Redis {
  if (!subscriber) {
    subscriber = connect();
  }
  return subscriber;
}

function connect(): Redis {
  // a straggling request after shutdown must fail, not open a fresh
  // auto-reconnecting client that nothing will ever close
  if (closed) throw new Error('Redis connections are closed (shutting down)');
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

export async function closeRedis(): Promise<void> {
  closed = true;
  const clients = [publisher, subscriber].filter((c): c is Redis => c !== undefined);
  publisher = undefined;
  subscriber = undefined;
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
}
