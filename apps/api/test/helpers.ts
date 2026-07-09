import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { lastMagicLink } from '../src/auth/auth.instance';

export interface Session {
  cookie: string;
  userId: string;
}

/** HOMI-2: the only way in is the real magic-link flow. */
export async function signIn(
  http: ReturnType<INestApplication['getHttpServer']>,
  email: string,
): Promise<Session> {
  await request(http).post('/api/auth/sign-in/magic-link').send({ email }).expect(200);
  const url = lastMagicLink.get(email);
  if (!url) throw new Error(`no magic link captured for ${email}`);
  lastMagicLink.delete(email); // consumed: the capture map must not grow across a suite
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
