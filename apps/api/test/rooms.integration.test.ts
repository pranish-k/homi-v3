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

/** HOMI-23: a shared room's weight divides across its occupants. */
describe('shared rooms (HOMI-23)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let ana: Session; // admin, has her own room
  let ben: Session; // couple, shares the master
  let cara: Session; // couple, shares the master
  let houseId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();

    const run = randomUUID().slice(0, 8);
    ana = await signIn(http, `ana-${run}@example.com`);
    ben = await signIn(http, `ben-${run}@example.com`);
    cara = await signIn(http, `cara-${run}@example.com`);

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Birch St', timezone: 'America/New_York', currency: 'USD' })
      .expect(201);
    houseId = house.body.id;
    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    const token = invite.body.url.split('/j/')[1];
    await request(http).post(`/v1/invites/${token}/accept`).set('Cookie', ben.cookie).expect(201);
    await request(http).post(`/v1/invites/${token}/accept`).set('Cookie', cara.cookie).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects one member occupying two rooms', async () => {
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userIds: [ben.userId, ben.userId] },
          { name: 'Back room', weightBp: 4000, userIds: [ana.userId] },
        ],
      })
      .expect(400);
  });

  it('splits a shared room-weighted expense across the couple (HOMI-23)', async () => {
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userIds: [ben.userId, cara.userId] },
          { name: 'Back room', weightBp: 4000, userIds: [ana.userId] },
        ],
      })
      .expect(200);

    const res = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Rent',
        amountCents: 100000,
        paidBy: ana.userId,
        mode: 'room_weighted',
        participants: [ana.userId, ben.userId, cara.userId],
      })
      .expect(201);
    // Master's 6000bp divides between ben and cara: 3000bp -> $300 each
    expect(res.body.splits[ana.userId]).toBe(40000);
    expect(res.body.splits[ben.userId]).toBe(30000);
    expect(res.body.splits[cara.userId]).toBe(30000);
  });

  it('returns a shared room as ONE row listing all occupants (review fix)', async () => {
    const res = await request(http)
      .get(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(res.body).toHaveLength(2);
    const master = res.body.find((r: { name: string }) => r.name === 'Master');
    const back = res.body.find((r: { name: string }) => r.name === 'Back room');
    expect(master.userIds.sort()).toEqual([ben.userId, cara.userId].sort());
    expect(back.userIds).toEqual([ana.userId]);
    const total = res.body.reduce((acc: number, r: { weightBp: number }) => acc + r.weightBp, 0);
    expect(total).toBe(10000);
  });

  it('rejects a room-weighted expense that leaves out one of the room sharers', async () => {
    // without cara the weights cannot reach 10000bp; the split must not
    // silently hand her share to anyone else
    await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Rent minus cara',
        amountCents: 100000,
        paidBy: ana.userId,
        mode: 'room_weighted',
        participants: [ana.userId, ben.userId],
      })
      .expect(400);
  });

  it('pins the odd basis point deterministically to the earlier-joined occupant', async () => {
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6001, userIds: [ben.userId, cara.userId] },
          { name: 'Back room', weightBp: 3999, userIds: [ana.userId] },
        ],
      })
      .expect(200);

    const res = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Odd rent',
        amountCents: 10000,
        paidBy: ana.userId,
        mode: 'room_weighted',
        participants: [ana.userId, ben.userId, cara.userId],
      })
      .expect(201);
    // ben joined before cara, so the odd basis point (3001 vs 3000) is his
    expect(res.body.splits[ben.userId]).toBeGreaterThanOrEqual(res.body.splits[cara.userId]);
    const total = Object.values(res.body.splits as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(10000);
  });
});
