import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashRequest } from '../lib/request-hash';
import { findStoredResponse, isUniqueViolation } from '../lib/idempotency';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import {
  computeBalances,
  computeSplits,
  SplitError,
  type Balances,
  type SplitMode,
} from '@homi/domain';
import { ActivityService } from '../activity/activity.service';
import { DB } from '../db.module';
import { decodeCursor, encodeCursor } from '../lib/cursor';

/** A Db or a transaction handle within one; both run the same query builders. */
export type DbConn = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** HOMI-11: how long the recipient can dispute a recorded payment. */
export const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;

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

@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

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
    const endpoint = 'POST /v1/houses/:houseId/expenses';
    const requestHash = hashRequest({ houseId, input });
    const replayed = await this.findStoredResponse(idempotencyKey, userId, endpoint, requestHash);
    if (replayed) return replayed;

    try {
      const result = await this.activity.transact(async (tx, log) => {
        const [house] = await tx
          .select()
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new BadRequestException('House not found');
        if (input.currency && input.currency !== house.currency) {
          // the balance function is single-currency (invariant 3); mixed
          // currencies would net EUR cents against USD cents
          throw new BadRequestException(`This house keeps its ledger in ${house.currency}`);
        }

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

        await log({
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
          endpoint,
          requestHash,
          responseStatus: 201,
          responseBody: body,
        });
        return { status: 201, body };
      });
      return result;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const stored = await this.findStoredResponse(idempotencyKey, userId, endpoint, requestHash);
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
    const endpoint = 'POST /v1/houses/:houseId/payments';
    const requestHash = hashRequest({ houseId, input });
    const replayed = await this.findStoredResponse(idempotencyKey, userId, endpoint, requestHash);
    if (replayed) return replayed;
    if (input.toUser === userId) {
      throw new BadRequestException('You cannot record a payment to yourself');
    }

    try {
      const result = await this.activity.transact(async (tx, log) => {
        const [house] = await tx
          .select()
          .from(schema.houses)
          .where(eq(schema.houses.id, houseId));
        if (!house) throw new BadRequestException('House not found');
        if (input.currency && input.currency !== house.currency) {
          throw new BadRequestException(`This house keeps its ledger in ${house.currency}`);
        }

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

        await log({
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
          endpoint,
          requestHash,
          responseStatus: 201,
          responseBody: body,
        });
        return { status: 201, body };
      });
      return result;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const stored = await this.findStoredResponse(idempotencyKey, userId, endpoint, requestHash);
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
    return this.activity.transact(async (tx, log) => {
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

      await log({
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
   *
   * HOMI-25 (review M3): expenses and payments are read in ONE
   * repeatable-read snapshot; a payment committing between the two
   * statements can no longer produce balances that never existed.
   * Callers already inside a transaction (the HOME snapshot) pass their
   * own handle and inherit its consistency.
   */
  async getBalances(houseId: string, conn?: DbConn): Promise<Balances> {
    if (!conn) {
      return this.db.transaction((tx) => this.getBalances(houseId, tx), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      });
    }
    const expenseRows = await conn
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

    const paymentRows = await conn
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

  /**
   * HOMI-16: one unified, cursor-paginated ledger of expenses and
   * payments, newest first. Keyset pagination on (created_at, id) - a
   * page boundary is a fixed point, so concurrent inserts can never
   * duplicate or skip entries the way OFFSET does.
   */
  async getLedger(houseId: string, opts: { cursor?: string; limit: number }) {
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    const fetch = opts.limit + 1; // one extra row decides hasMore without a COUNT

    // one repeatable-read snapshot for the same reason as getBalances
    // (HOMI-25): a page merged from two different database states could
    // show a settlement payment without the expense it settles. A row
    // whose transaction was still open when a walk passed its position
    // can be missed by that walk (created_at is the tx START time); the
    // next refetch from the head shows it (H6 self-heal).
    return this.db.transaction(
      (tx) => this.getLedgerPage(tx, houseId, cursor, fetch, opts.limit),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  private async getLedgerPage(
    tx: DbConn,
    houseId: string,
    cursor: { t: string; id: string } | undefined,
    fetch: number,
    limit: number,
  ) {
    const expenseKeyset = cursor
      ? sql`(${schema.expenses.createdAt}, ${schema.expenses.id}) < (${new Date(cursor.t)}::timestamptz, ${cursor.id}::uuid)`
      : undefined;
    const expenseRows = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.houseId, houseId),
          isNull(schema.expenses.deletedAt),
          expenseKeyset,
        ),
      )
      .orderBy(desc(schema.expenses.createdAt), desc(schema.expenses.id))
      .limit(fetch);

    const paymentKeyset = cursor
      ? sql`(${schema.payments.createdAt}, ${schema.payments.id}) < (${new Date(cursor.t)}::timestamptz, ${cursor.id}::uuid)`
      : undefined;
    const paymentRows = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.houseId, houseId), paymentKeyset))
      .orderBy(desc(schema.payments.createdAt), desc(schema.payments.id))
      .limit(fetch);

    const merged = [
      ...expenseRows.map((e) => ({ kind: 'expense' as const, row: e })),
      ...paymentRows.map((p) => ({ kind: 'payment' as const, row: p })),
    ].sort((a, b) => {
      const dt = b.row.createdAt.getTime() - a.row.createdAt.getTime();
      if (dt !== 0) return dt;
      return b.row.id > a.row.id ? 1 : -1;
    });
    const page = merged.slice(0, limit);
    const hasMore = merged.length > limit;

    const expenseIds = page.filter((e) => e.kind === 'expense').map((e) => e.row.id);
    const splitRows = expenseIds.length
      ? await tx
          .select()
          .from(schema.expenseSplits)
          .where(inArray(schema.expenseSplits.expenseId, expenseIds))
      : [];
    const splitsByExpense = new Map<string, Record<string, number>>();
    for (const s of splitRows) {
      const entry = splitsByExpense.get(s.expenseId) ?? {};
      entry[s.userId] = s.amountCents;
      splitsByExpense.set(s.expenseId, entry);
    }

    const last = page[page.length - 1];
    return {
      entries: page.map((e) =>
        e.kind === 'expense'
          ? { kind: e.kind, ...e.row, splits: splitsByExpense.get(e.row.id) ?? {} }
          : { kind: e.kind, ...e.row },
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({ t: last.row.createdAt.toISOString(), id: last.row.id })
          : null,
    };
  }

  /**
   * Replay lookup is scoped to (key, user, endpoint): one user's stored
   * response can never be replayed to another user or across endpoints.
   * A key reused with a different body is a client bug and gets 409
   * instead of a silent wrong replay.
   */
  private async findStoredResponse(
    key: string,
    userId: string,
    endpoint: string,
    requestHash: string,
  ): Promise<{ status: number; body: unknown } | null> {
    return findStoredResponse(this.db, key, userId, endpoint, requestHash);
  }
}
