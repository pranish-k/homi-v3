import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';
import type { AuthedRequest } from './auth.guard';

/**
 * The single authorization layer (spec 5.5): every house-scoped route is
 * checked against CURRENT active membership on EVERY request (H9), never
 * against claims baked into a token.
 */
@Injectable()
export class HouseMemberGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const rawHouseId = req.params.houseId;
    const houseId = typeof rawHouseId === 'string' ? rawHouseId : undefined;
    if (!houseId) throw new ForbiddenException('house scope missing');
    const rows = await this.db
      .select({ userId: schema.houseMembers.userId })
      .from(schema.houseMembers)
      .where(
        and(
          eq(schema.houseMembers.houseId, houseId),
          eq(schema.houseMembers.userId, req.userId),
          isNull(schema.houseMembers.leftAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new ForbiddenException('You are not a member of this house');
    }
    return true;
  }
}
