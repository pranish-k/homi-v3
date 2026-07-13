import { Injectable } from '@nestjs/common';
import { schema } from '@homi/db';
import { ActivityService } from '../activity/activity.service';

export interface CreateHouseInput {
  name: string;
  timezone: string;
  currency: string;
}

@Injectable()
export class HousesService {
  constructor(private readonly activity: ActivityService) {}

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
