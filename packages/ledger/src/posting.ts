import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DbConn } from '@homi/db';
import { computeSplits, divideRoomWeight, type SplitMode } from '@homi/domain';

/**
 * A posting that cannot proceed for a domain reason (missing member,
 * unassigned room, placeholder misuse). The API maps it to a 400; the
 * worker pauses the bill. Anything else is a real bug and propagates.
 */
export class PostingProblem extends Error {}

export interface ActiveMember {
  userId: string;
  isPlaceholder: boolean;
  roomId: string | null;
  joinedAt: Date;
}

/**
 * Sprint 4 review carryover: the ONE money write core shared by the API
 * (expense create/edit) and the worker (bill posting), so who-owes-what
 * logic cannot drift between them.
 *
 * Every posting starts here. SHARE locks on the membership rows make a
 * posting serialize with anything that rewrites membership under it -
 * in particular a placeholder claim (H11), which takes FOR UPDATE on
 * the same rows: an expense resolved against the placeholder commits
 * either before the claim (and is swept into it) or after it (and
 * fails the active-member check).
 */
export async function lockActiveMembers(tx: DbConn, houseId: string): Promise<ActiveMember[]> {
  return tx
    .select({
      userId: schema.houseMembers.userId,
      isPlaceholder: schema.houseMembers.isPlaceholder,
      roomId: schema.houseMembers.roomId,
      joinedAt: schema.houseMembers.joinedAt,
    })
    .from(schema.houseMembers)
    .where(and(eq(schema.houseMembers.houseId, houseId), isNull(schema.houseMembers.leftAt)))
    .for('share');
}

/**
 * Sprint 5 review carryover: the ONE implementation of "a placeholder
 * never moves money" for the roles the posting core does not already
 * cover (bill owner, payment recipient; the expense payer is guarded in
 * resolveSplits). The row is SHARE-locked like every posting-core read,
 * so the check serializes with a concurrent claim's FOR UPDATE (H11) -
 * an unlocked copy could approve a placeholder mid-claim. Throws
 * PostingProblem; API callers map it to a 400.
 */
export async function lockActingMember(
  tx: DbConn,
  houseId: string,
  userId: string,
  who: { subject: string; verb: string },
): Promise<void> {
  const [member] = await tx
    .select({ isPlaceholder: schema.houseMembers.isPlaceholder })
    .from(schema.houseMembers)
    .where(
      and(
        eq(schema.houseMembers.houseId, houseId),
        eq(schema.houseMembers.userId, userId),
        isNull(schema.houseMembers.leftAt),
      ),
    )
    .for('share');
  if (!member) {
    throw new PostingProblem(`${who.subject} must be an active house member`);
  }
  if (member.isPlaceholder) {
    throw new PostingProblem(`A placeholder roommate cannot ${who.verb}`);
  }
}

export interface ResolveSplitsInput {
  amountCents: number;
  paidBy: string;
  mode: SplitMode;
  participants: string[];
  exactCents?: Record<string, number>;
  weightsBp?: Record<string, number>;
}

/**
 * The one place splits are derived from a request. Payer and
 * participants must be active members, and room-weighted weights come
 * from room assignments server-side - clients cannot supply their own
 * (spec 5.3: clients never compute state). SplitError propagates for
 * callers to map alongside PostingProblem.
 */
