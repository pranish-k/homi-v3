import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@homi/db';
import { ActivityService } from '../activity/activity.service';
import { requireAdmin } from '../auth/house-role';

@Injectable()
export class MembersService {
  constructor(private readonly activity: ActivityService) {}

  /**
   * HOMI-9: a placeholder roommate is a real member row (splits, rooms,
   * and balances need nothing special) behind a users row that can never
   * act: no email, no session, and the posting core refuses it as a
   * payer. Admin-only, like invites - placeholders gate who money can be
   * logged against.
   */
  async createPlaceholder(houseId: string, actorId: string, name: string) {
    return this.activity.transact(async (tx, log) => {
      await requireAdmin(tx, houseId, actorId, 'add placeholder roommates');

      const [placeholder] = await tx
        .insert(schema.users)
        .values({ name, email: null })
        .returning({ id: schema.users.id, name: schema.users.name });
      if (!placeholder) throw new Error('insert returned no row');
      await tx
        .insert(schema.houseMembers)
        .values({ houseId, userId: placeholder.id, isPlaceholder: true });

      await log({
        houseId,
        actorId,
        type: 'member.placeholder_added',
        entityType: 'member',
        entityId: placeholder.id,
        payload: { name },
      });
      return { userId: placeholder.id, name: placeholder.name, isPlaceholder: true };
    });
  }

  /**
   * HOMI-28: a member's per-house display name overrides their account
   * name on every surface of that house only (spec 6: nothing crosses
   * houses). Null clears the override. Members rename only themselves;
   * an unchanged value writes no event, so re-sends cannot spam the feed.
   */
  async setDisplayName(houseId: string, userId: string, displayName: string | null) {
    return this.activity.transact(async (tx, log) => {
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
        return { displayName };
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
      await log({
        houseId,
        actorId: userId,
        type: 'member.renamed',
        entityType: 'member',
        entityId: userId,
      });
      return { displayName };
    });
  }
}
