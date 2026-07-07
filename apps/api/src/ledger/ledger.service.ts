import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import {
  computeBalances,
  computeSplits,
  SplitError,
  type SplitMode,
} from '@homi/domain';
import { DB } from '../db.module';

export interface CreateExpenseInput {
  description: string;
  amountCents: number;
  currency?: string;
  paidBy: string;
  category?: string;
  isStaple?: boolean;
  mode: SplitMode;
  participants: string[];
  exactCents?: Record<string, number>;
  weightsBp?: Record<string, number>;
}

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * H1: safe to retry, impossible to partially complete.
   * The expense, its splits, the activity event, and the idempotency
   * record commit in ONE transaction. A retry with the same key replays
   * the stored response instead of re-executing; a concurrent duplicate
   * hits the idempotency_keys primary key and is replayed after the
   * first commit wins.
   */
  async createExpense(
    houseId: string,
    userId: string,
    idempotencyKey: string,
    input: CreateExpenseInput,
  ): Promise<{ status: number; body: unknown }> {
    const replayed = await this.findStoredResponse(idempotencyKey);
    if (replayed) return replayed;

    try {
      return await this.db.transaction(async (tx) => {
        const [house] = await tx
          .select()
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new BadRequestException('House not found');

        const involved = [...new Set([...input.participants, input.paidBy])];
        const activeMembers = await tx
          .select({ userId: schema.houseMembers.userId })
          .from(schema.houseMembers)
          .where(
            and(
              eq(schema.houseMembers.houseId, houseId),
              inArray(schema.houseMembers.userId, involved),
              isNull(schema.houseMembers.leftAt),
            ),
          );
        if (activeMembers.length !== involved.length) {
          throw new BadRequestException('Payer and all participants must be active house members');
        }

        // HOMI-10: room-weighted splits are derived server-side from room
        // assignments; clients cannot supply their own weights (spec 5.3:
        // clients never compute state).
        let weightsBp = input.weightsBp;
        if (input.mode === 'room_weighted') {
          if (weightsBp) {
            throw new BadRequestException('room_weighted splits are derived from rooms; do not send weightsBp');
          }
          const assignments = await tx
            .select({ userId: schema.houseMembers.userId, weightBp: schema.rooms.weightBp })
            .from(schema.houseMembers)
            .innerJoin(schema.rooms, eq(schema.rooms.id, schema.houseMembers.roomId))
            .where(
              and(
                eq(schema.houseMembers.houseId, houseId),
                inArray(schema.houseMembers.userId, input.participants),
                isNull(schema.houseMembers.leftAt),
              ),
            );
          if (assignments.length !== input.participants.length) {
            throw new BadRequestException('Every participant needs a room for a room-weighted split');
          }
          weightsBp = Object.fromEntries(assignments.map((a) => [a.userId, a.weightBp]));
        }

        let splits: Record<string, number>;
        try {
          splits = computeSplits({
            totalCents: input.amountCents,
            paidBy: input.paidBy,
            mode: input.mode,
            participants: input.participants,
            exactCents: input.exactCents,
            weightsBp,
          });
        } catch (err) {
          if (err instanceof SplitError) throw new BadRequestException(err.message);
          throw err;
        }

        const [expense] = await tx
          .insert(schema.expenses)
          .values({
            houseId,
            description: input.description,
            amountCents: input.amountCents,
            currency: input.currency ?? house.currency,
            paidBy: input.paidBy,
            category: input.category,
            isStaple: input.isStaple ?? false,
            createdBy: userId,
          })
          .returning();
        if (!expense) throw new Error('insert returned no row');

        await tx.insert(schema.expenseSplits).values(
          Object.entries(splits).map(([splitUserId, amountCents]) => ({
            expenseId: expense.id,
            userId: splitUserId,
            amountCents,
          })),
        );

        await tx.insert(schema.activityEvents).values({
          houseId,
          actorId: userId,
          type: 'expense.created',
          entityType: 'expense',
          entityId: expense.id,
          payload: { amountCents: expense.amountCents, description: expense.description },
        });

        const body = { expense, splits };
        await tx.insert(schema.idempotencyKeys).values({
          key: idempotencyKey,
          userId,
          endpoint: 'POST /v1/houses/:houseId/expenses',
          responseStatus: 201,
          responseBody: body,
        });
        return { status: 201, body };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const stored = await this.findStoredResponse(idempotencyKey);
        if (stored) return stored;
      }
      throw err;
    }
  }

  /**
   * HOMI-11: settlement is single-sided (spec, Pillar 1) - the payer
   * records it in one tap and a 72-hour dispute window protects the
   * recipient, so nothing stalls waiting for confirmation. Idempotent
   * and transactional like every money mutation (H1).
   */
  async recordPayment(
    houseId: string,
    userId: string,
    idempotencyKey: string,
    input: { toUser: string; amountCents: number; currency?: string; method?: string },
  ): Promise<{ status: number; body: unknown }> {
    const replayed = await this.findStoredResponse(idempotencyKey);
    if (replayed) return replayed;
    if (input.toUser === userId) {
      throw new BadRequestException('You cannot record a payment to yourself');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [house] = await tx
          .select()
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new BadRequestException('House not found');

        const counterpart = await tx
          .select({ userId: schema.houseMembers.userId })
          .from(schema.houseMembers)
          .where(
            and(
              eq(schema.houseMembers.houseId, houseId),
              eq(schema.houseMembers.userId, input.toUser),
              isNull(schema.houseMembers.leftAt),
            ),
          );
        if (counterpart.length === 0) {
          throw new BadRequestException('Recipient must be an active house member');
        }

        const [payment] = await tx
          .insert(schema.payments)
          .values({
            houseId,
            fromUser: userId,
            toUser: input.toUser,
            amountCents: input.amountCents,
            currency: input.currency ?? house.currency,
            method: input.method,
          })
          .returning();
        if (!payment) throw new Error('insert returned no row');

        await tx.insert(schema.activityEvents).values({
          houseId,
          actorId: userId,
          type: 'payment.recorded',
          entityType: 'payment',
          entityId: payment.id,
          payload: { amountCents: payment.amountCents, toUser: payment.toUser },
        });

        const body = { payment };
        await tx.insert(schema.idempotencyKeys).values({
          key: idempotencyKey,
          userId,
          endpoint: 'POST /v1/houses/:houseId/payments',
          responseStatus: 201,
          responseBody: body,
        });
        return { status: 201, body };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const stored = await this.findStoredResponse(idempotencyKey);
        if (stored) return stored;
      }
      throw err;
    }
  }

  /**
   * Only the recipient can dispute, only within 72 hours, and the state
   * transition is guarded in SQL (H2): concurrent disputes or a racing
   * resolve cannot double-fire.
   */
  async disputePayment(paymentId: string, userId: string) {
    const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .for('update');
      if (!payment) throw new NotFoundException('Payment not found');

      const [membership] = await tx
        .select({ userId: schema.houseMembers.userId })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, payment.houseId),
            eq(schema.houseMembers.userId, userId),
            isNull(schema.houseMembers.leftAt),
          ),
        );
      if (!membership) throw new NotFoundException('Payment not found');
      if (payment.toUser !== userId) {
        throw new ForbiddenException('Only the payment recipient can dispute it');
      }
      if (payment.status !== 'recorded') {
        throw new BadRequestException('This payment is not open for dispute');
      }
      if (Date.now() - payment.createdAt.getTime() > DISPUTE_WINDOW_MS) {
        throw new BadRequestException('The 72-hour dispute window has closed');
      }

      const updated = await tx
        .update(schema.payments)
        .set({ status: 'disputed', disputedAt: new Date() })
        .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, 'recorded')))
        .returning();
      const disputedPayment = updated[0];
      if (!disputedPayment) throw new BadRequestException('This payment is not open for dispute');

      await tx.insert(schema.activityEvents).values({
        houseId: payment.houseId,
        actorId: userId,
        type: 'payment.disputed',
        entityType: 'payment',
        entityId: paymentId,
      });
      return { payment: disputedPayment };
    });
  }

  /**
   * Invariant 3: the only balance computation. Every surface reads this.
   */
  async getBalances(houseId: string) {
    const expenseRows = await this.db
      .select({
        expenseId: schema.expenses.id,
        paidBy: schema.expenses.paidBy,
        splitUserId: schema.expenseSplits.userId,
        splitCents: schema.expenseSplits.amountCents,
      })
      .from(schema.expenses)
      .innerJoin(schema.expenseSplits, eq(schema.expenseSplits.expenseId, schema.expenses.id))
      .where(and(eq(schema.expenses.houseId, houseId), isNull(schema.expenses.deletedAt)));

    const byExpense = new Map<string, { paidBy: string; splits: Record<string, number> }>();
    for (const row of expenseRows) {
      const entry = byExpense.get(row.expenseId) ?? { paidBy: row.paidBy, splits: {} };
      entry.splits[row.splitUserId] = row.splitCents;
      byExpense.set(row.expenseId, entry);
    }

    const paymentRows = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.houseId, houseId));

    return computeBalances(
      [...byExpense.values()],
      paymentRows.map((p) => ({
        fromUser: p.fromUser,
        toUser: p.toUser,
        amountCents: p.amountCents,
        status: p.status as 'recorded' | 'disputed' | 'resolved',
      })),
    );
  }

  private async findStoredResponse(
    key: string,
  ): Promise<{ status: number; body: unknown } | null> {
    const [row] = await this.db
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.key, key));
    if (!row) return null;
    return { status: row.responseStatus, body: row.responseBody };
  }
}
