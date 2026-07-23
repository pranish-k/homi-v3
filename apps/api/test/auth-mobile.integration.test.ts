import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup';
import { lastMagicLink } from '../src/auth/auth.instance';
import { APP_SIGN_IN_LINK } from '../src/auth/link-page';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

/**
 * HOMI-31: the mobile sign-in contract. The emailed link opens the
 * interstitial (GET /auth/link), which hands the token to the app via
 * the homi:// deep link; the app then calls the verify endpoint itself
 * so the session cookie is set on the app's own request.
 */
describe('mobile magic-link flow (HOMI-31)', () => {
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

  describe('GET /auth/link (interstitial)', () => {
    it('serves an HTML page whose only actionable link is the app deep link', async () => {
      const token = 'abc-DEF_123.tilde~ok';
      const res = await request(http).get(`/auth/link?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toContain(`${APP_SIGN_IN_LINK}?token=${encodeURIComponent(token)}`);
      // the page must never point back at the server verify endpoint:
      // that would sign in the browser instead of the app
      expect(res.text).not.toContain('/api/auth/magic-link/verify');
    });

    it('rejects a missing token', async () => {
      await request(http).get('/auth/link').expect(400);
    });

    it('rejects tokens with characters outside the URL-safe set (HTML/URL injection guard)', async () => {
      for (const bad of ['<script>alert(1)</script>', 'a"b', 'a token', 'x'.repeat(300)]) {
        const res = await request(http).get(`/auth/link?token=${encodeURIComponent(bad)}`);
        expect(res.status).toBe(400);
        expect(res.text).not.toContain(bad);
      }
    });
  });

  it('signs the app in end-to-end: request link, verify token from the app, session persists', async () => {
    const email = `mobile-${randomUUID()}@example.com`;
    await request(http)
      .post('/api/auth/sign-in/magic-link')
      .send({ email, name: 'Mobile Roomie' })
      .expect(200);

    const url = lastMagicLink.get(email);
    if (!url) throw new Error('no magic link captured');
    lastMagicLink.delete(email);
    const token = new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();

    // what authClient.magicLink.verify({ query: { token } }) performs
    const verify = await request(http).get(`/api/auth/magic-link/verify?token=${token}`);
    expect(verify.status).toBeLessThan(400);
    const setCookies = verify.headers['set-cookie'];
    expect(setCookies).toBeTruthy();
    const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
      .map((c: string) => c.split(';')[0])
      .join('; ');

    const me = await request(http).get('/api/auth/get-session').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.name).toBe('Mobile Roomie');

    // single-use: replaying the emailed token must not mint another session
    const replay = await request(http).get(`/api/auth/magic-link/verify?token=${token}`);
    expect(replay.headers['set-cookie']).toBeUndefined();
  });
});
