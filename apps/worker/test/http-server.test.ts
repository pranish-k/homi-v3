import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createRequestHandler, type Job } from '../src/http-server';

// A response double that resolves `done` when the handler calls end(),
// so the async job -> respond path can be awaited without real sockets.
function fakeRes() {
  let markDone: () => void;
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });
  const res = {
    statusCode: 0,
    body: '',
    done,
    writeHead(status: number) {
      res.statusCode = status;
      return res;
    },
    end(body?: string) {
      res.body = body ?? '';
      markDone();
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; done: Promise<void> };
}

const req = (method: string, url: string) => ({ method, url }) as IncomingMessage;

const ok: Job = async () => true;
const failed: Job = async () => false;
const crashes: Job = async () => {
  throw new Error('boom');
};

async function invoke(jobs: { tick: Job; prune: Job }, r: IncomingMessage) {
  const res = fakeRes();
  createRequestHandler(jobs)(r, res);
  await res.done;
  return res;
}

describe('worker http handler (HOMI-14)', () => {
  it('answers 200 when tick succeeds', async () => {
    const res = await invoke({ tick: ok, prune: ok }, req('POST', '/tick'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('tick done');
  });

  it('answers 500 when a tick run fails, so Cloud Scheduler sees the failure', async () => {
    const res = await invoke({ tick: failed, prune: ok }, req('POST', '/tick'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('tick failed');
  });

  it('answers 500 when the tick handler itself rejects rather than hanging', async () => {
    const res = await invoke({ tick: crashes, prune: ok }, req('POST', '/tick'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('tick error');
  });

  it('answers 500 when a prune run fails', async () => {
    const res = await invoke({ tick: ok, prune: failed }, req('POST', '/prune'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('prune failed');
  });

  it('serves /healthz as a bare liveness 200', async () => {
    const res = await invoke({ tick: ok, prune: ok }, req('GET', '/healthz'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('rejects non-POST to a job endpoint with 405', async () => {
    const res = await invoke({ tick: ok, prune: ok }, req('GET', '/tick'));
    expect(res.statusCode).toBe(405);
  });

  it('404s an unknown path', async () => {
    const res = await invoke({ tick: ok, prune: ok }, req('POST', '/nope'));
    expect(res.statusCode).toBe(404);
  });
});
