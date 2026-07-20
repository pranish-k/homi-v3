import { ForbiddenException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type DbConn } from '@homi/db';

/**
 * Sprint 5 review carryover: the single active-admin gate. Four
 * services each hand-rolled the same role lookup; a rule change that
 * misses one copy is a privilege bug on a money-adjacent surface, so
 * the question is asked in exactly one place, on whatever connection
 * the mutation already holds.
 */
export async function activeMemberRole(
  conn: DbConn,
  houseId: string,
  userId: string,
): Promise<string | null> {
  const [member] = await conn
    .select({ role: schema.houseMembers.role })
    .from(schema.houseMembers)
    .where(
      and(
        eq(schema.houseMembers.houseId, houseId),
        eq(schema.houseMembers.userId, userId),
        isNull(schema.houseMembers.leftAt),
      ),
    );
  return member?.role ?? null;
}

export async function requireAdmin(
  conn: DbConn,
  houseId: string,
  userId: string,
  action: string,
): Promise<void> {
  if ((await activeMemberRole(conn, houseId, userId)) !== 'admin') {
    throw new ForbiddenException(`Only house admins can ${action}`);
  }
}
