import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeSplits, SplitError } from './split';

const userIds = (n: number) => Array.from({ length: n }, (_, i) => `user-${i + 1}`);

const sum = (splits: Record<string, number>) => Object.values(splits).reduce((a, b) => a + b, 0);

describe('computeSplits equal mode', () => {
  it('gives the classic $100 / 3 case with remainder to the payer (H3)', () => {
    const splits = computeSplits({
      totalCents: 10000,
      paidBy: 'user-1',
      mode: 'equal',
      participants: userIds(3),
    });
    expect(splits).toEqual({ 'user-1': 3334, 'user-2': 3333, 'user-3': 3333 });
  });

  it('sends the remainder to the first sorted participant when the payer is not one', () => {
    const splits = computeSplits({
      totalCents: 10000,
      paidBy: 'outsider',
      mode: 'equal',
      participants: ['user-2', 'user-1', 'user-3'],
    });
    expect(splits['user-1']).toBe(3334);
  });

  it('property: splits always sum to the total and are deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.nat(),
        (totalCents, n, payerIdx) => {
          const participants = userIds(n);
          const paidBy = participants[payerIdx % n] as string;
          const a = computeSplits({ totalCents, paidBy, mode: 'equal', participants });
          const b = computeSplits({ totalCents, paidBy, mode: 'equal', participants });
          expect(sum(a)).toBe(totalCents);
          expect(a).toEqual(b);
          expect(Object.values(a).every((c) => c >= 0)).toBe(true);
        },
      ),
    );
  });
});

describe('computeSplits exact mode', () => {
  it('accepts exact amounts that sum to the total', () => {
    const splits = computeSplits({
      totalCents: 5000,
      paidBy: 'user-1',
      mode: 'exact',
      participants: userIds(2),
      exactCents: { 'user-1': 1200, 'user-2': 3800 },
    });
    expect(splits).toEqual({ 'user-1': 1200, 'user-2': 3800 });
  });

  it('rejects amounts that do not sum to the total (invariant 2)', () => {
    expect(() =>
      computeSplits({
        totalCents: 5000,
        paidBy: 'user-1',
        mode: 'exact',
        participants: userIds(2),
        exactCents: { 'user-1': 1200, 'user-2': 3801 },
      }),
    ).toThrow(SplitError);
  });
});

describe('computeSplits weighted modes (percent, room_weighted)', () => {
  it('applies room weights in basis points', () => {
    const splits = computeSplits({
      totalCents: 200000, // $2000 rent
      paidBy: 'user-1',
      mode: 'room_weighted',
      participants: userIds(3),
      weightsBp: { 'user-1': 4000, 'user-2': 3200, 'user-3': 2800 },
    });
    expect(splits).toEqual({ 'user-1': 80000, 'user-2': 64000, 'user-3': 56000 });
  });

  it('rejects weights that do not sum to 10000 bp', () => {
    expect(() =>
      computeSplits({
        totalCents: 1000,
        paidBy: 'user-1',
        mode: 'percent',
        participants: userIds(2),
        weightsBp: { 'user-1': 5000, 'user-2': 4999 },
      }),
    ).toThrow(SplitError);
  });

  it('property: random valid weights always sum to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 10 }),
        (totalCents, rawWeights) => {
          // normalize arbitrary positive integers into bp summing to 10000
          const rawSum = rawWeights.reduce((a, b) => a + b, 0);
          const participants = userIds(rawWeights.length);
          const weightsBp: Record<string, number> = {};
          let allocatedBp = 0;
          participants.forEach((id, i) => {
            const bp = Math.floor(((rawWeights[i] as number) * 10000) / rawSum);
            weightsBp[id] = bp;
            allocatedBp += bp;
          });
          weightsBp[participants[0] as string] += 10000 - allocatedBp;

          const splits = computeSplits({
            totalCents,
            paidBy: participants[0] as string,
            mode: 'percent',
            participants,
            weightsBp,
          });
          expect(sum(splits)).toBe(totalCents);
          expect(Object.values(splits).every((c) => c >= 0)).toBe(true);
        },
      ),
    );
  });
});

describe('computeSplits validation', () => {
  it('rejects non-integer, zero, and negative totals', () => {
    for (const bad of [0, -100, 10.5, Number.NaN]) {
      expect(() =>
        computeSplits({ totalCents: bad, paidBy: 'u', mode: 'equal', participants: ['u'] }),
      ).toThrow(SplitError);
    }
  });

  it('rejects duplicate and empty participant lists', () => {
    expect(() =>
      computeSplits({ totalCents: 100, paidBy: 'u', mode: 'equal', participants: [] }),
    ).toThrow(SplitError);
    expect(() =>
      computeSplits({ totalCents: 100, paidBy: 'u', mode: 'equal', participants: ['a', 'a'] }),
    ).toThrow(SplitError);
  });
});
