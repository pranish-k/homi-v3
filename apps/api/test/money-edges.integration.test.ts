import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db.module';
import { setupApp } from '../src/setup';
import { signIn, type Session } from './helpers';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

interface Pair {
  from: string;
  to: string;
  amountCents: number;
}
interface Balances {
  net: Record<string, number>;
  pairwise: Pair[];
}

/**
 * Sprint 8 "untested by anyone" money edges, proven at the API level:
 * idempotent replays (sequential and racing) for expenses AND payments,
 * odd-cent equal splits and where the remainder lands, float-trap
 * amounts through the HOME snapshot, partial/full/over settlement, and
 * per-viewer sign symmetry in a 3-member house. ledger.integration
 * already covers the basic expense replay/race/409 and one exact-split
 * mismatch; this file covers what it does not.
 *
 * Every scenario gets its own fresh house, so balances are exact
 * figures, not deltas against whatever an earlier test left behind.
 */
describe('Sprint 8 money edge cases', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    // Listen once: handed an unbound server, supertest listen()s and close()s
    // that SAME server per request, so parallel requests (Promise.all races)
    // intermittently die with ECONNRESET when a sibling closes it.
    await app.listen(0);
    http = app.getHttpServer();
    pool = app.get<Pool>(PG_POOL);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * A fresh USD house with fresh people, joined through one real invite
   * link. Fresh people per house keep every scenario under the per-user
   * invite rate limits (20/h). `cam` always exists; with size 2 he is an
   * outsider. `extras` are additional joined members.
   */
  async function newHouse(size: 2 | 3 = 3, extraCount = 0) {
    const run = randomUUID().slice(0, 8);
    const [ana, ben, cam, ...extras] = await Promise.all(
      ['ana', 'ben', 'cam', ...Array.from({ length: extraCount }, (_, i) => `x${i}`)].map((n) =>
        signIn(http, `edge-${n}-${run}@example.com`),
      ),
    );
    if (!ana || !ben || !cam) throw new Error('sign-in failed');
    const res = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: `Edge ${run}`, timezone: 'UTC', currency: 'USD' })
      .expect(201);
    const houseId: string = res.body.id;
    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    const token = invite.body.url.split('/j/')[1];
    const joiners: Session[] = [ben, ...(size === 3 ? [cam] : []), ...extras];
    // sequential: joinedAt order is part of the house, keep it deterministic
    for (const member of joiners) {
      await request(http)
        .post(`/v1/invites/${token}/accept`)
        .set('Cookie', member.cookie)
        .expect(201);
    }
    return { houseId, ana, ben, cam, extras };
  }

  const postExpense = (houseId: string, as: Session, body: object, key: string = randomUUID()) =>
    request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', as.cookie)
      .set('Idempotency-Key', key)
      .send(body);

  const postPayment = (houseId: string, as: Session, body: object, key: string = randomUUID()) =>
    request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', as.cookie)
      .set('Idempotency-Key', key)
      .send(body);

  async function snapshot(houseId: string, as: Session) {
    const res = await request(http)
      .get(`/v1/houses/${houseId}/snapshot`)
      .set('Cookie', as.cookie)
      .expect(200);
    return res.body as { balances: Balances; actionItems: { type: string }[] };
  }

  /**
   * The balance shape is internally consistent: money is conserved
   * (nets sum to 0), every pair appears once with a positive amount,
   * and each member's net is exactly what their pairs say.
   */
  function expectConsistent(b: Balances) {
    const nets = Object.values(b.net);
    expect(nets.every(Number.isSafeInteger)).toBe(true);
    expect(nets.reduce((s, n) => s + n, 0)).toBe(0);

    const seen = new Set<string>();
    const fromPairs: Record<string, number> = {};
    for (const p of b.pairwise) {
      expect(Number.isSafeInteger(p.amountCents)).toBe(true);
      expect(p.amountCents).toBeGreaterThan(0);
      expect(p.from).not.toBe(p.to);
      const key = [p.from, p.to].sort().join('|');
      expect(seen.has(key)).toBe(false); // one direction per pair, already netted
      seen.add(key);
      fromPairs[p.from] = (fromPairs[p.from] ?? 0) - p.amountCents;
      fromPairs[p.to] = (fromPairs[p.to] ?? 0) + p.amountCents;
    }
    expect(b.net).toEqual(fromPairs);
  }

  /** Signed amount `viewer` sees against `other`: + they owe me, - I owe them, 0 settled. */
  function seenBy(b: Balances, viewer: string, other: string): number {
    const owedToMe = b.pairwise.find((p) => p.from === other && p.to === viewer);
    if (owedToMe) return owedToMe.amountCents;
    const iOwe = b.pairwise.find((p) => p.from === viewer && p.to === other);
    return iOwe ? -iOwe.amountCents : 0;
  }

  async function storedSplits(expenseId: string): Promise<Record<string, number>> {
    const rows = await pool.query<{ user_id: string; amount_cents: string | number }>(
      'SELECT user_id, amount_cents FROM expense_splits WHERE expense_id = $1',
      [expenseId],
    );
    return Object.fromEntries(rows.rows.map((r) => [r.user_id, Number(r.amount_cents)]));
  }

  describe('idempotency (H1)', () => {
    it('expense: concurrent duplicates return byte-identical bodies and write one expense, one split set, one feed event', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const key = randomUUID();
      const body = {
        description: 'Double tap groceries',
        amountCents: 4400,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => postExpense(houseId, ana, body, key)),
      );
      for (const r of results) expect(r.status).toBe(201);
      for (const r of results.slice(1)) expect(r.body).toEqual(results[0]!.body);

      const expenseId = results[0]!.body.expense.id;
      const counts = await pool.query(
        `SELECT
          (SELECT count(*)::int FROM expenses WHERE house_id = $1) AS expenses,
          (SELECT count(*)::int FROM expense_splits WHERE expense_id = $2) AS splits,
          (SELECT count(*)::int FROM activity_events WHERE house_id = $1 AND type = 'expense.created') AS events`,
        [houseId, expenseId],
      );
      expect(counts.rows[0]).toEqual({ expenses: 1, splits: 2, events: 1 });

      // a later sequential retry replays the same body too
      const retry = await postExpense(houseId, ana, body, key).expect(201);
      expect(retry.body).toEqual(results[0]!.body);

      // and the money moved exactly once
      const snap = await snapshot(houseId, ben);
      expect(snap.balances.pairwise).toEqual([{ from: ben.userId, to: ana.userId, amountCents: 2200 }]);
    });

    it('expense: a racing same-key request with a DIFFERENT body gets 409, never a second expense', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const key = randomUUID();
      const base = {
        description: 'Race A',
        amountCents: 1000,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      };
      const results = await Promise.all([
        postExpense(houseId, ana, base, key),
        postExpense(houseId, ana, { ...base, amountCents: 1001 }, key),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const count = await pool.query(
        'SELECT count(*)::int AS n FROM expenses WHERE house_id = $1',
        [houseId],
      );
      expect(count.rows[0].n).toBe(1);
    });

    it('expense: the body hash is key-order independent, so a re-serialised retry replays instead of 409', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const key = randomUUID();
      const first = await postExpense(
        houseId,
        ana,
        {
          description: 'Order test',
          amountCents: 999,
          paidBy: ana.userId,
          mode: 'equal',
          participants: [ana.userId, ben.userId],
        },
        key,
      ).expect(201);
      const reordered = await postExpense(
        houseId,
        ana,
        {
          participants: [ana.userId, ben.userId],
          mode: 'equal',
          paidBy: ana.userId,
          amountCents: 999,
          description: 'Order test',
        },
        key,
      ).expect(201);
      expect(reordered.body).toEqual(first.body);
    });

    it('expense: the same key is scoped per endpoint - reusing it for a payment executes the payment', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const key = randomUUID();
      await postExpense(
        houseId,
        ben,
        {
          description: 'Shared key',
          amountCents: 2000,
          paidBy: ben.userId,
          mode: 'equal',
          participants: [ana.userId, ben.userId],
        },
        key,
      ).expect(201);
      const pay = await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 500 }, key).expect(
        201,
      );
      expect(pay.body.payment.amountCents).toBe(500);
    });

    it('payment: a sequential retry replays the identical response and records once', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      await postExpense(houseId, ana, {
        description: 'Setup debt',
        amountCents: 6000,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      }).expect(201);

      const key = randomUUID();
      const body = { toUser: ana.userId, amountCents: 1000, method: 'venmo' };
      const first = await postPayment(houseId, ben, body, key).expect(201);
      const retry = await postPayment(houseId, ben, body, key).expect(201);
      expect(retry.body).toEqual(first.body);

      const count = await pool.query(
        'SELECT count(*)::int AS n FROM payments WHERE house_id = $1',
        [houseId],
      );
      expect(count.rows[0].n).toBe(1);
      const snap = await snapshot(houseId, ben);
      expect(snap.balances.pairwise).toEqual([{ from: ben.userId, to: ana.userId, amountCents: 2000 }]);
    });

    it('payment: concurrent duplicates (double-tap on Settle up) record exactly one payment with consistent bodies', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      await postExpense(houseId, ana, {
        description: 'Setup debt',
        amountCents: 6000,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      }).expect(201);

      const key = randomUUID();
      const body = { toUser: ana.userId, amountCents: 3000, method: 'zelle' };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => postPayment(houseId, ben, body, key)),
      );
      for (const r of results) expect(r.status).toBe(201);
      for (const r of results.slice(1)) expect(r.body).toEqual(results[0]!.body);

      const counts = await pool.query(
        `SELECT
          (SELECT count(*)::int FROM payments WHERE house_id = $1) AS payments,
          (SELECT count(*)::int FROM activity_events WHERE house_id = $1 AND type = 'payment.recorded') AS events`,
        [houseId],
      );
      expect(counts.rows[0]).toEqual({ payments: 1, events: 1 });

      // a double-tap must not overpay: the 3000 debt is settled, not flipped
      const snap = await snapshot(houseId, ben);
      expect(snap.balances.pairwise).toEqual([]);
      expect(snap.actionItems.filter((a) => a.type === 'settle_up')).toEqual([]);
    });

    it('payment: the same key with a different body is a 409 and records nothing new (sequential and racing)', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const key = randomUUID();
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 1000 }, key).expect(201);
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 1500 }, key).expect(409);
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 1000, method: 'cash' }, key).expect(
        409,
      );

      const raceKey = randomUUID();
      const race = await Promise.all([
        postPayment(houseId, ben, { toUser: ana.userId, amountCents: 700 }, raceKey),
        postPayment(houseId, ben, { toUser: ana.userId, amountCents: 701 }, raceKey),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);

      const count = await pool.query(
        'SELECT count(*)::int AS n FROM payments WHERE house_id = $1',
        [houseId],
      );
      expect(count.rows[0].n).toBe(2);
    });

    it('payment: a missing or malformed Idempotency-Key is rejected before anything is written', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      await request(http)
        .post(`/v1/houses/${houseId}/payments`)
        .set('Cookie', ben.cookie)
        .send({ toUser: ana.userId, amountCents: 100 })
        .expect(400);
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 100 }, 'not-a-uuid').expect(400);
      const count = await pool.query(
        'SELECT count(*)::int AS n FROM payments WHERE house_id = $1',
        [houseId],
      );
      expect(count.rows[0].n).toBe(0);
    });
  });

  describe('odd-cent equal splits (H3)', () => {
    const cases: {
      name: string;
      amountCents: number;
      payer: 'ana' | 'cam';
      participantCount: 2 | 3;
    }[] = [
      { name: '$10.00 over 3', amountCents: 1000, payer: 'ana', participantCount: 3 },
      { name: '$0.01 over 2', amountCents: 1, payer: 'ana', participantCount: 2 },
      { name: '$100.01 over 2, payer not a participant', amountCents: 10001, payer: 'cam', participantCount: 2 },
      { name: '$0.02 over 3', amountCents: 2, payer: 'ana', participantCount: 3 },
    ];

    for (const c of cases) {
      it(`${c.name}: shares sum exactly, the remainder lands deterministically, balances agree`, async () => {
        const { houseId, ana, ben, cam } = await newHouse(3);
        const payer = c.payer === 'ana' ? ana : cam;
        const participants =
          c.participantCount === 3 ? [ana.userId, ben.userId, cam.userId] : [ana.userId, ben.userId];
        const res = await postExpense(houseId, payer, {
          description: c.name,
          amountCents: c.amountCents,
          paidBy: payer.userId,
          mode: 'equal',
          participants,
        }).expect(201);

        const splits: Record<string, number> = res.body.splits;
        expect(Object.keys(splits).sort()).toEqual([...participants].sort());
        expect(Object.values(splits).reduce((a, b) => a + b, 0)).toBe(c.amountCents);
        expect(await storedSplits(res.body.expense.id)).toEqual(splits);

        // remainder rule: the payer if they participate, else the first sorted participant
        const base = Math.floor(c.amountCents / participants.length);
        const remainder = c.amountCents - base * participants.length;
        const recipient = participants.includes(payer.userId)
          ? payer.userId
          : [...participants].sort()[0]!;
        for (const id of participants) {
          expect(splits[id]).toBe(id === recipient ? base + remainder : base);
        }

        const snap = await snapshot(houseId, ana);
        expectConsistent(snap.balances);
        // each non-payer participant owes the payer exactly their share
        for (const id of participants) {
          if (id === payer.userId) continue;
          const owed = splits[id]!;
          const pair = snap.balances.pairwise.find((p) => p.from === id && p.to === payer.userId);
          if (owed === 0) expect(pair).toBeUndefined();
          else expect(pair?.amountCents).toBe(owed);
        }
        expect(snap.balances.net[payer.userId] ?? 0).toBe(
          c.amountCents - (splits[payer.userId] ?? 0),
        );
      });
    }

    it('$100.00 over 7: six shares of 1428 and the payer absorbs the 4-cent remainder', async () => {
      const { houseId, ana, ben, cam, extras } = await newHouse(3, 4);
      const everyone = [ana, ben, cam, ...extras].map((s) => s.userId);

      const res = await postExpense(houseId, ben, {
        description: 'Party supplies',
        amountCents: 10000,
        paidBy: ben.userId,
        mode: 'equal',
        participants: everyone,
      }).expect(201);
      const splits: Record<string, number> = res.body.splits;
      expect(Object.values(splits).reduce((a, b) => a + b, 0)).toBe(10000);
      for (const id of everyone) expect(splits[id]).toBe(id === ben.userId ? 1432 : 1428);

      const snap = await snapshot(houseId, cam);
      expectConsistent(snap.balances);
      expect(snap.balances.net[ben.userId]).toBe(10000 - 1432);
      expect(snap.balances.pairwise).toHaveLength(6);
      for (const p of snap.balances.pairwise) {
        expect(p).toMatchObject({ to: ben.userId, amountCents: 1428 });
      }

      // and the same request lands the same way every time (client previews must agree)
      const again = await postExpense(houseId, ben, {
        description: 'Party supplies, again',
        amountCents: 10000,
        paidBy: ben.userId,
        mode: 'equal',
        participants: [...everyone].reverse(),
      }).expect(201);
      expect(again.body.splits).toEqual(splits);
    });

    it('$0.01 among 3 where the payer is NOT a participant: the cent lands on the first sorted id', async () => {
      const { houseId, ana, ben, cam } = await newHouse(3);
      const participants = [ben.userId, cam.userId];
      const res = await postExpense(houseId, ana, {
        description: 'One cent',
        amountCents: 1,
        paidBy: ana.userId,
        mode: 'equal',
        participants,
      }).expect(201);
      const first = [...participants].sort()[0]!;
      const second = [...participants].sort()[1]!;
      expect(res.body.splits).toEqual({ [first]: 1, [second]: 0 });

      const snap = await snapshot(houseId, ana);
      expectConsistent(snap.balances);
      expect(snap.balances.pairwise).toEqual([{ from: first, to: ana.userId, amountCents: 1 }]);
    });
  });

  describe('float-trap amounts (H3)', () => {
    it('$19.99 equal over 2 and 3, percent 33.33/33.33/33.34, and exact all reach the snapshot as exact cents', async () => {
      const { houseId, ana, ben, cam } = await newHouse(3);

      // 1999 / 2 -> 999 each, ana (payer) absorbs 1 -> ana 1000, ben 999
      const two = await postExpense(houseId, ana, {
        description: 'Streaming',
        amountCents: 1999,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      }).expect(201);
      expect(two.body.splits).toEqual({ [ana.userId]: 1000, [ben.userId]: 999 });

      // 1999 / 3 -> 666 each, ben (payer) absorbs 1 -> ben 667
      const three = await postExpense(houseId, ben, {
        description: 'Snacks',
        amountCents: 1999,
        paidBy: ben.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId, cam.userId],
      }).expect(201);
      expect(three.body.splits).toEqual({
        [ana.userId]: 666,
        [ben.userId]: 667,
        [cam.userId]: 666,
      });

      // 0.1 + 0.2 territory: $0.30 at 3333/3333/3334 bp -> floor 9, 9, 10 = 28, cam absorbs 2
      const pct = await postExpense(houseId, cam, {
        description: 'Gum',
        amountCents: 30,
        paidBy: cam.userId,
        mode: 'percent',
        participants: [ana.userId, ben.userId, cam.userId],
        weightsBp: { [ana.userId]: 3333, [ben.userId]: 3333, [cam.userId]: 3334 },
      }).expect(201);
      expect(pct.body.splits).toEqual({ [ana.userId]: 9, [ben.userId]: 9, [cam.userId]: 12 });

      const exact = await postExpense(houseId, cam, {
        description: 'Dinner',
        amountCents: 5997, // 3 x 19.99
        paidBy: cam.userId,
        mode: 'exact',
        participants: [ana.userId, ben.userId, cam.userId],
        exactCents: { [ana.userId]: 1999, [ben.userId]: 1999, [cam.userId]: 1999 },
      }).expect(201);
      expect(exact.body.splits).toEqual({
        [ana.userId]: 1999,
        [ben.userId]: 1999,
        [cam.userId]: 1999,
      });

      // hand-netted:
      // ben -> ana: 999 (Streaming) - 666 (Snacks) = 333
      // ana -> cam: 9 (Gum) + 1999 (Dinner) = 2008
      // ben -> cam: 9 + 1999 = 2008; cam -> ben: 666 (Snacks) => ben -> cam 1342
      const snap = await snapshot(houseId, ana);
      expectConsistent(snap.balances);
      const owes = (from: string, to: string) =>
        snap.balances.pairwise.find((p) => p.from === from && p.to === to)?.amountCents;
      expect(owes(ben.userId, ana.userId)).toBe(333);
      expect(owes(ana.userId, cam.userId)).toBe(2008);
      expect(owes(ben.userId, cam.userId)).toBe(1342);
      expect(snap.balances.net).toEqual({
        [ana.userId]: 333 - 2008,
        [ben.userId]: -333 - 1342,
        [cam.userId]: 2008 + 1342,
      });

      // the same figures round-trip through the ledger as integers
      const ledger = await request(http)
        .get(`/v1/houses/${houseId}/ledger`)
        .set('Cookie', ana.cookie)
        .expect(200);
      for (const e of ledger.body.entries) {
        expect(Number.isSafeInteger(e.amountCents)).toBe(true);
        const sum = Object.values(e.splits as Record<string, number>).reduce((a, b) => a + b, 0);
        expect(sum).toBe(e.amountCents);
      }
    });

    it('rejects dollars-as-floats and stringly amounts instead of rounding them', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      const base = {
        description: 'Float trap',
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      };
      for (const amountCents of [19.99, 1999.0000001, 0.1 + 0.2, '1999', 0, -1999]) {
        await postExpense(houseId, ana, { ...base, amountCents }).expect(400);
      }
      for (const amountCents of [19.99, '1999', 0]) {
        await postPayment(houseId, ben, { toUser: ana.userId, amountCents }).expect(400);
      }
      await postExpense(houseId, ana, {
        ...base,
        amountCents: 1999,
        mode: 'exact',
        exactCents: { [ana.userId]: 999.5, [ben.userId]: 999.5 },
      }).expect(400);

      const count = await pool.query(
        `SELECT
          (SELECT count(*)::int FROM expenses WHERE house_id = $1) AS expenses,
          (SELECT count(*)::int FROM payments WHERE house_id = $1) AS payments`,
        [houseId],
      );
      expect(count.rows[0]).toEqual({ expenses: 0, payments: 0 });
    });
  });

  describe('exact-split validation (invariant 2)', () => {
    it('rejects under, over, missing-participant, and negative exact shares; writes nothing', async () => {
      const { houseId, ana, ben, cam } = await newHouse(3);
      const base = {
        description: 'Exact',
        amountCents: 1999,
        paidBy: ana.userId,
        mode: 'exact',
        participants: [ana.userId, ben.userId, cam.userId],
      };
      const bad: Record<string, number>[] = [
        { [ana.userId]: 666, [ben.userId]: 666, [cam.userId]: 666 }, // 1998, a cent short
        { [ana.userId]: 667, [ben.userId]: 667, [cam.userId]: 667 }, // 2001, over
        { [ana.userId]: 1000, [ben.userId]: 999 }, // sums right but cam has no share
        { [ana.userId]: 2000, [ben.userId]: 0, [cam.userId]: -1 }, // sums right, negative
      ];
      for (const exactCents of bad) {
        await postExpense(houseId, ana, { ...base, exactCents }).expect(400);
      }
      await postExpense(houseId, ana, base).expect(400); // exact mode without exactCents

      const count = await pool.query(
        'SELECT count(*)::int AS n FROM expenses WHERE house_id = $1',
        [houseId],
      );
      expect(count.rows[0].n).toBe(0);

      // the honest version posts, including a legitimate zero share
      const ok = await postExpense(houseId, ana, {
        ...base,
        exactCents: { [ana.userId]: 1999, [ben.userId]: 0, [cam.userId]: 0 },
      }).expect(201);
      expect(Object.values(ok.body.splits as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
        1999,
      );
      const snap = await snapshot(houseId, ana);
      expect(snap.balances.pairwise).toEqual([]); // ana paid her own whole share
    });
  });

  describe('settlement (HOMI-11)', () => {
    it('partial, full, and over-payment move the pair exactly; an overpayment flips the direction', async () => {
      const { houseId, ana, ben } = await newHouse(2);
      await postExpense(houseId, ana, {
        description: 'Groceries',
        amountCents: 4400,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      }).expect(201);

      let snap = await snapshot(houseId, ben);
      expect(snap.balances.pairwise).toEqual([{ from: ben.userId, to: ana.userId, amountCents: 2200 }]);

      // partial: $7.33 leaves $14.67
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 733 }).expect(201);
      snap = await snapshot(houseId, ben);
      expectConsistent(snap.balances);
      expect(snap.balances.pairwise).toEqual([{ from: ben.userId, to: ana.userId, amountCents: 1467 }]);
      expect(snap.actionItems).toContainEqual({
        type: 'settle_up',
        toUserId: ana.userId,
        amountCents: 1467,
      });

      // full: the remaining $14.67 settles the pair completely
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 1467 }).expect(201);
      snap = await snapshot(houseId, ben);
      expect(snap.balances).toEqual({ net: {}, pairwise: [] });
      expect(snap.actionItems.filter((a) => a.type === 'settle_up')).toEqual([]);

      // over: the design records the payment as stated (single-sided,
      // no cap - the recipient's recourse is the dispute window), so a
      // $5.00 overpayment means ana now owes ben $5.00
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 500 }).expect(201);
      const anaView = await snapshot(houseId, ana);
      expectConsistent(anaView.balances);
      expect(anaView.balances.pairwise).toEqual([{ from: ana.userId, to: ben.userId, amountCents: 500 }]);
      expect(anaView.actionItems).toContainEqual({
        type: 'settle_up',
        toUserId: ben.userId,
        amountCents: 500,
      });
      const benView = await snapshot(houseId, ben);
      expect(benView.actionItems.filter((a) => a.type === 'settle_up')).toEqual([]);
    });

    it('rejects paying yourself or a non-member', async () => {
      const { houseId, ben, cam } = await newHouse(2);
      await postPayment(houseId, ben, { toUser: ben.userId, amountCents: 100 }).expect(400);
      await postPayment(houseId, ben, { toUser: cam.userId, amountCents: 100 }).expect(400);
    });
  });

  describe('per-viewer perspective in a 3-member house (HOMI-33)', () => {
    it('every viewer reads the same balances; A sees +x from B exactly when B sees -x to A', async () => {
      const { houseId, ana, ben, cam } = await newHouse(3);
      const all = [ana, ben, cam];
      await postExpense(houseId, ana, {
        description: 'Rent share',
        amountCents: 10000,
        paidBy: ana.userId,
        mode: 'equal',
        participants: all.map((s) => s.userId),
      }).expect(201);
      await postExpense(houseId, ben, {
        description: 'Utilities',
        amountCents: 1999,
        paidBy: ben.userId,
        mode: 'equal',
        participants: [ben.userId, cam.userId],
      }).expect(201);
      await postExpense(houseId, cam, {
        description: 'Takeout',
        amountCents: 4501,
        paidBy: cam.userId,
        mode: 'equal',
        participants: [ana.userId, cam.userId],
      }).expect(201);
      await postPayment(houseId, ben, { toUser: ana.userId, amountCents: 1000 }).expect(201);

      const views = new Map<string, Awaited<ReturnType<typeof snapshot>>>();
      for (const s of all) views.set(s.userId, await snapshot(houseId, s));

      // invariant 3: balances are a fact about the house, not the viewer
      const reference = views.get(ana.userId)!.balances;
      expectConsistent(reference);
      for (const v of views.values()) expect(v.balances).toEqual(reference);

      // hand-netted: Rent 3334/3333/3333 (ana absorbs 1), Utilities ben 1000 cam 999,
      // Takeout cam 2251 ana 2250, ben paid ana 1000
      // ben -> ana: 3333 - 1000 = 2333
      // cam -> ana: 3333 - 2250 = 1083
      // cam -> ben: 999
      const expected: Record<string, Record<string, number>> = {
        [ana.userId]: { [ben.userId]: 2333, [cam.userId]: 1083 },
        [ben.userId]: { [ana.userId]: -2333, [cam.userId]: 999 },
        [cam.userId]: { [ana.userId]: -1083, [ben.userId]: -999 },
      };

      for (const viewer of all) {
        const view = views.get(viewer.userId)!;
        let mySum = 0;
        for (const other of all) {
          if (other === viewer) continue;
          const mine = seenBy(view.balances, viewer.userId, other.userId);
          const theirs = seenBy(views.get(other.userId)!.balances, other.userId, viewer.userId);
          expect(mine).toBe(-theirs);
          expect(mine).toBe(expected[viewer.userId]![other.userId]);
          mySum += mine;
        }
        // a viewer's headline net is the sum of their per-person rows
        expect(view.balances.net[viewer.userId] ?? 0).toBe(mySum);

        // settle_up items are exactly the negative rows, per viewer
        const settle = view.actionItems
          .filter((a) => a.type === 'settle_up')
          .map((a) => a as unknown as { toUserId: string; amountCents: number });
        const negatives = all
          .filter((o) => o !== viewer && expected[viewer.userId]![o.userId]! < 0)
          .map((o) => ({ toUserId: o.userId, amountCents: -expected[viewer.userId]![o.userId]! }));
        expect(settle.map(({ toUserId, amountCents }) => ({ toUserId, amountCents }))).toEqual(
          expect.arrayContaining(negatives),
        );
        expect(settle).toHaveLength(negatives.length);
      }
    });
  });
});
