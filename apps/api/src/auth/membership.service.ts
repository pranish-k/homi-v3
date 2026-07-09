import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { DB } from '../db.module';

/**
 * The single active-membership check (H9): HTTP requests go through
 * HouseMemberGuard and WebSocket connects go through RealtimeGateway,
 * but both ask this one question the same way.
 */
@Injectable()
export class MembershipService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async isActiveMember(houseId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ userId: schema.houseMembers.userId })
      .from(schema.houseMembers)
      .where(
        and(
          eq(schema.houseMembers.houseId, houseId),
          eq(schema.houseMembers.userId, userId),
          isNull(schema.houseMembers.leftAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
