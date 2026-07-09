import { getRedis, redisConfigured } from '../redis';

/**
 * HOMI-24 (spec 5.5). Fixed-window counters: simple, O(1) memory per
 * key, and honest enough for abuse control (the worst case admits 2x
 * the limit across a window boundary, which is fine for an email loop).
 *
 * Keyed per email / per IP / per user by the callers; this module only
 * counts. Backed by Redis when configured so all API instances share
 * one budget; per-process in-memory otherwise (dev/test only, see
 * redisConfigured).
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** seconds until the window resets; meaningful when allowed is false */
  retryAfterSec: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private sweepAt = 0;

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> {
    const now = Date.now();
    // opportunistic eviction so distinct keys cannot grow the map forever
    if (now >= this.sweepAt) {
      this.sweepAt = now + 60_000;
      for (const [k, win] of this.windows) {
        if (win.resetAt <= now) this.windows.delete(k);
      }
    }
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, w);
    }
    w.count += 1;
    if (w.count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }
}

export class RedisRateLimiter implements RateLimiter {
  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> {
    const redisKey = `rl:${key}`;
    // INCR + set-expiry-if-new in one atomic script: two clients racing
    // on a fresh key must not leave it without a TTL. The client is
    // resolved per call, never captured: the singleton limiter must not
    // outlive a closed connection.
    const [count, ttl] = (await getRedis().eval(
      `local c = redis.call('INCR', KEYS[1])
       if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
         -- also repairs a counter that lost its expiry (e.g. restored
         -- from a snapshot); without this the key counts up forever and
         -- locks its subject out permanently
         redis.call('EXPIRE', KEYS[1], ARGV[1])
       end
       return {c, redis.call('TTL', KEYS[1])}`,
      1,
      redisKey,
      windowSec,
    )) as [number, number];
    if (count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, ttl) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }
}

// Module-level singleton (like db.pool.ts): the Better Auth instance
// lives outside Nest DI but must share the same budgets.
let limiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (!limiter) {
    limiter = redisConfigured() ? new RedisRateLimiter() : new MemoryRateLimiter();
  }
  return limiter;
}
