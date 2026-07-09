import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup';
import { signIn } from './helpers';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

/**
 * HOMI-24 (review M6): the magic-link endpoint is an unauthenticated
 * email-send loop and invites gate membership; both are budgeted.
 * Lives in its own file so its consumed budgets never bleed into the
 * other suites (each vitest file gets its own process and, without
 * REDIS_URL, its own in-memory limiter).
 */
describe('rate limiting (HOMI-24)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cuts off magic-link sends per email after 3 in the window, with Retry-After', async () => {
    const email = `victim-${randomUUID().slice(0, 8)}@example.com`;
    for (let i = 0; i < 3; i++) {
      await request(http).post('/api/auth/sign-in/magic-link').send({ email }).expect(200);
    }
    const blocked = await request(http)
      .post('/api/auth/sign-in/magic-link')
      .send({ email })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // the budget is per inbox: a different address still goes through
    await request(http)
      .post('/api/auth/sign-in/magic-link')
      .send({ email: `other-${randomUUID().slice(0, 8)}@example.com` })
      .expect(200);
  });

  it('is case-insensitive on the email key (no budget bypass via casing)', async () => {
    const email = `casing-${randomUUID().slice(0, 8)}@example.com`;
    for (let i = 0; i < 3; i++) {
      await request(http).post('/api/auth/sign-in/magic-link').send({ email }).expect(200);
    }
    await request(http)
      .post('/api/auth/sign-in/magic-link')
      .send({ email: email.toUpperCase() })
      .expect(429);
  });

  it('limits invite accepts per user after 20 in an hour, with Retry-After (spec 5.5)', async () => {
    const run = randomUUID().slice(0, 8);
    const admin = await signIn(http, `rl-admin-${run}@example.com`);
    const joiner = await signIn(http, `rl-joiner-${run}@example.com`);

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', admin.cookie)
      .send({ name: 'Rate Limit House', timezone: 'UTC', currency: 'USD' })
      .expect(201);
    const invite = await request(http)
      .post(`/v1/houses/${house.body.id}/invites`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const token = invite.body.url.split('/j/')[1];

    // 20 accepts pass (the 19 re-accepts are no-ops but still count)
    for (let i = 0; i < 20; i++) {
      await request(http)
        .post(`/v1/invites/${token}/accept`)
        .set('Cookie', joiner.cookie)
        .expect(201);
    }
    const blocked = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', joiner.cookie)
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.message).toMatch(/too many/i);

    // the admin's budget is separate: unaffected by the joiner's spree
    await request(http)
      .post(`/v1/houses/${house.body.id}/invites`)
      .set('Cookie', admin.cookie)
      .expect(201);
  });
});
