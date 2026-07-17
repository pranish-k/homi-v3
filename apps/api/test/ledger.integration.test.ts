import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db.module';
import { setupApp } from '../src/setup';
import { signIn, type Session } from './helpers';
import type { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

describe('R1 money core (Sprints 1-2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let pool: Pool;
  let ana: Session;
  let ben: Session;
  let mallory: Session;
  let houseId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();
    pool = app.get<Pool>(PG_POOL);

    const run = randomUUID().slice(0, 8);
    ana = await signIn(http, `ana-${run}@example.com`);
    ben = await signIn(http, `ben-${run}@example.com`);
    mallory = await signIn(http, `mallory-${run}@example.com`);
  });

  afterAll(async () => {
    // app.close() drains the shared pool via DbModule.onApplicationShutdown
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(http).post('/v1/houses').send({ name: 'X', timezone: 'UTC' }).expect(401);
  });

  it('creates a house and joins a roommate via invite link (HOMI-3, HOMI-8)', async () => {
    const res = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Maple St', timezone: 'America/New_York', currency: 'USD' })
      .expect(201);
    houseId = res.body.id;

    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    expect(invite.body.url).toMatch(/\/j\//);
    const token = invite.body.url.split('/j/')[1];

    const accept = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);
    expect(accept.body).toEqual({ houseId, alreadyMember: false });

    // re-accepting is a no-op, not an error
    const again = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);
    expect(again.body.alreadyMember).toBe(true);
  });

  it('rejects invalid invite tokens and non-admin invite creation', async () => {
    await request(http)
      .post('/v1/invites/not-a-real-token/accept')
      .set('Cookie', mallory.cookie)
      .expect(400);
    await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ben.cookie)
      .expect(403);
  });

  it('configures rooms with weights summing to 10000 bp (HOMI-10)', async () => {
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userIds: [ana.userId] },
          { name: 'Small room', weightBp: 3000, userIds: [ben.userId] },
        ],
      })
      .expect(400); // 9000 bp, must be rejected

    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userIds: [ana.userId] },
          { name: 'Small room', weightBp: 4000, userIds: [ben.userId] },
        ],
      })
      .expect(200);
  });

  it('creates a room-weighted expense with server-derived weights (HOMI-6, HOMI-10)', async () => {
    const res = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Rent',
        amountCents: 200000,
        paidBy: ana.userId,
        mode: 'room_weighted',
        participants: [ana.userId, ben.userId],
      })
      .expect(201);
    expect(res.body.splits[ana.userId]).toBe(120000);
    expect(res.body.splits[ben.userId]).toBe(80000);

    // clients may not supply their own weights in room_weighted mode
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Sneaky weights',
        amountCents: 1000,
        paidBy: ana.userId,
        mode: 'room_weighted',
        participants: [ana.userId, ben.userId],
        weightsBp: { [ana.userId]: 1, [ben.userId]: 9999 },
      })
      .expect(400);
  });

  it('scopes idempotency keys to the caller: another user reusing a key executes fresh, never sees the stored response (review C1)', async () => {
    const key = randomUUID();
    const anaExpense = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', key)
      .send({
        description: 'Ana groceries',
        amountCents: 3000,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      })
      .expect(201);

    const benExpense = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', key)
      .send({
        description: 'Ben cleaning supplies',
        amountCents: 2000,
        paidBy: ben.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      })
      .expect(201);
    expect(benExpense.body.expense.id).not.toBe(anaExpense.body.expense.id);
    expect(benExpense.body.expense.description).toBe('Ben cleaning supplies');
  });

  it('rejects an idempotency key reused with a different body (review M4)', async () => {
    const key = randomUUID();
    const base = {
      description: 'Internet',
      amountCents: 6000,
      paidBy: ana.userId,
      mode: 'equal' as const,
      participants: [ana.userId, ben.userId],
    };
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', key)
      .send(base)
      .expect(201);
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', key)
      .send({ ...base, amountCents: 9999 })
      .expect(409);
  });

  it('keeps the ledger single-currency (review C2)', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Euro mischief',
        amountCents: 1000,
        currency: 'EUR',
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      })
      .expect(400);
    await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 1000, currency: 'JPY' })
      .expect(400);
  });

  it('rejects amounts beyond the safe bound (review H3)', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 20_000_000_000 }) // over the $100M-in-cents bound
      .expect(400);
  });

  it('survives concurrent duplicate submissions: same key in parallel posts exactly once (H1 race)', async () => {
    const key = randomUUID();
    const payload = {
      description: 'Racing rent',
      amountCents: 50000,
      paidBy: ana.userId,
      mode: 'equal' as const,
      participants: [ana.userId, ben.userId],
    };
    const send = () =>
      request(http)
        .post(`/v1/houses/${houseId}/expenses`)
        .set('Cookie', ana.cookie)
        .set('Idempotency-Key', key)
        .send(payload);
    const results = await Promise.all([send(), send(), send()]);
    for (const r of results) expect(r.status).toBe(201);
    const ids = new Set(results.map((r) => r.body.expense.id));
    expect(ids.size).toBe(1);
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM expenses WHERE description = 'Racing rent' AND house_id = $1`,
      [houseId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('holds invariant 2 in the database: splits sum to the expense total', async () => {
    const rows = await pool.query(`
      SELECT e.id FROM expenses e
      JOIN expense_splits s ON s.expense_id = e.id
      GROUP BY e.id, e.amount_cents
      HAVING SUM(s.amount_cents) <> e.amount_cents
    `);
    expect(rows.rowCount).toBe(0);
  });

  it('replays idempotent expense retries without double-posting (H1)', async () => {
    const key = randomUUID();
    const payload = {
      description: 'Pizza',
      amountCents: 10000,
      paidBy: ana.userId,
      mode: 'equal' as const,
      participants: [ana.userId, ben.userId],
    };
    const first = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const retry = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(retry.body.expense.id).toBe(first.body.expense.id);
  });

  it('records a settlement payment and reflects it in balances (HOMI-7, HOMI-11)', async () => {
    // ben's debt so far: rent 80000 + groceries 1500 - cleaning 1000
    // + internet 3000 + racing rent 25000 + pizza 5000 = 113500
    await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 50000, method: 'venmo' })
      .expect(201);

    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ben.cookie)
      .expect(200);
    const pair = balances.body.pairwise.find(
      (p: { from: string }) => p.from === ben.userId,
    );
    expect(pair.to).toBe(ana.userId);
    expect(pair.amountCents).toBe(63500); // 113500 - 50000
  });

  it('lets only the recipient dispute, only inside 72 hours (HOMI-11)', async () => {
    const created = await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 1000 })
      .expect(201);
    const paymentId = created.body.payment.id;

    // the payer cannot dispute their own payment
    await request(http)
      .post(`/v1/payments/${paymentId}/dispute`)
      .set('Cookie', ben.cookie)
      .expect(403);
    // an outsider sees nothing
    await request(http)
      .post(`/v1/payments/${paymentId}/dispute`)
      .set('Cookie', mallory.cookie)
      .expect(404);

    // recipient disputes; disputed payments drop out of balances
    const before = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    await request(http)
      .post(`/v1/payments/${paymentId}/dispute`)
      .set('Cookie', ana.cookie)
      .expect(201);
    await request(http)
      .post(`/v1/payments/${paymentId}/dispute`)
      .set('Cookie', ana.cookie)
      .expect(400); // already disputed
    const after = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    const owed = (b: typeof after) =>
      b.body.pairwise.find((p: { from: string }) => p.from === ben.userId)?.amountCents ?? 0;
    expect(owed(after)).toBe(owed(before) + 1000); // the disputed 1000 no longer counts as paid

    // a payment older than 72h is closed for dispute
    const stale = await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 2000 })
      .expect(201);
    await pool.query(`UPDATE payments SET created_at = now() - interval '73 hours' WHERE id = $1`, [
      stale.body.payment.id,
    ]);
    await request(http)
      .post(`/v1/payments/${stale.body.payment.id}/dispute`)
      .set('Cookie', ana.cookie)
      .expect(400);
  });

  it('rejects splits whose exact amounts do not sum to the total (invariant 2)', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Utilities',
        amountCents: 9000,
        paidBy: ana.userId,
        mode: 'exact',
        participants: [ana.userId, ben.userId],
        exactCents: { [ana.userId]: 4000, [ben.userId]: 4999 },
      })
      .expect(400);
  });

  it('serves the HOME snapshot in one call: members, balances, action items, feed head (HOMI-20)', async () => {
    const res = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ben.cookie)
      .expect(200);

    expect(res.body.house).toMatchObject({ id: houseId, currency: 'USD' });
    const memberIds = res.body.members.map((m: { userId: string }) => m.userId);
    expect(memberIds).toContain(ana.userId);
    expect(memberIds).toContain(ben.userId);
    expect(memberIds).not.toContain(mallory.userId);

    // invariant 3: the snapshot's balances are THE balances
    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ben.cookie)
      .expect(200);
    expect(res.body.balances).toEqual(balances.body);

    // ben owes ana, so ben's action items say settle up, with the exact
    // pairwise amount; nobody has to ask (M3, M4)
    const debt = res.body.balances.pairwise.find((p: { from: string }) => p.from === ben.userId);
    expect(res.body.actionItems).toContainEqual({
      type: 'settle_up',
      toUserId: ana.userId,
      amountCents: debt.amountCents,
    });

    expect(res.body.feed.length).toBeGreaterThan(0);
    expect(res.body.feed.length).toBeLessThanOrEqual(20);
    expect(res.body.feed[0].houseId).toBe(houseId);

    // ana received one payment still open inside its 72h window (the
    // disputed one is out, the backdated one is past the window)
    const anaView = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ana.cookie)
      .expect(200);
    const confirms = anaView.body.actionItems.filter(
      (a: { type: string }) => a.type === 'confirm_payment',
    );
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ fromUserId: ben.userId, amountCents: 50000 });
  });

  it('pages the unified ledger by keyset cursor with no gaps or duplicates (HOMI-16)', async () => {
    const counts = await pool.query(
      `SELECT
        (SELECT count(*) FROM expenses WHERE house_id = $1 AND deleted_at IS NULL) AS expenses,
        (SELECT count(*) FROM payments WHERE house_id = $1) AS payments`,
      [houseId],
    );
    const expected = Number(counts.rows[0].expenses) + Number(counts.rows[0].payments);
    expect(expected).toBeGreaterThan(6); // the suite above created plenty

    const seen: { id: string; createdAt: string; kind: string }[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const url = `/v1/houses/${houseId}/ledger?limit=4${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(http).get(url).set('Cookie', ana.cookie).expect(200);
      expect(res.body.entries.length).toBeLessThanOrEqual(4);
      seen.push(...res.body.entries);
      cursor = res.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen).toHaveLength(expected);
    expect(new Set(seen.map((e) => e.id)).size).toBe(expected);
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1]!;
      const cur = seen[i]!;
      const ord =
        prev.createdAt > cur.createdAt ||
        (prev.createdAt === cur.createdAt && prev.id > cur.id);
      expect(ord).toBe(true);
    }

    // expenses carry their splits and they sum to the total (invariant 2)
    const expense = seen.find((e) => e.kind === 'expense') as unknown as {
      amountCents: number;
      splits: Record<string, number>;
    };
    const sum = Object.values(expense.splits).reduce((a, b) => a + b, 0);
    expect(sum).toBe(expense.amountCents);

    // disputed payments stay visible in history even though balances exclude them
    const disputed = seen.filter(
      (e) => e.kind === 'payment' && (e as unknown as { status: string }).status === 'disputed',
    );
    expect(disputed).toHaveLength(1);

    await request(http)
      .get(`/v1/houses/${houseId}/ledger?cursor=garbage`)
      .set('Cookie', ana.cookie)
      .expect(400);
    await request(http)
      .get(`/v1/houses/${houseId}/ledger?limit=101`)
      .set('Cookie', ana.cookie)
      .expect(400);
  });

  it('separates liveness from DB-backed readiness (HOMI-27)', async () => {
    const live = await request(http).get('/healthz').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(http).get('/readyz').expect(200);
    expect(ready.body).toEqual({ status: 'ok' });
  });

  it('denies cross-house access on every surface (spec 5.6)', async () => {
    await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', mallory.cookie)
      .expect(403);
    await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', mallory.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 100 })
      .expect(403);
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', mallory.cookie)
      .send({ rooms: [{ name: 'X', weightBp: 10000, userIds: [mallory.userId] }] })
      .expect(403);
    await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', mallory.cookie)
      .expect(403);
    await request(http)
      .get(`/v1/houses/${houseId}/ledger`)
      .set('Cookie', mallory.cookie)
      .expect(403);
  });
});
