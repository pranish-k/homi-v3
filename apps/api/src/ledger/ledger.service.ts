import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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

        let splits: Record<string, number>;
        try {
          splits = computeSplits({
            totalCents: input.amountCents,
            paidBy: input.paidBy,
            mode: input.mode,
            participants: input.participants,
            exactCents: input.exactCents,
            weightsBp: input.weightsBp,
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
