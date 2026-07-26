import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { ActivityService } from '../activity/activity.service';
import { DB } from '../db.module';

export interface CreateHouseInput {
  name: string;
  timezone: string;
  currency: string;
}

@Injectable()
export class HousesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /**
   * HOMI-32: the client's first call after sign-in - it decides between
   * "create or join a house" and the house itself. Only live
   * memberships count, so a member who left stops seeing the house.
   */
  async listHouses(userId: string) {
    return this.db
      .select({
        id: schema.houses.id,
        name: schema.houses.name,
        timezone: schema.houses.timezone,
        currency: schema.houses.currency,
        role: schema.houseMembers.role,
        joinedAt: schema.houseMembers.joinedAt,
      })
      .from(schema.houseMembers)
      .innerJoin(schema.houses, eq(schema.houses.id, schema.houseMembers.houseId))
      .where(
        and(
          eq(schema.houseMembers.userId, userId),
          isNull(schema.houseMembers.leftAt),
        ),
      )
      .orderBy(asc(schema.houseMembers.joinedAt));
  }

  async createHouse(userId: string, input: CreateHouseInput) {
    return this.activity.transact(async (tx, log) => {
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
      await log({
        houseId: house.id,
        actorId: userId,
        type: 'house.created',
        entityType: 'house',
        entityId: house.id,
      });
      return house;
    });
  }
}
