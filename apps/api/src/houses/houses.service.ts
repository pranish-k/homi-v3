import { Inject, Injectable } from '@nestjs/common';
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
}
