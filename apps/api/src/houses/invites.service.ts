import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@homi/db';
import { ActivityService, type LogActivity } from '../activity/activity.service';
import { requireAdmin } from '../auth/house-role';
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
    await requireAdmin(this.db, houseId, actorId, 'create invites');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    // The unclaimed check and the insert share a transaction, with the
    // placeholder row locked FOR UPDATE: a concurrent claim (which takes
    // the same lock in acceptInvite) commits strictly before or after,
    // so an invite can never be bound to an already-claimed placeholder.
    const [invite] = await this.db.transaction(async (tx) => {
      if (placeholderId !== undefined) {
        const [placeholder] = await tx
          .select({ claimedBy: schema.houseMembers.claimedBy })
          .from(schema.houseMembers)
          .where(
            and(
              eq(schema.houseMembers.houseId, houseId),
              eq(schema.houseMembers.userId, placeholderId),
              eq(schema.houseMembers.isPlaceholder, true),
              isNull(schema.houseMembers.leftAt),
            ),
          )
          .for('update');
        if (!placeholder || placeholder.claimedBy !== null) {
          throw new BadRequestException('placeholderId must be an unclaimed placeholder of this house');
        }
      }
      return tx
        .insert(schema.invites)
        .values({
          houseId,
          tokenHash: hashToken(token),
          createdBy: actorId,
          expiresAt,
          placeholderUserId: placeholderId,
        })
        .returning();
    });
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

      let alreadyMember = existing?.leftAt === null;
      if (!existing) {
        // onConflictDoNothing: a concurrent accept via a different invite
        // may win the insert; losing quietly is the correct outcome
        const inserted = await tx
          .insert(schema.houseMembers)
          .values({ houseId: invite.houseId, userId, roomId: inheritedRoomId })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) {
          if (invite.placeholderUserId === null) {
            return { houseId: invite.houseId, alreadyMember: true, claimedPlaceholderId: null };
          }
          // Lost the insert race to a concurrent accept but still owe the
          // claim: the winner already logged member.joined, so this accept
          // must not log a second one, and the winner's row (inserted
          // without a room) inherits the placeholder's room below.
          alreadyMember = true;
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
        if (inheritedRoomId !== null) {
          // The insert and reactivate branches assign the room directly;
          // this covers a claimer who was already an active member (or won
          // membership through a racing accept): they inherit the
          // placeholder's room unless they already occupy one, so claiming
          // never leaves the room occupant-less and room-weighted splits
          // still sum to 10000bp. A claimer who does occupy another room
          // keeps it - two rooms cannot merge - and the admin re-runs
          // PUT /rooms.
          await tx
            .update(schema.houseMembers)
            .set({ roomId: inheritedRoomId })
            .where(
              and(
                eq(schema.houseMembers.houseId, invite.houseId),
                eq(schema.houseMembers.userId, userId),
                isNull(schema.houseMembers.roomId),
                isNull(schema.houseMembers.leftAt),
              ),
            );
        }
        await this.claimHistory(tx, invite.houseId, invite.placeholderUserId, userId, log);
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
   * in the claim's own transaction. No expense total changes - this is
   * re-identification, not a money edit, so append-only money truth
   * (invariant 1) stands. Where the claimer already holds a split in
   * the same expense (a returning member who left history behind), the
   * placeholder's share folds into it - and because that visibly changes
   * the claimer's per-line amount, the fold snapshots the prior state
   * into expense_revisions and surfaces expense.edited, exactly like an
   * edit (HOMI-12). The placeholder can never be a payer or a payment
   * party (posting core + payment guards), so splits are the whole
   * history. The membership row is deactivated, never deleted
   * (invariant 5), with claimed_by as the audit pointer, and the
   * orphaned users row soft-deletes.
   */
  private async claimHistory(
    tx: Tx,
    houseId: string,
    placeholderId: string,
    claimerId: string,
    log: LogActivity,
  ) {
    const folded = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          sql`EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = ${schema.expenses.id} AND s.user_id = ${placeholderId})`,
          sql`EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = ${schema.expenses.id} AND s.user_id = ${claimerId})`,
        ),
      );
    if (folded.length > 0) {
      const foldedIds = folded.map((e) => e.id);
      const foldedSplits = await tx
        .select({
          expenseId: schema.expenseSplits.expenseId,
          userId: schema.expenseSplits.userId,
          amountCents: schema.expenseSplits.amountCents,
        })
        .from(schema.expenseSplits)
        .where(inArray(schema.expenseSplits.expenseId, foldedIds));
      await tx.insert(schema.expenseRevisions).values(
        folded.map((expense) => ({
          expenseId: expense.id,
          changedBy: claimerId,
          previous: {
            expense: {
              description: expense.description,
              amountCents: expense.amountCents,
              currency: expense.currency,
              paidBy: expense.paidBy,
              category: expense.category,
              isStaple: expense.isStaple,
            },
            splits: Object.fromEntries(
              foldedSplits
                .filter((s) => s.expenseId === expense.id)
                .map((s) => [s.userId, s.amountCents]),
            ),
          },
        })),
      );
      for (const expense of folded) {
        await log({
          houseId,
          actorId: claimerId,
          type: 'expense.edited',
          entityType: 'expense',
          entityId: expense.id,
          payload: { amountCents: expense.amountCents, description: expense.description },
        });
      }
    }

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
