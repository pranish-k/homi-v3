import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRateLimiter } from './rate-limiter';
import type { AuthedRequest } from '../auth/auth.guard';

export interface RateLimitRule {
  /** bucket name; the authenticated user id is appended */
  bucket: string;
  limit: number;
  windowSec: number;
}

const RATE_LIMIT_RULE = 'rate_limit_rule';

/** Per-user rate limit on an authenticated route. Order guards as (AuthGuard, ..., RateLimitGuard). */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_RULE, rule);

export class TooManyRequestsException extends HttpException {
  constructor(public readonly retryAfterSec: number) {
    super(
      { statusCode: 429, message: 'Too many requests, slow down', retryAfterSec },
      429,
    );
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<RateLimitRule | undefined>(
      RATE_LIMIT_RULE,
      context.getHandler(),
    );
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const decision = await getRateLimiter().consume(
      `${rule.bucket}:${req.userId}`,
      rule.limit,
      rule.windowSec,
    );
    if (!decision.allowed) throw new TooManyRequestsException(decision.retryAfterSec);
    return true;
  }
}
