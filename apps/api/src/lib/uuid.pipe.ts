import {
  BadRequestException,
  createParamDecorator,
  Injectable,
  type ArgumentMetadata,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';
import type { Request } from 'express';
import { UUID_RE } from './validation';

/**
 * Sprint 4 retro action: the boundary layer owns id-shape validation.
 * A malformed id in a route param must 400 here and can never reach
 * Postgres as a uuid cast error 500 - the class the WS path, the entity
 * routes, and HouseMemberGuard each had to fix once. Every UUID route
 * param goes through this pipe; only houseId is additionally checked in
 * HouseMemberGuard, because guards run before pipes and a garbage
 * houseId must not even reach the membership query.
 */
@Injectable()
export class UuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestException(`${metadata.data ?? 'parameter'} must be a UUID`);
    }
    return value;
  }
}

/**
 * Every money mutation requires an Idempotency-Key header (H1); the
 * shape check lives here once instead of at the top of each handler.
 * (@Headers takes no pipes, so this is a param decorator, not a pipe.)
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const key = ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'];
  if (typeof key !== 'string' || !UUID_RE.test(key)) {
    throw new BadRequestException('Idempotency-Key header (UUID) is required on money mutations');
  }
  return key;
});
