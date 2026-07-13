import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { ActivityService } from '../activity/activity.service';
import { DB } from '../db.module';

export interface RoomInput {
  name: string;
  weightBp: number;
  userId: string;
}

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /**
   * HOMI-10: room weights are set once at move-in (M1) and must sum to
   * 10000 basis points. Current constraint: exactly one occupant per
   * room; splitting one room's weight across two occupants is HOMI-23.
   * Replaces the whole room configuration atomically.
   */
  async setRooms(houseId: string, actorId: string, rooms: RoomInput[]) {
    const weightSum = rooms.reduce((acc, r) => acc + r.weightBp, 0);
    if (weightSum !== 10000) {
      throw new BadRequestException(`Room weights must sum to 10000 basis points, got ${weightSum}`);
    }
    const occupants = rooms.map((r) => r.userId);
    if (new Set(occupants).size !== occupants.length) {
      throw new BadRequestException('Each room needs its own occupant (shared rooms: HOMI-23)');
    }

    return this.activity.transact(async (tx, log) => {
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
        throw new ForbiddenException('Only house admins can configure rooms');
      }
      const activeMembers = await tx
        .select({ userId: schema.houseMembers.userId })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            inArray(schema.houseMembers.userId, occupants),
            isNull(schema.houseMembers.leftAt),
          ),
        );
      if (activeMembers.length !== occupants.length) {
        throw new BadRequestException('Every room occupant must be an active house member');
      }

      await tx
        .update(schema.houseMembers)
        .set({ roomId: null })
        .where(eq(schema.houseMembers.houseId, houseId));
      await tx.delete(schema.rooms).where(eq(schema.rooms.houseId, houseId));

      const created = await tx
        .insert(schema.rooms)
        .values(rooms.map((r) => ({ houseId, name: r.name, weightBp: r.weightBp })))
        .returning();
      for (let i = 0; i < rooms.length; i++) {
        const room = created[i];
        const input = rooms[i];
        if (!room || !input) throw new Error('room insert mismatch');
        await tx
          .update(schema.houseMembers)
          .set({ roomId: room.id })
          .where(
            and(
              eq(schema.houseMembers.houseId, houseId),
              eq(schema.houseMembers.userId, input.userId),
            ),
          );
      }

      await log({
        houseId,
        actorId,
        type: 'rooms.configured',
        entityType: 'house',
        entityId: houseId,
        payload: { rooms: rooms.map((r) => ({ name: r.name, weightBp: r.weightBp })) },
      });
      return created;
    });
  }

  async getRooms(houseId: string) {
    return this.db
      .select({
        id: schema.rooms.id,
        name: schema.rooms.name,
        weightBp: schema.rooms.weightBp,
        occupantId: schema.houseMembers.userId,
      })
      .from(schema.rooms)
      .leftJoin(
        schema.houseMembers,
        and(
          eq(schema.houseMembers.roomId, schema.rooms.id),
          isNull(schema.houseMembers.leftAt),
        ),
      )
      .where(eq(schema.rooms.houseId, houseId));
  }
}
