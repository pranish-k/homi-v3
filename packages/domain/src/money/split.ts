/**
 * Split math for the ledger (spec 5.7 H3).
 *
 * Everything is integer cents. Splits ALWAYS sum exactly to the total.
 * Remainder rule: leftover cents go to the payer's share when the payer is
 * a participant; otherwise to the first participant in stable (sorted id)
 * order. The rule is deterministic so client previews and server commits
 * can never disagree.
 */

export type SplitMode = 'equal' | 'exact' | 'percent' | 'room_weighted';

export interface SplitInput {
  totalCents: number;
  paidBy: string;
  mode: SplitMode;
  /** Participant user ids. For 'exact' and weighted modes, config is keyed by these ids. */
  participants: string[];
  /** mode 'exact': user id -> amount in cents (must sum to totalCents). */
  exactCents?: Record<string, number>;
  /** modes 'percent' and 'room_weighted': user id -> basis points (must sum to 10000). */
  weightsBp?: Record<string, number>;
}

export type Splits = Record<string, number>;

export class SplitError extends Error {}

function assertValidTotal(totalCents: number): void {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new SplitError('totalCents must be a positive integer (cents)');
  }
}

function remainderRecipient(participants: string[], paidBy: string): string {
  if (participants.includes(paidBy)) return paidBy;
  const first = [...participants].sort()[0];
  if (first === undefined) throw new SplitError('participants must not be empty');
  return first;
}

function splitByWeights(input: SplitInput, weightsBp: Record<string, number>): Splits {
  const { totalCents, participants } = input;
  let bpSum = 0;
  for (const id of participants) {
    const bp = weightsBp[id];
    if (bp === undefined || !Number.isSafeInteger(bp) || bp < 0) {
      throw new SplitError(`missing or invalid weight for participant ${id}`);
    }
    bpSum += bp;
  }
  if (bpSum !== 10000) {
    throw new SplitError(`weights must sum to 10000 basis points, got ${bpSum}`);
  }
  const splits: Splits = {};
  let allocated = 0;
  for (const id of participants) {
    const share = Math.floor((totalCents * (weightsBp[id] as number)) / 10000);
    splits[id] = share;
    allocated += share;
  }
  const recipient = remainderRecipient(participants, input.paidBy);
  splits[recipient] = (splits[recipient] ?? 0) + (totalCents - allocated);
  return splits;
}

export function computeSplits(input: SplitInput): Splits {
  assertValidTotal(input.totalCents);
  const { participants } = input;
  if (participants.length === 0) throw new SplitError('participants must not be empty');
  if (new Set(participants).size !== participants.length) {
    throw new SplitError('participants must be unique');
  }

  switch (input.mode) {
    case 'equal': {
      const base = Math.floor(input.totalCents / participants.length);
      const splits: Splits = {};
      for (const id of participants) splits[id] = base;
      const recipient = remainderRecipient(participants, input.paidBy);
      splits[recipient] = (splits[recipient] ?? 0) + (input.totalCents - base * participants.length);
      return splits;
    }
    case 'exact': {
      const exact = input.exactCents;
      if (!exact) throw new SplitError('exactCents required for exact mode');
      const splits: Splits = {};
      let sum = 0;
      for (const id of participants) {
        const cents = exact[id];
        if (cents === undefined || !Number.isSafeInteger(cents) || cents < 0) {
          throw new SplitError(`missing or invalid exact amount for participant ${id}`);
        }
        splits[id] = cents;
        sum += cents;
      }
      if (sum !== input.totalCents) {
        throw new SplitError(`exact splits sum to ${sum}, expected ${input.totalCents}`);
      }
      return splits;
    }
    case 'percent':
    case 'room_weighted': {
      if (!input.weightsBp) throw new SplitError(`weightsBp required for ${input.mode} mode`);
      return splitByWeights(input, input.weightsBp);
    }
  }
}
