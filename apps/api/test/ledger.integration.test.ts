import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db.module';
import { lastMagicLink } from '../src/auth/auth.instance';
import { setupApp } from '../src/setup';
import type { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

interface Session {
  cookie: string;
  userId: string;
}

describe('R1 money core (Sprints 1-2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let pool: Pool;
  let ana: Session;
  let ben: Session;
  let mallory: Session;
  let houseId: string;

  /** HOMI-2: the only way in is the real magic-link flow. */
  async function signIn(email: string): Promise<Session> {
    await request(http)
      .post('/api/auth/sign-in/magic-link')
      .send({ email })
      .expect(200);
    const url = lastMagicLink.get(email);
    if (!url) throw new Error(`no magic link captured for ${email}`);
    const token = new URL(url).searchParams.get('token');
    const verify = await request(http).get(`/api/auth/magic-link/verify?token=${token}`);
    expect(verify.status).toBeLessThan(400);
    const setCookies = verify.headers['set-cookie'];
    if (!setCookies) throw new Error('verify did not set a session cookie');
    const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
      .map((c: string) => c.split(';')[0])
      .join('; ');
    const me = await request(http).get('/api/auth/get-session').set('Cookie', cookie).expect(200);
    return { cookie, userId: me.body.user.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();
    pool = app.get<Pool>(PG_POOL);

    const run = randomUUID().slice(0, 8);
    ana = await signIn(`ana-${run}@example.com`);
    ben = await signIn(`ben-${run}@example.com`);
    mallory = await signIn(`mallory-${run}@example.com`);
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
          { name: 'Master', weightBp: 6000, userId: ana.userId },
          { name: 'Small room', weightBp: 3000, userId: ben.userId },
        ],
      })
      .expect(400); // 9000 bp, must be rejected

    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userId: ana.userId },
          { name: 'Small room', weightBp: 4000, userId: ben.userId },
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
      .send({ rooms: [{ name: 'X', weightBp: 10000, userId: mallory.userId }] })
      .expect(403);
  });
});
