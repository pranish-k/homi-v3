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

interface SnapshotMember {
  userId: string;
  name: string;
  displayName: string | null;
}

describe('HOMI-28 member names', () => {
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
      .send({ name: 'Maple St', timezone: 'America/New_York', currency: 'USD' })
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

  async function snapshotMembers(as: Session): Promise<SnapshotMember[]> {
    const res = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', as.cookie)
      .expect(200);
    return res.body.members as SnapshotMember[];
  }

  it('captures the account name at magic-link sign-up, so members are never nameless', async () => {
    const members = await snapshotMembers(ana);
    expect(members.map((m) => m.name).sort()).toEqual(['Ana', 'Ben']);
  });

  it('keeps the original name on a later sign-in that sends a different one', async () => {
    const again = await signIn(http, `ana-${houseId.slice(0, 8)}@example.com`, 'First');
    const rename = await signIn(http, `ana-${houseId.slice(0, 8)}@example.com`, 'Second');
    expect(rename.userId).toBe(again.userId);
    const session = await request(http)
      .get('/api/auth/get-session')
      .set('Cookie', rename.cookie)
      .expect(200);
    expect(session.body.user.name).toBe('First');
  });

  it('sets, reflects, and clears a per-house display name', async () => {
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ben.cookie)
      .send({ displayName: 'Benny' })
      .expect(200)
      .expect(({ body }) => expect(body.displayName).toBe('Benny'));

    let benRow = (await snapshotMembers(ana)).find((m) => m.userId === ben.userId);
    expect(benRow).toMatchObject({ name: 'Ben', displayName: 'Benny' });

    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ben.cookie)
      .send({ displayName: null })
      .expect(200)
      .expect(({ body }) => expect(body.displayName).toBeNull());

    benRow = (await snapshotMembers(ana)).find((m) => m.userId === ben.userId);
    expect(benRow?.displayName).toBeNull();
  });

  it('writes member.renamed to the feed once per actual change, not per request', async () => {
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ana.cookie)
      .send({ displayName: 'Ana Banana' })
      .expect(200);
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ana.cookie)
      .send({ displayName: 'Ana Banana' })
      .expect(200);

    const snap = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ana.cookie)
      .expect(200);
    const renames = (snap.body.feed as { type: string; actorId: string }[]).filter(
      (f) => f.type === 'member.renamed' && f.actorId === ana.userId,
    );
    expect(renames).toHaveLength(1);
  });

  it('rejects empty and over-long display names', async () => {
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ana.cookie)
      .send({ displayName: '   ' })
      .expect(400);
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', ana.cookie)
      .send({ displayName: 'x'.repeat(81) })
      .expect(400);
  });

  it('refuses cross-house access: a non-member cannot set a display name', async () => {
    await request(http)
      .patch(`/v1/houses/${houseId}/members/me`)
      .set('Cookie', mallory.cookie)
      .send({ displayName: 'Intruder' })
      .expect(403);
  });
});
