import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * HOMI-28: a member's per-house display name overrides their account
   * name on every surface of that house only (spec 6: nothing crosses
   * houses). Null clears the override. Members rename only themselves;
   * an unchanged value writes no event, so re-sends cannot spam the feed.
   */
  async setDisplayName(houseId: string, userId: string, displayName: string | null) {
    const result = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ displayName: schema.houseMembers.displayName })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            eq(schema.houseMembers.userId, userId),
            isNull(schema.houseMembers.leftAt),
          ),
        )
        .for('update');
      if (!current) throw new NotFoundException('Membership not found');
      if (current.displayName === displayName) {
        return { displayName, changed: false };
      }

      await tx
        .update(schema.houseMembers)
        .set({ displayName })
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            eq(schema.houseMembers.userId, userId),
          ),
        );
      await tx.insert(schema.activityEvents).values({
        houseId,
        actorId: userId,
        type: 'member.renamed',
        entityType: 'member',
        entityId: userId,
      });
      return { displayName, changed: true };
    });
    if (result.changed) {
      this.realtime.publish(houseId, {
        type: 'member.renamed',
        entityType: 'member',
        entityId: userId,
      });
    }
    return { displayName: result.displayName };
  }
}
