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

/** HOMI-9: placeholder roommates and the atomic history claim (H11). */
describe('placeholder roommates (HOMI-9)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let pool: Pool;
  let ana: Session; // admin
  let ben: Session; // member
  let houseId: string;
  let samPlaceholderId: string; // claimed by sam mid-suite

  const createPlaceholder = async (name: string, session: Session = ana) => {
    const res = await request(http)
      .post(`/v1/houses/${houseId}/members/placeholders`)
      .set('Cookie', session.cookie)
      .send({ name });
    return res;
  };

  const createClaimInvite = async (placeholderId: string) => {
    const res = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .send({ placeholderId })
      .expect(201);
    return res.body.url.split('/j/')[1] as string;
  };

  const logExpense = (input: Record<string, unknown>) =>
    request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send(input);

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

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Cedar St', timezone: 'America/New_York', currency: 'USD' })
      .expect(201);
    houseId = house.body.id;
    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    const token = invite.body.url.split('/j/')[1];
    await request(http).post(`/v1/invites/${token}/accept`).set('Cookie', ben.cookie).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin adds a placeholder; it shows up as a member surface-wide', async () => {
    const res = await createPlaceholder('Sam');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Sam', isPlaceholder: true });
    samPlaceholderId = res.body.userId;

    await createPlaceholder('Eve', ben).then((r) => expect(r.status).toBe(403));

    const snapshot = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', ana.cookie)
      .expect(200);
    const sam = snapshot.body.members.find(
      (m: { userId: string }) => m.userId === samPlaceholderId,
    );
    expect(sam).toMatchObject({ name: 'Sam', isPlaceholder: true });
  });

  it('logs expenses against the placeholder; the placeholder owes but can never act', async () => {
    await logExpense({
      description: 'Groceries',
      amountCents: 9000,
      paidBy: ana.userId,
      mode: 'equal',
      participants: [ana.userId, ben.userId, samPlaceholderId],
    }).expect(201);

    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(balances.body.pairwise).toContainEqual({
      from: samPlaceholderId,
      to: ana.userId,
      amountCents: 3000,
    });

    // a placeholder never pays, receives, or owns money flows
    await logExpense({
      description: 'Paid by ghost',
      amountCents: 1000,
      paidBy: samPlaceholderId,
      mode: 'equal',
      participants: [ana.userId, samPlaceholderId],
    }).expect(400);
    await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: samPlaceholderId, amountCents: 500 })
      .expect(400);
    await request(http)
      .post(`/v1/houses/${houseId}/bills`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Ghost rent',
        amountCents: 1000,
        splitMode: 'equal',
        cadence: 'monthly',
        cadenceDay: '1',
        ownerId: samPlaceholderId,
      })
      .expect(400);
  });

  it('rejects binding an invite to anything but an unclaimed placeholder of this house', async () => {
    await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .send({ placeholderId: ben.userId })
      .expect(400);
    await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .send({ placeholderId: randomUUID() })
      .expect(400);
  });

  it('claims the placeholder atomically: history, room, and membership hand over (H11)', async () => {
    // sam's placeholder occupies a room so the claim can inherit it
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 5000, userIds: [ana.userId, ben.userId] },
          { name: 'Back room', weightBp: 5000, userIds: [samPlaceholderId] },
        ],
      })
      .expect(200);

    const token = await createClaimInvite(samPlaceholderId);
    const run = randomUUID().slice(0, 8);
    const sam = await signIn(http, `sam-${run}@example.com`, 'Sam Real');

    const accept = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', sam.cookie)
      .expect(201);
    expect(accept.body).toEqual({
      houseId,
      alreadyMember: false,
      claimedPlaceholderId: samPlaceholderId,
    });

    // the debt now belongs to sam; the placeholder is gone from balances
    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(balances.body.pairwise).toContainEqual({
      from: sam.userId,
      to: ana.userId,
      amountCents: 3000,
    });
    expect(
      balances.body.pairwise.some(
        (p: { from: string; to: string }) =>
          p.from === samPlaceholderId || p.to === samPlaceholderId,
      ),
    ).toBe(false);

    // membership handed over: sam active with the inherited room, placeholder deactivated
    const snapshot = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', sam.cookie)
      .expect(200);
    const memberIds = snapshot.body.members.map((m: { userId: string }) => m.userId);
    expect(memberIds).toContain(sam.userId);
    expect(memberIds).not.toContain(samPlaceholderId);
    const rooms = await request(http)
      .get(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', sam.cookie)
      .expect(200);
    expect(rooms.body).toContainEqual(
      expect.objectContaining({ name: 'Back room', userIds: [sam.userId] }),
    );

    // the claim is audited and the orphaned users row soft-deletes
    const { rows: memberRows } = await pool.query(
      'SELECT claimed_by, left_at FROM house_members WHERE house_id = $1 AND user_id = $2',
      [houseId, samPlaceholderId],
    );
    expect(memberRows[0].claimed_by).toBe(sam.userId);
    expect(memberRows[0].left_at).not.toBeNull();
    const { rows: userRows } = await pool.query('SELECT deleted_at FROM users WHERE id = $1', [
      samPlaceholderId,
    ]);
    expect(userRows[0].deleted_at).not.toBeNull();

    // a claimed placeholder cannot be bound or claimed again
    await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .send({ placeholderId: samPlaceholderId })
      .expect(400);
    const stale = await signIn(http, `late-${run}@example.com`);
    await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', stale.cookie)
      .expect(400);
  });

  it('merges the placeholder share into an existing split when the claimer already holds one', async () => {
    const eve = await createPlaceholder('Eve').then((r) => r.body.userId as string);
    await logExpense({
      description: 'Utilities',
      amountCents: 3000,
      paidBy: ana.userId,
      mode: 'equal',
      participants: [ana.userId, ben.userId, eve],
    }).expect(201);

    // ben (already an active member, already holding a 1000 split in the
    // same expense) claims eve: the shares fold together, and the accept
    // reports alreadyMember without double-joining (H11: two links)
    const token = await createClaimInvite(eve);
    const accept = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);
    expect(accept.body).toEqual({ houseId, alreadyMember: true, claimedPlaceholderId: eve });

    const { rows } = await pool.query(
      `SELECT es.amount_cents FROM expense_splits es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.description = 'Utilities' AND es.user_id = $1`,
      [ben.userId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_cents)).toBe(2000);
    const { rows: ghost } = await pool.query(
      'SELECT 1 FROM expense_splits WHERE user_id = $1',
      [eve],
    );
    expect(ghost).toHaveLength(0);

    // the fold visibly changed ben's split, so it audits like an edit
    // (HOMI-12, review fix): prior state snapshots and the feed hears
    const { rows: revisions } = await pool.query(
      `SELECT er.previous FROM expense_revisions er
       JOIN expenses e ON e.id = er.expense_id
       WHERE e.description = 'Utilities' AND er.changed_by = $1`,
      [ben.userId],
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0].previous.splits[ben.userId]).toBe(1000);
    expect(revisions[0].previous.splits[eve]).toBe(1000);
    const { rows: events } = await pool.query(
      `SELECT 1 FROM activity_events ae
       JOIN expenses e ON e.id = ae.entity_id
       WHERE e.description = 'Utilities' AND ae.type = 'expense.edited' AND ae.actor_id = $1`,
      [ben.userId],
    );
    expect(events).toHaveLength(1);
  });

  it('hands the placeholder room to a claimer who was already an active member (review fix)', async () => {
    // dana joined via a plain link and has no room; the fay placeholder
    // occupies one. Claiming must not leave that room occupant-less.
    const run = randomUUID().slice(0, 8);
    const dana = await signIn(http, `dana-${run}@example.com`, 'Dana');
    const plain = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    const plainToken = plain.body.url.split('/j/')[1];
    await request(http)
      .post(`/v1/invites/${plainToken}/accept`)
      .set('Cookie', dana.cookie)
      .expect(201);

    const fay = await createPlaceholder('Fay').then((r) => r.body.userId as string);
    await request(http)
      .put(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .send({
        rooms: [
          { name: 'Master', weightBp: 6000, userIds: [ana.userId, ben.userId] },
          { name: 'Fay room', weightBp: 4000, userIds: [fay] },
        ],
      })
      .expect(200);

    const token = await createClaimInvite(fay);
    const accept = await request(http)
      .post(`/v1/invites/${token}/accept`)
      .set('Cookie', dana.cookie)
      .expect(201);
    expect(accept.body).toEqual({ houseId, alreadyMember: true, claimedPlaceholderId: fay });

    const rooms = await request(http)
      .get(`/v1/houses/${houseId}/rooms`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(rooms.body).toContainEqual(
      expect.objectContaining({ name: 'Fay room', userIds: [dana.userId] }),
    );
  });

  it('lets exactly one of two racing claimers win (H11)', async () => {
    const ghost = await createPlaceholder('Ghost').then((r) => r.body.userId as string);
    await logExpense({
      description: 'Race groceries',
      amountCents: 4000,
      paidBy: ana.userId,
      mode: 'equal',
      participants: [ana.userId, ghost],
    }).expect(201);

    const run = randomUUID().slice(0, 8);
    const racerA = await signIn(http, `racer-a-${run}@example.com`);
    const racerB = await signIn(http, `racer-b-${run}@example.com`);
    const tokenA = await createClaimInvite(ghost);
    const tokenB = await createClaimInvite(ghost);

    const [resA, resB] = await Promise.all([
      request(http).post(`/v1/invites/${tokenA}/accept`).set('Cookie', racerA.cookie),
      request(http).post(`/v1/invites/${tokenB}/accept`).set('Cookie', racerB.cookie),
    ]);
    expect([resA.status, resB.status].sort()).toEqual([201, 400]);
    const winner = resA.status === 201 ? racerA : racerB;

    const { rows } = await pool.query(
      'SELECT claimed_by FROM house_members WHERE house_id = $1 AND user_id = $2',
      [houseId, ghost],
    );
    expect(rows[0].claimed_by).toBe(winner.userId);
    const balances = await request(http)
      .get(`/v1/houses/${houseId}/balances`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(balances.body.pairwise).toContainEqual({
      from: winner.userId,
      to: ana.userId,
      amountCents: 2000,
    });
  });
});
