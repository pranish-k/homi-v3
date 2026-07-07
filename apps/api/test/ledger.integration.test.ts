import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db.module';
import type { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}
process.env.DEV_AUTH_ENABLED = 'true';

const ana = randomUUID();
const ben = randomUUID();
const stranger = randomUUID();

const asUser = (userId: string) => ({ 'x-user-id': userId, 'x-user-name': 'Test User' });

describe('ledger walking skeleton (HOMI-3, HOMI-6, HOMI-7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let houseId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    const pool = app.get<Pool>(PG_POOL);
    await app.close();
    await pool.end();
  });

  it('creates a house and adds a member', async () => {
    const res = await request(http)
      .post('/v1/houses')
      .set(asUser(ana))
      .send({ name: 'Maple St', timezone: 'America/New_York', currency: 'USD' })
      .expect(201);
    houseId = res.body.id;
    expect(houseId).toBeTruthy();

    await request(http)
      .post(`/v1/houses/${houseId}/members`)
      .set(asUser(ana))
      .send({ userId: ben, displayName: 'Ben' })
      .expect(201);
  });

  it('rejects money mutations without an Idempotency-Key', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .send({
        description: 'Groceries',
        amountCents: 5000,
        paidBy: ana,
        mode: 'equal',
        participants: [ana, ben],
      })
      .expect(400);
  });

  it('creates an equal-split expense with exact cent math (H3)', async () => {
    const key = randomUUID();
    const res = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .set('Idempotency-Key', key)
      .send({
        description: 'Pizza night',
        amountCents: 10000,
        paidBy: ana,
        mode: 'equal',
        participants: [ana, ben],
      })
      .expect(201);
    expect(res.body.splits[ana] + res.body.splits[ben]).toBe(10000);
  });

  it('replays the stored response on idempotent retry, never double-posting (H1)', async () => {
    const key = randomUUID();
    const payload = {
      description: 'Rent',
      amountCents: 200000,
      paidBy: ana,
      mode: 'equal' as const,
      participants: [ana, ben],
    };
    const first = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const retry = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(retry.body.expense.id).toBe(first.body.expense.id);

    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set(asUser(ben))
      .expect(200);
    // pizza 10000/2 + rent 200000/2 = 105000 owed by ben, not 205000
    const pair = balances.body.pairwise.find(
      (p: { from: string; to: string }) => p.from === ben && p.to === ana,
    );
    expect(pair.amountCents).toBe(105000);
  });

  it('rejects splits whose exact amounts do not sum to the total (invariant 2)', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Utilities',
        amountCents: 9000,
        paidBy: ana,
        mode: 'exact',
        participants: [ana, ben],
        exactCents: { [ana]: 4000, [ben]: 4999 },
      })
      .expect(400);
  });

  it('rejects participants who are not house members', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(ana))
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Sneaky',
        amountCents: 1000,
        paidBy: ana,
        mode: 'equal',
        participants: [ana, stranger],
      })
      .expect(400);
  });

  it('denies cross-house access (spec 5.6 authorization test)', async () => {
    await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set(asUser(stranger))
      .expect(403);
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set(asUser(stranger))
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Not my house',
        amountCents: 1000,
        paidBy: stranger,
        mode: 'equal',
        participants: [stranger],
      })
      .expect(403);
  });
});
