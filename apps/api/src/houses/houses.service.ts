import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';

export interface CreateHouseInput {
  name: string;
  timezone: string;
  currency: string;
}

@Injectable()
export class HousesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createHouse(userId: string, input: CreateHouseInput) {
    return this.db.transaction(async (tx) => {
      const [house] = await tx
        .insert(schema.houses)
        .values({ ...input, createdBy: userId })
        .returning();
      if (!house) throw new Error('insert returned no row');
      await tx.insert(schema.houseMembers).values({
        houseId: house.id,
        userId,
        role: 'admin',
      });
      await tx.insert(schema.activityEvents).values({
        houseId: house.id,
        actorId: userId,
        type: 'house.created',
        entityType: 'house',
        entityId: house.id,
      });
      return house;
    });
  }

  /**
   * Interim member management until invite links (HOMI-8) and
   * placeholder claiming (HOMI-9) land. Admin-only.
   */
  async addMember(
    houseId: string,
    actorId: string,
    input: { userId: string; displayName?: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ role: schema.houseMembers.role })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            eq(schema.houseMembers.userId, actorId),
            isNull(schema.houseMembers.leftAt),
          ),
        );
      if (actor?.role !== 'admin') {
        throw new ForbiddenException('Only house admins can add members');
      }
      await tx
        .insert(schema.users)
        .values({ id: input.userId, name: input.displayName ?? 'Roommate' })
        .onConflictDoNothing({ target: schema.users.id });
      const [member] = await tx
        .insert(schema.houseMembers)
        .values({ houseId, userId: input.userId, displayName: input.displayName })
        .onConflictDoNothing()
        .returning();
      if (!member) throw new BadRequestException('Already a member of this house');
      await tx.insert(schema.activityEvents).values({
        houseId,
        actorId,
        type: 'member.added',
        entityType: 'member',
        entityId: input.userId,
      });
      return member;
    });
  }
}
