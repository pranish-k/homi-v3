import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';
import { DISPUTE_WINDOW_MS, LedgerService } from '../ledger/ledger.service';

const FEED_HEAD_SIZE = 20;

/**
 * HOMI-20: the HOME tab in one request (spec 5.3) - members, balances,
 * action items, feed head. Also the refetch target for every realtime
 * hint (H6), so it must be cheap and internally consistent: everything
 * is read in one repeatable-read snapshot, and balances come from the
 * single balance function (invariant 3).
 */
@Injectable()
export class SnapshotService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
  ) {}

  async getSnapshot(houseId: string, userId: string) {
    return this.db.transaction(
      async (tx) => {
        const [house] = await tx
          .select({
            id: schema.houses.id,
            name: schema.houses.name,
            timezone: schema.houses.timezone,
            currency: schema.houses.currency,
          })
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new NotFoundException('House not found');

        const members = await tx
          .select({
            userId: schema.houseMembers.userId,
            name: schema.users.name,
            displayName: schema.houseMembers.displayName,
            role: schema.houseMembers.role,
            isPlaceholder: schema.houseMembers.isPlaceholder,
            roomId: schema.houseMembers.roomId,
            joinedAt: schema.houseMembers.joinedAt,
          })
          .from(schema.houseMembers)
          .innerJoin(schema.users, eq(schema.users.id, schema.houseMembers.userId))
          .where(and(eq(schema.houseMembers.houseId, houseId), isNull(schema.houseMembers.leftAt)))
          .orderBy(schema.houseMembers.joinedAt);

        const balances = await this.ledger.getBalances(houseId, tx);

        const feed = await tx
          .select()
          .from(schema.activityEvents)
          .where(eq(schema.activityEvents.houseId, houseId))
          .orderBy(desc(schema.activityEvents.createdAt), desc(schema.activityEvents.id))
          .limit(FEED_HEAD_SIZE);

        // Action items are per-caller and derived, never stored: what do
        // I owe (M3/M4 - HOMI does the asking), and which payments to me
        // are still inside their dispute window.
        const debts = balances.pairwise
          .filter((p) => p.from === userId)
          .map((p) => ({ type: 'settle_up' as const, toUserId: p.to, amountCents: p.amountCents }));
        const windowStart = new Date(Date.now() - DISPUTE_WINDOW_MS);
        const disputable = await tx
          .select({
            id: schema.payments.id,
            fromUser: schema.payments.fromUser,
            amountCents: schema.payments.amountCents,
            createdAt: schema.payments.createdAt,
          })
          .from(schema.payments)
          .where(
            and(
              eq(schema.payments.houseId, houseId),
              eq(schema.payments.toUser, userId),
              eq(schema.payments.status, 'recorded'),
              gt(schema.payments.createdAt, windowStart),
            ),
          )
          .orderBy(desc(schema.payments.createdAt), desc(schema.payments.id));
        const confirmations = disputable.map((p) => ({
            type: 'confirm_payment' as const,
            paymentId: p.id,
            fromUserId: p.fromUser,
            amountCents: p.amountCents,
            disputableUntil: new Date(p.createdAt.getTime() + DISPUTE_WINDOW_MS),
          }));

        return {
          house,
          members,
          balances,
          actionItems: [...debts, ...confirmations],
          feed,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
