import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup';
import { signIn, type Session } from './helpers';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

describe('HOMI-13 bill templates API', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
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

    const run = randomUUID().slice(0, 8);
    ana = await signIn(http, `ana-${run}@example.com`, 'Ana');
    ben = await signIn(http, `ben-${run}@example.com`, 'Ben');
    mallory = await signIn(http, `mallory-${run}@example.com`, 'Mallory');

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Bill House', timezone: 'America/New_York', currency: 'USD' })
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

  function createBill(as: Session, body: Record<string, unknown>, key = randomUUID()) {
    return request(http)
      .post(`/v1/houses/${houseId}/bills`)
      .set('Cookie', as.cookie)
      .set('Idempotency-Key', key)
      .send(body);
  }

  const rent = {
    description: 'Rent',
    amountCents: 240000,
    splitMode: 'equal',
    cadence: 'monthly',
    cadenceDay: '1',
  };

  it('creates a template with next_run computed in the house timezone, and replays on the same key', async () => {
    const key = randomUUID();
    const first = await createBill(ana, rent, key).expect(201);
    const bill = first.body.bill;
    expect(bill.nextRun).toMatch(/^\d{4}-\d{2}-01$/);
    expect(bill.active).toBe(true);
    expect(bill.ownerId).toBe(ana.userId);

    const replay = await createBill(ana, rent, key).expect(201);
    expect(replay.body.bill.id).toBe(bill.id); // replayed, not recreated

    const list = await request(http)
      .get(`/v1/houses/${houseId}/bills`)
      .set('Cookie', ben.cookie)
      .expect(200);
    expect(list.body.filter((b: { id: string }) => b.id === bill.id)).toHaveLength(1);
  });

  it('requires an Idempotency-Key and validates the schedule', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/bills`)
      .set('Cookie', ana.cookie)
      .send(rent)
      .expect(400);
    await createBill(ana, { ...rent, cadenceDay: '32' }).expect(400);
    await createBill(ana, { ...rent, cadence: 'weekly', cadenceDay: '1' }).expect(400);
    await createBill(ana, { ...rent, splitMode: 'exact' }).expect(400);
    await createBill(ana, { ...rent, ownerId: mallory.userId }).expect(400); // not a member
  });

  it('lets the owner pause and an admin resume; a bystander gets 403', async () => {
    const created = await createBill(ben, { ...rent, description: 'Internet' }).expect(201);
    const billId = created.body.bill.id;

    const paused = await request(http)
      .patch(`/v1/houses/${houseId}/bills/${billId}`)
      .set('Cookie', ben.cookie)
      .send({ active: false })
      .expect(200);
    expect(paused.body.bill.active).toBe(false);

    // ben is a plain member and not the owner of ana's rent bill
    const rentBill = await createBill(ana, { ...rent, description: 'Rent 2' }).expect(201);
    await request(http)
      .patch(`/v1/houses/${houseId}/bills/${rentBill.body.bill.id}`)
      .set('Cookie', ben.cookie)
      .send({ active: false })
      .expect(403);

    // admin resumes ben's bill; next_run is recomputed, not back-posted
    const resumed = await request(http)
      .patch(`/v1/houses/${houseId}/bills/${billId}`)
      .set('Cookie', ana.cookie)
      .send({ active: true })
      .expect(200);
    expect(resumed.body.bill.active).toBe(true);
  });

  it('refuses cross-house access: a non-member can neither create nor list bills', async () => {
    await createBill(mallory, rent).expect(403);
    await request(http)
      .get(`/v1/houses/${houseId}/bills`)
      .set('Cookie', mallory.cookie)
      .expect(403);
  });

  it('malformed ids get 4xx, never a Postgres cast error 500', async () => {
    await request(http)
      .get('/v1/houses/not-a-uuid/bills')
      .set('Cookie', ana.cookie)
      .expect(403);
    await request(http)
      .patch(`/v1/houses/${houseId}/bills/not-a-uuid`)
      .set('Cookie', ana.cookie)
      .send({ active: false })
      .expect(400);
  });
});