export async function resolveSplits(
  tx: DbConn,
  houseId: string,
  input: ResolveSplitsInput,
  preloadedMembers?: ActiveMember[],
): Promise<Record<string, number>> {
  const members = preloadedMembers ?? (await lockActiveMembers(tx, houseId));
  const byId = new Map(members.map((m) => [m.userId, m]));

  const involved = [...new Set([...input.participants, input.paidBy])];
  if (involved.some((id) => !byId.has(id))) {
    throw new PostingProblem('Payer and all participants must be active house members');
  }
  // HOMI-9: a placeholder owes shares but never acts - it cannot have
  // paid, so the claim never has to rewrite paid_by, only splits
  if (byId.get(input.paidBy)?.isPlaceholder) {
    throw new PostingProblem('A placeholder roommate cannot pay an expense');
  }

  let weightsBp = input.weightsBp;
  if (input.mode === 'room_weighted') {
    if (weightsBp) {
      throw new PostingProblem('room_weighted splits are derived from rooms; do not send weightsBp');
    }
    weightsBp = await deriveRoomWeights(tx, houseId, input.participants, byId);
  }

  return computeSplits({
    totalCents: input.amountCents,
    paidBy: input.paidBy,
    mode: input.mode,
    participants: input.participants,
    exactCents: input.exactCents,
    weightsBp,
  });
}

/**
 * Server-derived weights for a room-weighted split: every participant
 * needs a room assignment, and a room's weight divides across ALL its
 * active occupants (HOMI-23: a couple shares their room's weight), so a
 * member's personal weight is a fact about the house, not about any one
 * expense. Occupants order by (joinedAt, userId), which pins where the
 * odd basis point of an uneven division lands.
 */
async function deriveRoomWeights(
  tx: DbConn,
  houseId: string,
  participants: string[],
  membersById: Map<string, ActiveMember>,
): Promise<Record<string, number>> {
  const roomIds = [
    ...new Set(
      participants
        .map((id) => membersById.get(id)?.roomId)
        .filter((roomId): roomId is string => roomId != null),
    ),
  ];
  const rooms = roomIds.length
    ? await tx
        .select({ id: schema.rooms.id, weightBp: schema.rooms.weightBp })
        .from(schema.rooms)
        .where(and(eq(schema.rooms.houseId, houseId), inArray(schema.rooms.id, roomIds)))
    : [];

  const occupantsByRoom = new Map<string, ActiveMember[]>();
  for (const member of membersById.values()) {
    if (member.roomId === null) continue;
    const list = occupantsByRoom.get(member.roomId) ?? [];
    list.push(member);
    occupantsByRoom.set(member.roomId, list);
  }

  const shareByUser = new Map<string, number>();
  for (const room of rooms) {
    const occupants = (occupantsByRoom.get(room.id) ?? []).sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId),
    );
    const shares = divideRoomWeight(room.weightBp, occupants.map((o) => o.userId));
    for (const [userId, share] of Object.entries(shares)) shareByUser.set(userId, share);
  }

  const weights: Record<string, number> = {};
  for (const userId of participants) {
    const share = shareByUser.get(userId);
    if (share === undefined) {
      throw new PostingProblem('Every participant needs a room for a room-weighted split');
    }
    weights[userId] = share;
  }
  return weights;
}

export interface ExpenseSpec {
  houseId: string;
  description: string;
  amountCents: number;
  currency: string;
  paidBy: string;
  category?: string | null;
  isStaple?: boolean;
  templateId?: string;
  period?: string;
  createdBy: string;
}

/**
 * The one expense write shape: expense row + split rows, same
 * transaction. Activity logging stays with the caller (event types and
 * payloads differ per mutation, and the API routes them through
 * ActivityService for the realtime hint).
 */
export async function insertExpense(
  tx: DbConn,
  spec: ExpenseSpec,
  splits: Record<string, number>,
): Promise<typeof schema.expenses.$inferSelect> {
  const [expense] = await tx
    .insert(schema.expenses)
    .values({
      houseId: spec.houseId,
      description: spec.description,
      amountCents: spec.amountCents,
      currency: spec.currency,
      paidBy: spec.paidBy,
      category: spec.category,
      isStaple: spec.isStaple ?? false,
      templateId: spec.templateId,
      period: spec.period,
      createdBy: spec.createdBy,
    })
    .returning();
  if (!expense) throw new Error('insert returned no row');

  await tx.insert(schema.expenseSplits).values(
    Object.entries(splits).map(([userId, amountCents]) => ({
      expenseId: expense.id,
      userId,
      amountCents,
    })),
  );
  return expense;
}
