import { formatMoney } from '@/ui/format';
import type { FeedEvent, SnapshotMember } from './snapshot';
import { actorLabel, memberName } from './snapshot';

/**
 * HOMI-33: activity rows in words.
 *
 * The feed can carry event types the v1 UI has no cell for, because
 * bills, rooms, and placeholders are live server-side but hidden from the
 * v1 UI (Epic E6 guardrail). Unknown types fall through to a generic row
 * rather than being filtered out: a user seeing a vague line is
 * recoverable, a user seeing a feed that quietly omits real events is a
 * trust bug in a product whose whole value is being the record.
 *
 * Copy stays direct and non-judgmental (DoD item 7).
 */

const amountOf = (payload: Record<string, unknown> | null): number | undefined =>
  typeof payload?.amountCents === 'number' ? payload.amountCents : undefined;

const describe = (payload: Record<string, unknown> | null): string | undefined =>
  typeof payload?.description === 'string' && payload.description.length > 0
    ? payload.description
    : undefined;

export function feedLine(
  event: FeedEvent,
  members: SnapshotMember[],
  viewerId: string | undefined,
  currency: string,
): string {
  const who = actorLabel(event.actorId, members, viewerId);
  const amount = amountOf(event.payload);
  const money = amount === undefined ? undefined : formatMoney(amount, currency);
  const what = describe(event.payload);

  switch (event.type) {
    case 'expense.created':
      return money !== undefined && what !== undefined
        ? `${who} added ${what}, ${money}`
        : `${who} added an expense`;
    case 'expense.edited':
      return what !== undefined ? `${who} edited ${what}` : `${who} edited an expense`;
    case 'payment.recorded':
      return money !== undefined ? `${who} recorded a payment of ${money}` : `${who} recorded a payment`;
    case 'payment.disputed':
      return `${who} disputed a payment`;
    case 'payment.resolved':
      return `${who} resolved a disputed payment`;
    case 'member.joined':
      return `${who} joined the house`;
    case 'member.claimed':
      return `${who} took over the expenses logged under their name`;
    case 'member.renamed':
      return `${who} changed their name`;
    case 'house.created':
      return `${who} created the house`;
    case 'bill.created':
      return what !== undefined ? `${who} set up a recurring bill, ${what}` : `${who} set up a recurring bill`;
    default:
      // Deliberately generic rather than dropped. See the note above.
      return `${who} made a change`;
  }
}

/** "just now", "3h ago", "2d ago" - relative is what a feed wants. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const placeholderSuffix = (member: SnapshotMember | undefined): string =>
  member?.isPlaceholder === true ? ` (${memberName(member)} has not joined yet)` : '';
