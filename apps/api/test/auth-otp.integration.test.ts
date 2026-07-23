import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup';
import { lastOtp } from '../src/auth/auth.instance';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

/**
 * HOMI-31: the email-OTP sign-in contract - the deep-link-free fallback
 * to the magic link. The user requests a code, types it into the app,
 * and the session cookie is set on the app's own request, so sign-in is
 * never stranded in a browser. Lives in its own file so its consumed
 * send budget never bleeds into the magic-link suites (each vitest file
 * gets its own process and, without REDIS_URL, its own limiter).
 */
describe('email-OTP sign-in flow (HOMI-31)', () => {
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

  async function requestCode(email: string): Promise<string> {
    await request(http)
      .post('/api/auth/email-otp/send-verification-otp')
      .send({ email, type: 'sign-in' })
      .expect(200);
    const code = lastOtp.get(email);
    if (!code) throw new Error(`no sign-in code captured for ${email}`);
    lastOtp.delete(email); // consumed: the capture map must not grow across a suite
    return code;
  }

  it('signs the app in end-to-end: request a code, sign in with it, session persists', async () => {
    const email = `otp-${randomUUID()}@example.com`;
    const code = await requestCode(email);
    expect(code).toMatch(/^\d{6}$/);

    // name is applied on first sign-up, same as the magic-link path
    const signIn = await request(http)
      .post('/api/auth/sign-in/email-otp')
      .send({ email, otp: code, name: 'Code Roomie' });
    expect(signIn.status).toBeLessThan(400);
    const setCookies = signIn.headers['set-cookie'];
    expect(setCookies).toBeTruthy();
    const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
      .map((c: string) => c.split(';')[0])
      .join('; ');

    const me = await request(http).get('/api/auth/get-session').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.name).toBe('Code Roomie');

    // single-use: replaying the same code must not mint another session
    const replay = await request(http)
      .post('/api/auth/sign-in/email-otp')
      .send({ email, otp: code });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a wrong code without signing in', async () => {
    const email = `otp-wrong-${randomUUID()}@example.com`;
    const code = await requestCode(email);
    // flip the code to something guaranteed different but same shape
    const wrong = code === '000000' ? '111111' : '000000';

    const signIn = await request(http)
      .post('/api/auth/sign-in/email-otp')
      .send({ email, otp: wrong });
    expect(signIn.status).toBeGreaterThanOrEqual(400);
    expect(signIn.headers['set-cookie']).toBeUndefined();
  });

  it('shares the sign-in email budget: cuts off code sends after 3 in the window', async () => {
    const email = `otp-rl-${randomUUID().slice(0, 8)}@example.com`;
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post('/api/auth/email-otp/send-verification-otp')
        .send({ email, type: 'sign-in' })
        .expect(200);
      lastOtp.delete(email);
    }
    const blocked = await request(http)
      .post('/api/auth/email-otp/send-verification-otp')
      .send({ email, type: 'sign-in' })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // the budget is per inbox: a different address still goes through
    const other = `otp-rl-other-${randomUUID().slice(0, 8)}@example.com`;
    await request(http)
      .post('/api/auth/email-otp/send-verification-otp')
      .send({ email: other, type: 'sign-in' })
      .expect(200);
  });
});
