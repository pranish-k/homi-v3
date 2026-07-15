import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { isUniqueViolation, schema, type Db } from '@homi/db';
import {
  computeSplits,
  isoAddDays,
  nextDueDate,
  periodKey,
  ScheduleError,
  SplitError,
  todayInTimezone,
  type Cadence,
  type RealtimeHint,
} from '@homi/domain';

export type PublishHint = (houseId: string, hint: RealtimeHint) => void;

export interface PostDueBillsResult {
  posted: { templateId: string; expenseId: string; period: string }[];
  alreadyPosted: { templateId: string; period: string }[];
  paused: { templateId: string; reason: string }[];
}

/**
 * A template that fell behind (worker down over a due date) catches up
 * one period at a time; the bound only caps a single run - the next
 * run continues. Paused-then-resumed templates never enter here with a
 * backlog because resuming recomputes next_run from today.
 */
const MAX_CATCHUP_PER_RUN = 24;

class BillPostingProblem extends Error {}

/**
 * HOMI-13, the worker's first real job. For every active template whose
 * next_run has arrived in ITS HOUSE'S timezone (H5), post the expense.
 *
 * Idempotency is the database's, not the scheduler's (H4): the posting
 * insert carries (template_id, period) into the partial unique index,
 * so a re-run, a crashed run resumed, or a second worker instance
 * cannot double-post - they trip the index and treat the period as
 * done. next_run bookkeeping is best-effort on top; the unique key is
 * the guarantee.
 */
export async function postDueBills(
  db: Db,
  now: Date = new Date(),
  publish?: PublishHint,
): Promise<PostDueBillsResult> {
  const result: PostDueBillsResult = { posted: [], alreadyPosted: [], paused: [] };

  // over-approximate SQL bound so the scan rides idx_bill_templates_due:
  // no house-local date can be later than the UTC date + 1 (UTC+14 max);
  // the per-house timezone check below stays authoritative
  const latestPossibleToday = isoAddDays(now.toISOString().slice(0, 10), 1);
  const templates = await db
    .select({
      template: schema.billTemplates,
      timezone: schema.houses.timezone,
      currency: schema.houses.currency,
    })
    .from(schema.billTemplates)
    .innerJoin(schema.houses, eq(schema.houses.id, schema.billTemplates.houseId))
    .where(
      and(
        eq(schema.billTemplates.active, true),
        lte(schema.billTemplates.nextRun, latestPossibleToday),
      ),
    )
    .orderBy(schema.billTemplates.createdAt);

  for (const { template, timezone, currency } of templates) {
    let today: string;
    try {
      today = todayInTimezone(timezone, now);
    } catch (err) {
      await pause(db, template.id, template.houseId, template.ownerId, String(err), publish);
      result.paused.push({ templateId: template.id, reason: String(err) });
      continue;
    }

    let { nextRun } = template;
    for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
      if (nextRun > today) break;

      const dueISO = nextRun;
      const advanced = nextDueDate(template.cadence as Cadence, template.cadenceDay, dueISO);
      try {
        const expenseId = await postOne(db, template, currency, dueISO, advanced, publish);
        result.posted.push({
          templateId: template.id,
          expenseId,
          period: periodKey(template.cadence as Cadence, dueISO),
        });
        nextRun = advanced;
      } catch (err) {
        if (isUniqueViolation(err)) {
          // another run already posted this period; advance past it
          // (compare-and-set: a concurrent winner may have advanced already)
          await db
            .update(schema.billTemplates)
            .set({ nextRun: advanced })
            .where(and(eq(schema.billTemplates.id, template.id), eq(schema.billTemplates.nextRun, dueISO)));
          result.alreadyPosted.push({
            templateId: template.id,
            period: periodKey(template.cadence as Cadence, dueISO),
          });
          nextRun = advanced;
          continue;
        }
        if (err instanceof BillPostingProblem || err instanceof ScheduleError || err instanceof SplitError) {
          // a bill that cannot post (owner left, vacant room, broken
          // timezone) must not hot-loop every minute; pause it and put
          // the problem in the feed where the house can see it
          await pause(db, template.id, template.houseId, template.ownerId, err.message, publish);
          result.paused.push({ templateId: template.id, reason: err.message });
          break;
        }
        throw err;
      }
    }
  }
  return result;
}

