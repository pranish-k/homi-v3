import { Inject, Injectable } from '@nestjs/common';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';
import { RealtimeService } from '../realtime/realtime.service';

/** A transaction handle as drizzle passes it to the callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ActivityInput {
  houseId: string;
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
}

export type LogActivity = (event: ActivityInput) => Promise<void>;

/**
 * Sprint 3 retro action: the realtime hint derives from the
 * activity_events write that already happens inside every mutation's
 * transaction, instead of a hand-placed publish call per service
 * method. Write the feed event through `log` and the hint goes out by
 * itself - after commit only (H6: an in-tx publish could tell clients
 * to refetch a write that then rolls back), and never on idempotent
 * replays (a replay returns the stored response and logs nothing).
 * A mutation that forgets `log` now fails review on the missing feed
 * entry, not on a missing publish.
 */
@Injectable()
export class ActivityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async transact<T>(fn: (tx: Tx, log: LogActivity) => Promise<T>): Promise<T> {
    const logged: ActivityInput[] = [];
    const result = await this.db.transaction(async (tx) => {
      const log: LogActivity = async (event) => {
        await tx.insert(schema.activityEvents).values({ ...event, payload: event.payload ?? null });
        logged.push(event);
      };
      return fn(tx, log);
    });
    for (const event of logged) {
      this.realtime.publish(event.houseId, {
        type: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
      });
    }
    return result;
  }
}
