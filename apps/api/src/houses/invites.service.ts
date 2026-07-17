import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { ActivityService, type Tx } from '../activity/activity.service';
import { DB } from '../db.module';

const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /**
   * HOMI-8: invite links, not codes (spec 4.3). Raw token is returned
   * once; only the hash is stored. HOMI-9: binding a placeholder makes
   * this a claim invite - the framing stays "review and approve your
   * share" (D11): the claimer inherits a transparent, per-line
   * disputable ledger, never a compiled bill.
   */
  async createInvite(houseId: string, actorId: string, placeholderId?: string) {
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
    if (placeholderId !== undefined) {
      const [placeholder] = await this.db
        .select({ claimedBy: schema.houseMembers.claimedBy })
        .from(schema.houseMembers)
        .where(
          and(
            eq(schema.houseMembers.houseId, houseId),
            eq(schema.houseMembers.userId, placeholderId),
            eq(schema.houseMembers.isPlaceholder, true),
            isNull(schema.houseMembers.leftAt),
          ),
        );
      if (!placeholder || placeholder.claimedBy !== null) {
        throw new BadRequestException('placeholderId must be an unclaimed placeholder of this house');
      }
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [invite] = await this.db
      .insert(schema.invites)
      .values({
        houseId,
        tokenHash: hashToken(token),
        createdBy: actorId,
        expiresAt,
        placeholderUserId: placeholderId,
      })
      .returning();
    if (!invite) throw new Error('insert returned no row');
    const origin = process.env.INVITE_LINK_ORIGIN ?? 'https://homi.app';
    return {
      url: `${origin}/j/${token}`,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      placeholderUserId: invite.placeholderUserId,
    };
  }

  /**
   * Single atomic accept (H11): the invite row is locked, validated,
   * membership inserted, the placeholder claimed, and the use consumed
   * in ONE transaction, so concurrent accepts can never overshoot
   * max_uses - and two people can never claim the same placeholder.
   *
   * A person joining via two links stays coherent: a plain accept while
   * already a member is a no-op, but a claim invite still performs the
   * claim, so joining first through a plain link cannot orphan the
   * placeholder history meant for you.
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
      if (existing && existing.leftAt === null && invite.placeholderUserId === null) {
        return { houseId: invite.houseId, alreadyMember: true, claimedPlaceholderId: null };
      }

      // The claim is guarded by a FOR UPDATE lock on the placeholder's
      // membership row: a second claimer blocks here and then fails the
      // unclaimed check; an expense being resolved against the
      // placeholder holds SHARE locks on the same row (@homi/ledger)
      // and therefore commits strictly before or after the whole claim.
      let inheritedRoomId: string | null = null;
      if (invite.placeholderUserId !== null) {
        const [placeholder] = await tx
          .select({
            claimedBy: schema.houseMembers.claimedBy,
            leftAt: schema.houseMembers.leftAt,
            roomId: schema.houseMembers.roomId,
          })
          .from(schema.houseMembers)
          .where(
            and(
              eq(schema.houseMembers.houseId, invite.houseId),
              eq(schema.houseMembers.userId, invite.placeholderUserId),
              eq(schema.houseMembers.isPlaceholder, true),
            ),
          )
          .for('update');
        if (!placeholder || placeholder.claimedBy !== null || placeholder.leftAt !== null) {
          throw new BadRequestException(
            'This placeholder was already claimed; ask your house admin for a fresh invite',
          );
        }
        inheritedRoomId = placeholder.roomId;
      }

      const alreadyMember = existing?.leftAt === null;
      if (!existing) {
        // onConflictDoNothing: a concurrent accept via a different invite
        // may win the insert; losing quietly is the correct outcome
        const inserted = await tx
          .insert(schema.houseMembers)
          .values({ houseId: invite.houseId, userId, roomId: inheritedRoomId })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0 && invite.placeholderUserId === null) {
          return { houseId: invite.houseId, alreadyMember: true, claimedPlaceholderId: null };
        }
      } else if (existing.leftAt !== null) {
        // returning member (Y4): reactivate with plain member role (an
        // old admin role must not survive removal); ledger history stays
        await tx
          .update(schema.houseMembers)
          .set({ leftAt: null, joinedAt: new Date(), role: 'member', roomId: inheritedRoomId })
          .where(
            and(
              eq(schema.houseMembers.houseId, invite.houseId),
              eq(schema.houseMembers.userId, userId),
            ),
          );
      }

      let claimedPlaceholderId: string | null = null;
      if (invite.placeholderUserId !== null) {
        claimedPlaceholderId = invite.placeholderUserId;
        await this.claimHistory(tx, invite.houseId, invite.placeholderUserId, userId);
        await log({
          houseId: invite.houseId,
          actorId: userId,
          type: 'member.claimed',
          entityType: 'member',
          entityId: userId,
          payload: { placeholderUserId: invite.placeholderUserId },
        });
      }

      await tx
        .update(schema.invites)
        .set({ uses: sql`${schema.invites.uses} + 1` })
        .where(eq(schema.invites.id, invite.id));
      if (!alreadyMember) {
        await log({
          houseId: invite.houseId,
          actorId: userId,
          type: 'member.joined',
          entityType: 'member',
          entityId: userId,
        });
      }
      return { houseId: invite.houseId, alreadyMember, claimedPlaceholderId };
    });
  }

  /**
   * HOMI-9 (H11): the placeholder's ledger lines become the claimer's,
   * in the claim's own transaction. Amounts never change - this is
   * re-identification, not a money edit, so append-only money truth
   * (invariant 1) stands. Where the claimer already holds a split in
   * the same expense (a returning member who left history behind), the
   * placeholder's share folds into it; the placeholder can never be a
   * payer or a payment party (posting core + payment guards), so splits
   * are the whole history. The membership row is deactivated, never
   * deleted (invariant 5), with claimed_by as the audit pointer, and
   * the orphaned users row soft-deletes.
   */
  private async claimHistory(tx: Tx, houseId: string, placeholderId: string, claimerId: string) {
    await tx.execute(sql`
      UPDATE expense_splits AS mine
      SET amount_cents = mine.amount_cents + theirs.amount_cents
      FROM expense_splits AS theirs
      WHERE theirs.expense_id = mine.expense_id
        AND theirs.user_id = ${placeholderId}
        AND mine.user_id = ${claimerId}
    `);
    await tx.execute(sql`
      DELETE FROM expense_splits AS theirs
      WHERE theirs.user_id = ${placeholderId}
        AND EXISTS (
          SELECT 1 FROM expense_splits mine
          WHERE mine.expense_id = theirs.expense_id AND mine.user_id = ${claimerId}
        )
    `);
    await tx.execute(sql`
      UPDATE expense_splits SET user_id = ${claimerId} WHERE user_id = ${placeholderId}
    `);

    await tx
      .update(schema.houseMembers)
      .set({ claimedBy: claimerId, leftAt: new Date(), roomId: null })
      .where(
        and(
          eq(schema.houseMembers.houseId, houseId),
          eq(schema.houseMembers.userId, placeholderId),
        ),
      );
    await tx
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, placeholderId));
  }
}
