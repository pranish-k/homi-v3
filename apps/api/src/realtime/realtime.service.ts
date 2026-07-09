import { EventEmitter } from 'node:events';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { closeRedis, getRedis, getSubscriberRedis, redisConfigured } from '../redis';

/**
 * HOMI-17, hazard H6: a realtime event is a cache-invalidation HINT,
 * never the data itself. Events delivered while a phone was offline are
 * gone forever, so clients treat a hint as "refetch the snapshot" and
 * refetch on reconnect/foreground anyway. Ids are included so clients
 * can invalidate precisely; amounts, descriptions, and any other state
 * are not.
 */
export interface RealtimeHint {
  type: string; // matches the activity_events type, e.g. 'expense.created'
  entityType: string;
  entityId: string;
  ts: string;
}

type Listener = (hint: RealtimeHint) => void;

/**
 * Fan-out bus: Redis pub/sub when configured (spec 5.2: API and workers
 * publish, every gateway instance fans out to its connected sockets),
 * in-process EventEmitter otherwise (single node, dev/test).
 */
@Injectable()
export class RealtimeService implements OnApplicationShutdown {
  private readonly local = new EventEmitter().setMaxListeners(0);
  private readonly useRedis = redisConfigured();
  // tracked per client, not as a boolean: after closeRedis a fresh
  // subscriber connection needs the message handler wired again
  private wiredClient?: Redis;

  publish(houseId: string, hint: Omit<RealtimeHint, 'ts'>): void {
    const message: RealtimeHint = { ...hint, ts: new Date().toISOString() };
    if (this.useRedis) {
      // fire-and-forget by design: the write is already committed and a
      // lost hint self-heals on the next refetch (H6)
      void getRedis()
        .publish(`house:${houseId}`, JSON.stringify(message))
        .catch((err) => console.error('[realtime] publish failed', err));
    } else {
      this.local.emit(houseId, message);
    }
  }

  /**
   * Resolves only once the subscription is live (Redis has acked the
   * SUBSCRIBE), so callers can rely on not missing hints published
   * after this returns.
   */
  async subscribe(houseId: string, listener: Listener): Promise<() => void> {
    this.local.on(houseId, listener);
    if (!this.useRedis) {
      return () => this.local.off(houseId, listener);
    }
    const sub = this.wireRedis();
    await sub.subscribe(`house:${houseId}`);
    return () => {
      this.local.off(houseId, listener);
      if (this.local.listenerCount(houseId) === 0) {
        void sub.unsubscribe(`house:${houseId}`).catch(() => undefined);
      }
    };
  }

  /** One Redis message handler per subscriber connection, routing to local listeners by channel. */
  private wireRedis(): Redis {
    const sub = getSubscriberRedis();
    if (this.wiredClient === sub) return sub;
    this.wiredClient = sub;
    sub.on('message', (channel: string, raw: string) => {
      const houseId = channel.replace(/^house:/, '');
      try {
        this.local.emit(houseId, JSON.parse(raw) as RealtimeHint);
      } catch {
        console.error(`[realtime] dropped malformed message on ${channel}`);
      }
    });
    return sub;
  }

  async onApplicationShutdown(): Promise<void> {
    this.local.removeAllListeners();
    this.wiredClient = undefined;
    if (this.useRedis) await closeRedis();
  }
}
