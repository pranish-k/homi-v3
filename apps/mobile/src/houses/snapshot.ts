import { apiGet } from '@/api/client';

/**
 * HOMI-33: the HOME tab in one call (HOMI-20's snapshot endpoint).
 * Shapes mirror apps/api/src/houses/snapshot.service.ts.
 */

export type SnapshotMember = {
  userId: string;
  name: string;
  displayName: string | null;
  role: 'admin' | 'member';
  isPlaceholder: boolean;
  roomId: string | null;
  joinedAt: string;
};

export type ActionItem =
  | { type: 'settle_up'; toUserId: string; amountCents: number }
  | {
      type: 'confirm_payment';
      paymentId: string;
      fromUserId: string;
      amountCents: number;
      disputableUntil: string;
    };

export type FeedEvent = {
  id: string;
  houseId: string;
  actorId: string | null;
  type: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type Snapshot = {
  house: { id: string; name: string; timezone: string; currency: string };
  members: SnapshotMember[];
  balances: {
    /** Integer cents. Positive: the house owes them. Negative: they owe. */
    net: Record<string, number>;
    pairwise: { from: string; to: string; amountCents: number }[];
  };
  actionItems: ActionItem[];
  feed: FeedEvent[];
};

export const getSnapshot = (houseId: string) =>
  apiGet<Snapshot>(`/v1/houses/${houseId}/snapshot`);

/** Per-house display name wins over the account name, as the API sends both. */
export const memberName = (member: SnapshotMember | undefined): string =>
  member?.displayName ?? member?.name ?? 'Someone';

/**
 * Feed rows carry actorId and no actor name, so the actor is resolved
 * against the snapshot's own members list. The caller reads as "You",
 * never as their own name.
 */
export function actorLabel(
  actorId: string | null,
  members: SnapshotMember[],
  viewerId: string | undefined,
): string {
  if (actorId === null) return 'HOMI';
  if (actorId === viewerId) return 'You';
  return memberName(members.find((m) => m.userId === actorId));
}
