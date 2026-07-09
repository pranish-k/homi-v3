import { Inject, Injectable } from '@nestjs/common';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';
import { RealtimeService } from '../realtime/realtime.service';

export interface CreateHouseInput {
  name: string;
  timezone: string;
  currency: string;
}

@Injectable()
export class HousesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async createHouse(userId: string, input: CreateHouseInput) {
    const created = await this.db.transaction(async (tx) => {
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
    // nobody can be connected to a brand-new house yet, but every
    // activity event goes to the bus: consumers must not learn which
    // event types are "safe" to miss
    this.realtime.publish(created.id, {
      type: 'house.created',
      entityType: 'house',
      entityId: created.id,
    });
    return created;
  }
}
