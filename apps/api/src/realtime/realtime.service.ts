import { EventEmitter } from 'node:events';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
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
  private redisWired = false;

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

  subscribe(houseId: string, listener: Listener): () => void {
    if (this.useRedis) {
      this.wireRedisOnce();
      const sub = getSubscriberRedis();
      void sub
        .subscribe(`house:${houseId}`)
        .catch((err) => console.error('[realtime] subscribe failed', err));
      this.local.on(houseId, listener);
      return () => {
        this.local.off(houseId, listener);
        if (this.local.listenerCount(houseId) === 0) {
          void sub.unsubscribe(`house:${houseId}`).catch(() => undefined);
        }
      };
    }
    this.local.on(houseId, listener);
    return () => this.local.off(houseId, listener);
  }

  /** One Redis message handler per process, routing to local listeners by channel. */
  private wireRedisOnce(): void {
    if (this.redisWired) return;
    this.redisWired = true;
    getSubscriberRedis().on('message', (channel: string, raw: string) => {
      const houseId = channel.replace(/^house:/, '');
      try {
        this.local.emit(houseId, JSON.parse(raw) as RealtimeHint);
      } catch {
        console.error(`[realtime] dropped malformed message on ${channel}`);
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.local.removeAllListeners();
    if (this.useRedis) await closeRedis();
  }
}
