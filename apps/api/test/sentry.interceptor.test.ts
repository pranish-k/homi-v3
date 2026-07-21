import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { SentryInterceptor } from '../src/observability/sentry.interceptor';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

const ctx = {} as ExecutionContext;
const throwing = (err: unknown): CallHandler => ({ handle: () => throwError(() => err) });
const succeeding = (): CallHandler => ({ handle: () => of('ok') });

describe('SentryInterceptor (HOMI-15a)', () => {
  const captured = vi.mocked(Sentry.captureException);
  afterEach(() => captured.mockClear());

  it('reports a 5xx server error, rethrowing it unchanged', async () => {
    const err = new InternalServerErrorException('boom');
    await expect(lastValueFrom(new SentryInterceptor().intercept(ctx, throwing(err)))).rejects.toBe(
      err,
    );
    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledWith(err);
  });

  it('reports a non-HTTP throwable as an unexpected fault', async () => {
    const err = new Error('kaboom');
    await expect(lastValueFrom(new SentryInterceptor().intercept(ctx, throwing(err)))).rejects.toBe(
      err,
    );
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('does NOT report a 4xx client error', async () => {
    const err = new BadRequestException('bad input');
    await expect(lastValueFrom(new SentryInterceptor().intercept(ctx, throwing(err)))).rejects.toBe(
      err,
    );
    expect(captured).not.toHaveBeenCalled();
  });

  it('does not report on a successful response', async () => {
    await expect(
      lastValueFrom(new SentryInterceptor().intercept(ctx, succeeding())),
    ).resolves.toBe('ok');
    expect(captured).not.toHaveBeenCalled();
  });
});
