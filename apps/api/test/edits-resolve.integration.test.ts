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

describe('HOMI-12 expense edits and HOMI-29 dispute resolution', () => {
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
    ana = await signIn(http, `ana-${run}@example.com`, 'Ana');
    ben = await signIn(http, `ben-${run}@example.com`, 'Ben');
    mallory = await signIn(http, `mallory-${run}@example.com`, 'Mallory');

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Edit House', timezone: 'UTC', currency: 'USD' })
      .expect(201);
    houseId = house.body.id;
    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    const token = invite.body.url.split('/j/')[1];
    await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createExpense(amountCents: number, description = 'Groceries') {
    const res = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description,
        amountCents,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      })
      .expect(201);
    return res.body.expense as { id: string };
  }

  async function pairwise() {
    const res = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    return res.body.pairwise as { from: string; to: string; amountCents: number }[];
  }

  function editExpense(as: Session, expenseId: string, body: Record<string, unknown>, key = randomUUID()) {
    return request(http)
      .put(`/v1/expenses/${expenseId}`)
      .set('Cookie', as.cookie)
      .set('Idempotency-Key', key)
      .send(body);
  }

  const editBody = (amountCents: number, over: Record<string, unknown> = {}) => ({
    description: 'Groceries (fixed)',
    amountCents,
    paidBy: '',
    mode: 'equal',
    participants: [] as string[],
    ...over,
  });

  it('HOMI-12: edit snapshots the previous state as a revision and rebalances', async () => {
    const expense = await createExpense(10000);
    expect(await pairwise()).toContainEqual({ from: ben.userId, to: ana.userId, amountCents: 5000 });

    const key = randomUUID();
    const edited = await editExpense(
      ana,
      expense.id,
      editBody(6000, { paidBy: ana.userId, participants: [ana.userId, ben.userId] }),
      key,
    ).expect(200);
    expect(edited.body.expense).toMatchObject({ amountCents: 6000, description: 'Groceries (fixed)' });

    // balances read the head, not the history
    expect(await pairwise()).toContainEqual({ from: ben.userId, to: ana.userId, amountCents: 3000 });

    // the previous version - fields AND splits - is in the revision
    const revisions = await pool.query(
      'select previous, changed_by from expense_revisions where expense_id = $1',
      [expense.id],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0].changed_by).toBe(ana.userId);
    expect(revisions.rows[0].previous.expense).toMatchObject({
      description: 'Groceries',
      amountCents: 10000,
    });
    expect(revisions.rows[0].previous.splits).toEqual({ [ana.userId]: 5000, [ben.userId]: 5000 });

    // idempotent replay: same key, same response, still one revision
    const replay = await editExpense(
      ana,
      expense.id,
      editBody(6000, { paidBy: ana.userId, participants: [ana.userId, ben.userId] }),
      key,
    ).expect(200);
    expect(replay.body.expense.amountCents).toBe(6000);
    const after = await pool.query('select count(*)::int as n from expense_revisions where expense_id = $1', [
      expense.id,
    ]);
    expect(after.rows[0].n).toBe(1);

    // the house hears about it
    const snap = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ben.cookie)
      .expect(200);
    expect(snap.body.feed.map((f: { type: string }) => f.type)).toContain('expense.edited');
  });

  it('HOMI-12: a second edit appends a second revision', async () => {
    const expense = await createExpense(4000, 'Pizza');
    await editExpense(ben, expense.id, editBody(5000, { paidBy: ben.userId, participants: [ana.userId, ben.userId] })).expect(200);
    await editExpense(ana, expense.id, editBody(4400, { paidBy: ana.userId, participants: [ana.userId, ben.userId] })).expect(200);
    const revisions = await pool.query(
      'select count(*)::int as n from expense_revisions where expense_id = $1',
      [expense.id],
    );
    expect(revisions.rows[0].n).toBe(2);
  });

  it('HOMI-12: cross-house edit 404s and validation 400s', async () => {
    const expense = await createExpense(3000, 'Cleaning');
    await editExpense(
      mallory,
      expense.id,
      editBody(3000, { paidBy: mallory.userId, participants: [mallory.userId] }),
    ).expect(404);
    await editExpense(ana, expense.id, editBody(-5, { paidBy: ana.userId, participants: [ana.userId] })).expect(400);
    await request(http)
      .put(`/v1/expenses/${expense.id}`)
      .set('Cookie', ana.cookie)
      .send(editBody(3000, { paidBy: ana.userId, participants: [ana.userId] }))
      .expect(400); // no idempotency key
  });

  it('HOMI-29: resolve makes a disputed payment count again, recipient-only, SQL-guarded', async () => {
    await createExpense(9000, 'Utilities');
    const payment = await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 4500, method: 'venmo' })
      .expect(201);
    const paymentId = payment.body.payment.id;

    // resolve before any dispute: 400
    await request(http)
      .post(`/v1/payments/${paymentId}/resolve`)
      .set('Cookie', ana.cookie)
      .expect(400);

    await request(http).post(`/v1/payments/${paymentId}/dispute`).set('Cookie', ana.cookie).expect(201);
    const disputedBalance = await pairwise();
    const owed = disputedBalance.find((p) => p.from === ben.userId && p.to === ana.userId);
    expect(owed?.amountCents).toBeGreaterThanOrEqual(4500); // payment not counted while disputed

    // the payer cannot resolve, nor can an outsider
    await request(http).post(`/v1/payments/${paymentId}/resolve`).set('Cookie', ben.cookie).expect(403);
    await request(http).post(`/v1/payments/${paymentId}/resolve`).set('Cookie', mallory.cookie).expect(404);
    await request(http).post('/v1/payments/not-a-uuid/resolve').set('Cookie', ana.cookie).expect(400);

    const resolved = await request(http)
      .post(`/v1/payments/${paymentId}/resolve`)
      .set('Cookie', ana.cookie)
      .expect(201);
    expect(resolved.body.payment.status).toBe('resolved');
    expect(resolved.body.payment.resolvedAt).toBeTruthy();

    const resolvedBalance = await pairwise();
    const owedNow = resolvedBalance.find((p) => p.from === ben.userId && p.to === ana.userId);
    expect((owed?.amountCents ?? 0) - (owedNow?.amountCents ?? 0)).toBe(4500); // counts again

    // double-resolve: the guard trips
    await request(http).post(`/v1/payments/${paymentId}/resolve`).set('Cookie', ana.cookie).expect(400);

    const snap = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(snap.body.feed.map((f: { type: string }) => f.type)).toContain('payment.resolved');
  });
});
