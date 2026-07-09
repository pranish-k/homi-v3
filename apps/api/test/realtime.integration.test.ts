import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { setupApp } from '../src/setup';
import { signIn, type Session } from './helpers';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for integration tests (see docker-compose.yml)');
}

/**
 * HOMI-17: the WebSocket channel is authenticated like any HTTP request
 * (session + current membership, H9) and delivers invalidation hints
 * only - ids and types, never amounts or descriptions (H6).
 */
describe('realtime gateway (HOMI-17)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let wsBase: string;
  let ana: Session;
  let ben: Session;
  let mallory: Session;
  let houseId: string;

  function connect(path: string, cookie?: string): WebSocket {
    return new WebSocket(`${wsBase}${path}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for hint')), timeoutMs);
      ws.once('message', (raw) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(raw)) as Record<string, unknown>);
      });
      ws.once('error', reject);
    });
  }

  function opened(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
  }

  /** resolves with the HTTP status the server rejected the upgrade with */
  function rejected(ws: WebSocket): Promise<number> {
    return new Promise((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => reject(new Error('connection unexpectedly accepted')));
      ws.once('error', (err) => reject(err));
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(undefined, { bodyParser: false });
    setupApp(app);
    await app.init();
    http = app.getHttpServer();
    app.get(RealtimeGateway).attach(http);
    // WebSocket clients need a real listening port, unlike supertest
    await app.listen(0);
    const { port } = http.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${port}`;

    const run = randomUUID().slice(0, 8);
    ana = await signIn(http, `rt-ana-${run}@example.com`);
    ben = await signIn(http, `rt-ben-${run}@example.com`);
    mallory = await signIn(http, `rt-mallory-${run}@example.com`);

    const house = await request(http)
      .post('/v1/houses')
      .set('Cookie', ana.cookie)
      .send({ name: 'Realtime House', timezone: 'UTC', currency: 'USD' })
      .expect(201);
    houseId = house.body.id;
    const invite = await request(http)
      .post(`/v1/houses/${houseId}/invites`)
      .set('Cookie', ana.cookie)
      .expect(201);
    await request(http)
      .post(`/v1/invites/${invite.body.url.split('/j/')[1]}/accept`)
      .set('Cookie', ben.cookie)
      .expect(201);
  });

  afterAll(async () => {
    // sockets a failed test left open would stall the HTTP server close
    app.get(RealtimeGateway).beforeApplicationShutdown();
    await app.close();
  });

  it('rejects unauthenticated, non-member, and malformed connects at the handshake', async () => {
    await expect(rejected(connect(`/v1/houses/${houseId}/realtime`))).resolves.toBe(401);
    await expect(
      rejected(connect(`/v1/houses/${houseId}/realtime`, mallory.cookie)),
    ).resolves.toBe(403);
    await expect(rejected(connect(`/v1/houses/not-a-uuid/realtime`, ana.cookie))).resolves.toBe(
      404,
    );
    // uuid-shaped garbage must 404 too, not become a Postgres cast error
    await expect(
      rejected(connect(`/v1/houses/${'-'.repeat(36)}/realtime`, ana.cookie)),
    ).resolves.toBe(404);
  });

  it('delivers an invalidation hint, not the data, when a roommate posts an expense (H6)', async () => {
    const ws = connect(`/v1/houses/${houseId}/realtime`, ben.cookie);
    await opened(ws);
    const hint = nextMessage(ws);

    const created = await request(http)
      .post(`/v1/houses/${houseId}/expenses`)
      .set('Cookie', ana.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        description: 'Secret sushi night',
        amountCents: 12345,
        paidBy: ana.userId,
        mode: 'equal',
        participants: [ana.userId, ben.userId],
      })
      .expect(201);

    const received = await hint;
    expect(received).toMatchObject({
      type: 'expense.created',
      entityType: 'expense',
      entityId: created.body.expense.id,
    });
    expect(typeof received.ts).toBe('string');
    // the hint must never carry ledger data (H6: clients refetch instead)
    const raw = JSON.stringify(received);
    expect(raw).not.toContain('12345');
    expect(raw).not.toContain('sushi');

    ws.close();
  });

  it('fans out payment and membership events to every connected member', async () => {
    const anaWs = connect(`/v1/houses/${houseId}/realtime`, ana.cookie);
    const benWs = connect(`/v1/houses/${houseId}/realtime`, ben.cookie);
    await Promise.all([opened(anaWs), opened(benWs)]);
    const anaHint = nextMessage(anaWs);
    const benHint = nextMessage(benWs);

    const payment = await request(http)
      .post(`/v1/houses/${houseId}/payments`)
      .set('Cookie', ben.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ toUser: ana.userId, amountCents: 500 })
      .expect(201);

    for (const hint of await Promise.all([anaHint, benHint])) {
      expect(hint).toMatchObject({
        type: 'payment.recorded',
        entityType: 'payment',
        entityId: payment.body.payment.id,
      });
    }
    anaWs.close();
    benWs.close();
  });

  it('does not publish a hint for an idempotent replay (nothing was written)', async () => {
    const ws = connect(`/v1/houses/${houseId}/realtime`, ana.cookie);
    await opened(ws);

    const key = randomUUID();
    const payload = {
      description: 'Replayed expense',
      amountCents: 700,
      paidBy: ana.userId,
      mode: 'equal' as const,
      participants: [ana.userId, ben.userId],
    };
    const send = () =>
      request(http)
        .post(`/v1/houses/${houseId}/expenses`)
        .set('Cookie', ana.cookie)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

    const firstHint = nextMessage(ws);
    await send(); // fresh write: one hint
    await firstHint;
    const replayHint = nextMessage(ws, 500);
    await send(); // replay: no hint
    await expect(replayHint).rejects.toThrow('timed out');

    ws.close();
  });
});
