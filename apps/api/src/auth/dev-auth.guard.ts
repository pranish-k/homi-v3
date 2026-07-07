import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * Dev-only auth shim (Sprint 1). Replaced by Better Auth in HOMI-2.
 * Identifies the caller from an `x-user-id` UUID header and upserts the
 * user row so downstream FKs resolve. Refuses to run unless
 * DEV_AUTH_ENABLED=true, so it can never leak into a real deployment.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.DEV_AUTH_ENABLED !== 'true') {
      throw new NotImplementedException('Auth is not configured (HOMI-2 pending)');
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.header('x-user-id');
    if (!userId || !UUID_RE.test(userId)) {
      throw new UnauthorizedException('x-user-id header (UUID) required in dev mode');
    }
    const name = req.header('x-user-name') ?? 'Dev User';
    await this.db
      .insert(schema.users)
      .values({ id: userId, name })
      .onConflictDoNothing({ target: schema.users.id });
    req.userId = userId;
    return true;
  }
}
