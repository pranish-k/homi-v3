import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { nextDueDate, todayInTimezone, validateSchedule, ScheduleError, type Cadence } from '@homi/domain';
import { hashRequest } from '../lib/request-hash';
import { findStoredResponse, isUniqueViolation } from '../lib/idempotency';
import { ActivityService } from '../activity/activity.service';
import { DB } from '../db.module';

export interface CreateBillInput {
  description: string;
  amountCents: number;
  splitMode: 'equal' | 'room_weighted';
  cadence: Cadence;
  cadenceDay: string;
  ownerId?: string;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * HOMI-13: bill templates. The API only shapes templates; posting them
 * is the worker's job, and the (template_id, period) unique index is
 * what keeps the two from ever disagreeing about what was posted (H4).
 */
@Injectable()
export class BillsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Idempotency-keyed like every money mutation (H1): a template
   * created twice is rent posted twice a month, forever.
   */
  async createBill(
    houseId: string,
    userId: string,
    idempotencyKey: string,
    input: CreateBillInput,
  ): Promise<{ status: number; body: unknown }> {
    const endpoint = 'POST /v1/houses/:houseId/bills';
    const requestHash = hashRequest({ houseId, input });
    const replayed = await findStoredResponse(this.db, idempotencyKey, userId, endpoint, requestHash);
    if (replayed) return replayed;

    try {
      validateSchedule(input.cadence, input.cadenceDay);
    } catch (err) {
      if (err instanceof ScheduleError) throw new BadRequestException(err.message);
      throw err;
    }
    const ownerId = input.ownerId ?? userId;

    try {
      return await this.activity.transact(async (tx, log) => {
        const [house] = await tx
          .select()
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new BadRequestException('House not found');

        const [owner] = await tx
          .select({ userId: schema.houseMembers.userId })
          .from(schema.houseMembers)
          .where(
            and(
              eq(schema.houseMembers.houseId, houseId),
              eq(schema.houseMembers.userId, ownerId),
              isNull(schema.houseMembers.leftAt),
            ),
          );
        if (!owner) throw new BadRequestException('Bill owner must be an active house member');

        // "after yesterday" so a bill created on its due day still posts
        // today; H5: "today" is the house's wall-clock date, not the server's
        const today = todayInTimezone(house.timezone, new Date());
        const nextRun = nextDueDate(input.cadence, input.cadenceDay, isoAddDays(today, -1));

        const [bill] = await tx
          .insert(schema.billTemplates)
          .values({
            houseId,
            description: input.description,
            amountCents: input.amountCents,
            ownerId,
            splitMode: input.splitMode,
            cadence: input.cadence,
            cadenceDay: input.cadenceDay,
            nextRun,
            createdBy: userId,
          })
          .returning();
        if (!bill) throw new Error('insert returned no row');

        await log({
          houseId,
          actorId: userId,
          type: 'bill.created',
          entityType: 'bill',
          entityId: bill.id,
          payload: { description: bill.description, amountCents: bill.amountCents, nextRun },
        });

        const body = { bill };
        await tx.insert(schema.idempotencyKeys).values({
          key: idempotencyKey,
          userId,
          endpoint,
          requestHash,
          responseStatus: 201,
          responseBody: body,
        });
        return { status: 201, body };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const stored = await findStoredResponse(this.db, idempotencyKey, userId, endpoint, requestHash);
        if (stored) return stored;
      }
      throw err;
    }
  }

  async listBills(houseId: string) {
    return this.db
      .select()
      .from(schema.billTemplates)
      .where(eq(schema.billTemplates.houseId, houseId))
      .orderBy(schema.billTemplates.createdAt);
  }

  /**
   * Owner or admin can pause and resume. Resuming recomputes next_run
   * from today: periods missed while paused are consciously skipped,
   * never back-posted (a paused bill was paused for a reason). Catch-up
   * is only for ACTIVE templates the worker fell behind on.
   */
  async setActive(houseId: string, billId: string, userId: string, active: boolean) {
    return this.activity.transact(async (tx, log) => {
      const [bill] = await tx
        .select()
        .from(schema.billTemplates)
        .where(and(eq(schema.billTemplates.id, billId), eq(schema.billTemplates.houseId, houseId)))
        .for('update');
      if (!bill) throw new NotFoundException('Bill not found');

      const [actor] = await tx
        .select({ role: schema.houseMembers.role })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            eq(schema.houseMembers.userId, userId),
            isNull(schema.houseMembers.leftAt),
          ),
        );
      if (!actor || (actor.role !== 'admin' && bill.ownerId !== userId)) {
        throw new ForbiddenException('Only the bill owner or a house admin can change a bill');
      }
      if (bill.active === active) return { bill };

      let nextRun = bill.nextRun;
      if (active) {
        const [house] = await tx.select().from(schema.houses).where(eq(schema.houses.id, houseId));
        if (!house) throw new NotFoundException('House not found');
        const today = todayInTimezone(house.timezone, new Date());
        nextRun = nextDueDate(bill.cadence as Cadence, bill.cadenceDay, isoAddDays(today, -1));
      }

      const [updated] = await tx
        .update(schema.billTemplates)
        .set({ active, nextRun })
        .where(eq(schema.billTemplates.id, billId))
        .returning();

      await log({
        houseId,
        actorId: userId,
        type: active ? 'bill.resumed' : 'bill.paused',
        entityType: 'bill',
        entityId: billId,
      });
      return { bill: updated };
    });
  }

}
