import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, schema, type Db } from '@homi/db';
import { type RealtimeHint } from '@homi/domain';
import { postDueBills } from '../src/bills/post-due-bills';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

const pool = createPool(process.env.DATABASE_URL);
const db: Db = createDb(pool);

async function seedUser(name: string): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com` })
    .returning();
  if (!user) throw new Error('no user row');
  return user.id;
}

async function seedHouse(timezone: string, memberIds: string[]): Promise<string> {
  const [house] = await db
    .insert(schema.houses)
    .values({ name: 'Worker Test House', timezone, currency: 'USD', createdBy: memberIds[0]! })
    .returning();
  if (!house) throw new Error('no house row');
  await db
    .insert(schema.houseMembers)
    .values(memberIds.map((userId, i) => ({ houseId: house.id, userId, role: i === 0 ? 'admin' : 'member' })));
  return house.id;
}

interface TemplateOpts {
  splitMode?: string;
  cadence?: string;
  cadenceDay?: string;
  nextRun: string;
  amountCents?: number;
}

async function seedTemplate(houseId: string, ownerId: string, opts: TemplateOpts): Promise<string> {
  const [tpl] = await db
    .insert(schema.billTemplates)
    .values({
      houseId,
      description: 'October rent',
      amountCents: opts.amountCents ?? 240000,
      ownerId,
      splitMode: opts.splitMode ?? 'equal',
      cadence: opts.cadence ?? 'monthly',
      cadenceDay: opts.cadenceDay ?? '1',
      nextRun: opts.nextRun,
      createdBy: ownerId,
    })
    .returning();
  if (!tpl) throw new Error('no template row');
  return tpl.id;
}

async function postedExpenses(templateId: string) {
  return db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.templateId, templateId))
    .orderBy(schema.expenses.period);
}

describe('postDueBills (HOMI-13)', () => {
  let ana: string;
  let ben: string;
  let chloe: string;

  beforeAll(async () => {
    ana = await seedUser('Ana');
    ben = await seedUser('Ben');
    chloe = await seedUser('Chloe');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('posts a due bill once with equal splits, advances next_run, emits event + hint', async () => {
    const houseId = await seedHouse('UTC', [ana, ben, chloe]);
    const templateId = await seedTemplate(houseId, ana, { nextRun: '2026-07-01', amountCents: 9000 });
    const hints: { houseId: string; hint: RealtimeHint }[] = [];

    const result = await postDueBills(db, new Date('2026-07-01T00:05:00Z'), (h, hint) =>
      hints.push({ houseId: h, hint }),
    );

    expect(result.posted).toHaveLength(1);
    const expenses = await postedExpenses(templateId);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ period: '2026-07', amountCents: 9000, paidBy: ana });

    const splits = await db
      .select()
      .from(schema.expenseSplits)
      .where(eq(schema.expenseSplits.expenseId, expenses[0]!.id));
    expect(splits.map((s) => s.amountCents).reduce((a, b) => a + b, 0)).toBe(9000);
    expect(splits).toHaveLength(3);

    const [tpl] = await db
      .select()
      .from(schema.billTemplates)
      .where(eq(schema.billTemplates.id, templateId));
    expect(tpl?.nextRun).toBe('2026-08-01');

    const events = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(eq(schema.activityEvents.houseId, houseId), eq(schema.activityEvents.type, 'bill.posted')),
      );
    expect(events).toHaveLength(1);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ houseId, hint: { type: 'bill.posted', entityType: 'expense' } });

    // not due again: nothing happens
    const again = await postDueBills(db, new Date('2026-07-01T02:00:00Z'));
    expect(again.posted.filter((p) => p.templateId === templateId)).toHaveLength(0);
  });

  it('H4: a re-run whose bookkeeping was lost trips the unique key instead of double-posting', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    const templateId = await seedTemplate(houseId, ana, { nextRun: '2026-07-01' });

    await postDueBills(db, new Date('2026-07-01T00:05:00Z'));
    // simulate a crashed run that posted but never advanced next_run
    await db
      .update(schema.billTemplates)
      .set({ nextRun: '2026-07-01' })
      .where(eq(schema.billTemplates.id, templateId));

    const rerun = await postDueBills(db, new Date('2026-07-01T00:10:00Z'));
    expect(rerun.alreadyPosted).toContainEqual({ templateId, period: '2026-07' });
    expect(await postedExpenses(templateId)).toHaveLength(1);

    const [tpl] = await db
      .select()
      .from(schema.billTemplates)
      .where(eq(schema.billTemplates.id, templateId));
    expect(tpl?.nextRun).toBe('2026-08-01'); // bookkeeping healed
  });

  it('catches up one period per due date when the worker was down across several', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    const templateId = await seedTemplate(houseId, ana, { nextRun: '2026-04-01' });

    const result = await postDueBills(db, new Date('2026-07-02T00:00:00Z'));
    const mine = result.posted.filter((p) => p.templateId === templateId);
    expect(mine.map((p) => p.period)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
    expect(await postedExpenses(templateId)).toHaveLength(4);
  });

  it('H5: due-ness is the house-local date, not the server date', async () => {
    // 00:30 UTC on July 14 is already July 14 in Kiritimati (UTC+14)
    // but still July 13 in New York
    const kiritimatiHouse = await seedHouse('Pacific/Kiritimati', [ana, ben]);
    const nyHouse = await seedHouse('America/New_York', [ana, ben]);
    const kiritimatiTpl = await seedTemplate(kiritimatiHouse, ana, { nextRun: '2026-07-14', cadenceDay: '14' });
    const nyTpl = await seedTemplate(nyHouse, ana, { nextRun: '2026-07-14', cadenceDay: '14' });

    const result = await postDueBills(db, new Date('2026-07-14T00:30:00Z'));
    const postedIds = result.posted.map((p) => p.templateId);
    expect(postedIds).toContain(kiritimatiTpl);
    expect(postedIds).not.toContain(nyTpl);
    expect(await postedExpenses(nyTpl)).toHaveLength(0);
  });

  it('room_weighted: splits follow room weights derived at posting time', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    const [big] = await db
      .insert(schema.rooms)
      .values({ houseId, name: 'Big', weightBp: 6000 })
      .returning();
    const [small] = await db
      .insert(schema.rooms)
      .values({ houseId, name: 'Small', weightBp: 4000 })
      .returning();
    await db
      .update(schema.houseMembers)
      .set({ roomId: big!.id })
      .where(and(eq(schema.houseMembers.houseId, houseId), eq(schema.houseMembers.userId, ana)));
    await db
      .update(schema.houseMembers)
      .set({ roomId: small!.id })
      .where(and(eq(schema.houseMembers.houseId, houseId), eq(schema.houseMembers.userId, ben)));

    const templateId = await seedTemplate(houseId, ana, {
      nextRun: '2026-07-01',
      splitMode: 'room_weighted',
      amountCents: 100000,
    });
    await postDueBills(db, new Date('2026-07-01T12:00:00Z'));

    const [expense] = await postedExpenses(templateId);
    const splits = await db
      .select()
      .from(schema.expenseSplits)
      .where(eq(schema.expenseSplits.expenseId, expense!.id));
    const byUser = Object.fromEntries(splits.map((s) => [s.userId, s.amountCents]));
    expect(byUser[ana]).toBe(60000);
    expect(byUser[ben]).toBe(40000);
  });

  it('pauses a bill it cannot post (vacant room breaks the weight sum) instead of hot-looping', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    const [occupied] = await db
      .insert(schema.rooms)
      .values({ houseId, name: 'Occupied', weightBp: 6000 })
      .returning();
    await db.insert(schema.rooms).values({ houseId, name: 'Vacant', weightBp: 4000 });
    await db
      .update(schema.houseMembers)
      .set({ roomId: occupied!.id })
      .where(and(eq(schema.houseMembers.houseId, houseId), eq(schema.houseMembers.userId, ana)));

    const templateId = await seedTemplate(houseId, ana, {
      nextRun: '2026-07-01',
      splitMode: 'room_weighted',
    });
    const result = await postDueBills(db, new Date('2026-07-01T12:00:00Z'));

    expect(result.paused.map((p) => p.templateId)).toContain(templateId);
    expect(await postedExpenses(templateId)).toHaveLength(0);
    const [tpl] = await db
      .select()
      .from(schema.billTemplates)
      .where(eq(schema.billTemplates.id, templateId));
    expect(tpl?.active).toBe(false);

    const events = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(eq(schema.activityEvents.houseId, houseId), eq(schema.activityEvents.type, 'bill.paused')),
      );
    expect(events).toHaveLength(1);
  });

  it('pauses a bill whose owner left the house', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    const templateId = await seedTemplate(houseId, ben, { nextRun: '2026-07-01' });
    await db
      .update(schema.houseMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(schema.houseMembers.houseId, houseId), eq(schema.houseMembers.userId, ben)));

    const result = await postDueBills(db, new Date('2026-07-01T12:00:00Z'));
    expect(result.paused.map((p) => p.templateId)).toContain(templateId);
    expect(await postedExpenses(templateId)).toHaveLength(0);
  });

  it('weekly cadence posts on the weekday with the due date as its period', async () => {
    const houseId = await seedHouse('UTC', [ana, ben]);
    // 2026-07-06 is a Monday
    const templateId = await seedTemplate(houseId, ana, {
      nextRun: '2026-07-06',
      cadence: 'weekly',
      cadenceDay: 'monday',
      amountCents: 3000,
    });

    await postDueBills(db, new Date('2026-07-06T09:00:00Z'));
    const expenses = await postedExpenses(templateId);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.period).toBe('2026-07-06');

    const [tpl] = await db
      .select()
      .from(schema.billTemplates)
      .where(eq(schema.billTemplates.id, templateId));
    expect(tpl?.nextRun).toBe('2026-07-13');
  });
});
