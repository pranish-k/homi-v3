import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { TooManyRequestsException } from './rate-limit.guard';

/** 429s carry Retry-After so well-behaved clients can back off exactly. */
@Catch(TooManyRequestsException)
export class RateLimitFilter implements ExceptionFilter {
  catch(exception: TooManyRequestsException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .set('Retry-After', String(exception.retryAfterSec))
      .status(429)
      .json(exception.getResponse());
  }
}
