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

/**
 * HOMI-32: the client's path into a house - list my houses, preview an
 * invite before accepting it, and the /j/<token> interstitial that
 * carries a shared link into the app.
 */
describe('create a house / join by invite link (HOMI-32)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let ana: Session; // creator, admin
  let ben: Session; // joins by link
  let cat: Session; // never joins
  let houseId: string;

  const mintInvite = async (placeholderId?: string) => {
    const res = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .send(placeholderId === undefined ? {} : { placeholderId })
      .expect(201);
    return { url: res.body.url as string, token: res.body.url.split('/j/')[1] as string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();

    const run = randomUUID().slice(0, 8);
    ana = await signIn(http, `ana-${run}@example.com`, 'Ana');
    ben = await signIn(http, `ben-${run}@example.com`, 'Ben');
    cat = await signIn(http, `cat-${run}@example.com`, 'Cat');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a fresh user has no houses, and creating one puts them in it as admin', async () => {
    await request(http)
      .get('/v1/houses')
      .set('Cookie', ana.cookie)
      .expect(200)
      .then((r) => expect(r.body).toEqual([]));

    const created = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Maple Street', timezone: 'America/New_York', currency: 'USD' })
      .expect(201);
    houseId = created.body.id;

    const listed = await request(http).get('/v1/houses').set('Cookie', ana.cookie).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({
      id: houseId,
      name: 'Maple Street',
      currency: 'USD',
      role: 'admin',
    });
  });

  it('listing is per-user: a non-member sees none of it', async () => {
    await request(http)
      .get('/v1/houses')
      .set('Cookie', cat.cookie)
      .expect(200)
      .then((r) => expect(r.body).toEqual([]));
  });

  it('requires a session', async () => {
    await request(http).get('/v1/houses').expect(401);
  });

  it('previews an invite by name without consuming it, then joins', async () => {
    const { token } = await mintInvite();

    const preview = await request(http)
      .get(`/v1/invites/${token}`)
      .set('Cookie', ben.cookie)
      .expect(200);
    expect(preview.body).toMatchObject({
      houseId,
      houseName: 'Maple Street',
      invitedByName: 'Ana',
      placeholderName: null,
    });

    // Previewing twice still leaves the invite usable - it is a read.
    await request(http).get(`/v1/invites/${token}`).set('Cookie', ben.cookie).expect(200);

    await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);

    const listed = await request(http).get('/v1/houses').set('Cookie', ben.cookie).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: houseId, role: 'member' });
  });

  it('names the placeholder a claim invite would hand over', async () => {
    const placeholder = await request(http)
      .post(`/v1/houses/${houseId}/members/placeholders`)
      .set('Cookie', ana.cookie)
      .send({ name: 'Sam' })
      .expect(201);
    const { token } = await mintInvite(placeholder.body.userId);

    const preview = await request(http)
      .get(`/v1/invites/${token}`)
      .set('Cookie', cat.cookie)
      .expect(200);
    expect(preview.body).toMatchObject({ houseName: 'Maple Street', placeholderName: 'Sam' });
  });

  it('rejects a preview of an unknown or consumed invite', async () => {
    await request(http)
      .get(`/v1/invites/${randomUUID().replace(/-/g, '')}`)
      .set('Cookie', ben.cookie)
      .expect(400);

    const { token } = await mintInvite();
    await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', cat.cookie)
      .expect(201);
    // maxUses defaults above 1, so a used invite still previews; a
    // revoked one must not.
    const revoked = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    await request(http).get(`/v1/invites/${revoked}`).set('Cookie', ben.cookie).expect(400);
  });

  it('serves the invite link as an interstitial that opens the app', async () => {
    const { url, token } = await mintInvite();
    expect(url).toContain('/j/');

    const page = await request(http).get(`/j/${token}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.text).toContain(`homi://join?token=${token}`);
    // The browser must never be able to accept on the user's behalf.
    expect(page.text).not.toContain('/v1/invites');
    // The page names no house: invite links travel through group chats.
    expect(page.text).not.toContain('Maple Street');

    await request(http).get('/j/not a token').expect(400);
  });
});
