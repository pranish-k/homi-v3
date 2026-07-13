import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { ActivityService } from '../activity/activity.service';
import { DB } from '../db.module';

const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /** HOMI-8: invite links, not codes (spec 4.3). Raw token is returned once; only the hash is stored. */
  async createInvite(houseId: string, actorId: string) {
    const [actor] = await this.db
      .select({ role: schema.houseMembers.role })
      .from(schema.houseMembers)
      .where(
        and(
          eq(schema.houseMembers.houseId, houseId),
          eq(schema.houseMembers.userId, actorId),
          isNull(schema.houseMembers.leftAt),
        ),
      );
    if (actor?.role !== 'admin') {
      throw new ForbiddenException('Only house admins can create invites');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [invite] = await this.db
      .insert(schema.invites)
      .values({ houseId, tokenHash: hashToken(token), createdBy: actorId, expiresAt })
      .returning();
    if (!invite) throw new Error('insert returned no row');
    const origin = process.env.INVITE_LINK_ORIGIN ?? 'https://homi.app';
    return {
      url: `${origin}/j/${token}`,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
    };
  }

  /**
   * Single atomic accept (H11 groundwork): the invite row is locked,
   * validated, membership inserted, and the use consumed in one
   * transaction, so concurrent accepts can never overshoot max_uses.
   */
  async acceptInvite(token: string, userId: string) {
    return this.activity.transact(async (tx, log) => {
      const [invite] = await tx
        .select()
        .from(schema.invites)
        .where(eq(schema.invites.tokenHash, hashToken(token)))
        .for('update');
      if (
        !invite ||
        invite.revokedAt !== null ||
        invite.expiresAt < new Date() ||
        invite.uses >= invite.maxUses
      ) {
        throw new BadRequestException('This invite link is no longer valid');
      }
      const [existing] = await tx
        .select({ leftAt: schema.houseMembers.leftAt })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, invite.houseId),
            eq(schema.houseMembers.userId, userId),
          ),
        );
      if (existing && existing.leftAt === null) {
        return { houseId: invite.houseId, alreadyMember: true };
      }
      if (existing) {
        // returning member (Y4): reactivate with plain member role (an
        // old admin role must not survive removal); ledger history stays
        await tx
          .update(schema.houseMembers)
          .set({ leftAt: null, joinedAt: new Date(), role: 'member' })
          .where(
            and(
              eq(schema.houseMembers.houseId, invite.houseId),
              eq(schema.houseMembers.userId, userId),
            ),
          );
      } else {
        // onConflictDoNothing: a concurrent accept via a different invite
        // may win the insert; losing quietly is the correct outcome
        const inserted = await tx
          .insert(schema.houseMembers)
          .values({ houseId: invite.houseId, userId })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) {
          return { houseId: invite.houseId, alreadyMember: true };
        }
      }
      await tx
        .update(schema.invites)
        .set({ uses: sql`${schema.invites.uses} + 1` })
        .where(eq(schema.invites.id, invite.id));
      await log({
        houseId: invite.houseId,
        actorId: userId,
        type: 'member.joined',
        entityType: 'member',
        entityId: userId,
      });
      return { houseId: invite.houseId, alreadyMember: false };
    });
  }
}