async function postOne(
  db: Db,
  template: typeof schema.billTemplates.$inferSelect,
  currency: string,
  dueISO: string,
  advancedNextRun: string,
  publish?: PublishHint,
): Promise<string> {
  const period = periodKey(template.cadence as Cadence, dueISO);

  const { expense, houseId } = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ userId: schema.houseMembers.userId })
      .from(schema.houseMembers)
      .where(
        and(
          eq(schema.houseMembers.houseId, template.houseId),
          eq(schema.houseMembers.userId, template.ownerId),
          isNull(schema.houseMembers.leftAt),
        ),
      );
    if (!owner) throw new BillPostingProblem('the bill owner is no longer a house member');

    let participants: string[];
    let weightsBp: Record<string, number> | undefined;
    if (template.splitMode === 'room_weighted') {
      const assignments = await tx
        .select({ userId: schema.houseMembers.userId, weightBp: schema.rooms.weightBp })
        .from(schema.houseMembers)
        .innerJoin(schema.rooms, eq(schema.rooms.id, schema.houseMembers.roomId))
        .where(
          and(
            eq(schema.houseMembers.houseId, template.houseId),
            isNull(schema.houseMembers.leftAt),
            isNotNull(schema.houseMembers.roomId),
          ),
        );
      participants = assignments.map((a) => a.userId);
      weightsBp = Object.fromEntries(assignments.map((a) => [a.userId, a.weightBp]));
      // computeSplits enforces the 10000bp sum; a vacant room surfaces
      // there as a SplitError and pauses the template
    } else {
      const members = await tx
        .select({ userId: schema.houseMembers.userId })
        .from(schema.houseMembers)
        .where(
          and(eq(schema.houseMembers.houseId, template.houseId), isNull(schema.houseMembers.leftAt)),
        );
      participants = members.map((m) => m.userId);
    }
    if (participants.length === 0) throw new BillPostingProblem('the house has no active members');

    const splits = computeSplits({
      totalCents: template.amountCents,
      paidBy: template.ownerId,
      mode: template.splitMode as 'equal' | 'room_weighted',
      participants,
      weightsBp,
    });

    const [expense] = await tx
      .insert(schema.expenses)
      .values({
        houseId: template.houseId,
        description: template.description,
        amountCents: template.amountCents,
        currency,
        paidBy: template.ownerId,
        templateId: template.id,
        period,
        createdBy: template.ownerId,
      })
      .returning();
    if (!expense) throw new Error('insert returned no row');

    await tx.insert(schema.expenseSplits).values(
      Object.entries(splits).map(([userId, amountCents]) => ({
        expenseId: expense.id,
        userId,
        amountCents,
      })),
    );

    await tx.insert(schema.activityEvents).values({
      houseId: template.houseId,
      actorId: template.ownerId,
      type: 'bill.posted',
      entityType: 'expense',
      entityId: expense.id,
      payload: { templateId: template.id, period, amountCents: template.amountCents },
    });

    await tx
      .update(schema.billTemplates)
      .set({ nextRun: advancedNextRun })
      .where(eq(schema.billTemplates.id, template.id));

    return { expense, houseId: template.houseId };
  });

  publish?.(houseId, {
    type: 'bill.posted',
    entityType: 'expense',
    entityId: expense.id,
    ts: new Date().toISOString(),
  });
  return expense.id;
}

async function pause(
  db: Db,
  templateId: string,
  houseId: string,
  actorId: string,
  reason: string,
  publish?: PublishHint,
): Promise<void> {
  const paused = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.billTemplates)
      .set({ active: false })
      .where(and(eq(schema.billTemplates.id, templateId), eq(schema.billTemplates.active, true)))
      .returning();
    if (!updated) return false; // someone else already paused it; one event is enough
    await tx.insert(schema.activityEvents).values({
      houseId,
      actorId,
      type: 'bill.paused',
      entityType: 'bill',
      entityId: templateId,
      payload: { reason },
    });
    return true;
  });
  if (paused) {
    publish?.(houseId, {
      type: 'bill.paused',
      entityType: 'bill',
      entityId: templateId,
      ts: new Date().toISOString(),
    });
  }
}
