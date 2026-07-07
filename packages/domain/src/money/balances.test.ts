import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeBalances, type ExpenseRow, type PaymentRow } from './balances';
import { computeSplits } from './split';

describe('computeBalances', () => {
  it('nets a simple two-person expense', () => {
    const expenses: ExpenseRow[] = [
      { paidBy: 'ana', splits: { ana: 2500, ben: 2500 } },
    ];
    const { net, pairwise } = computeBalances(expenses, []);
    expect(net).toEqual({ ana: 2500, ben: -2500 });
    expect(pairwise).toEqual([{ from: 'ben', to: 'ana', amountCents: 2500 }]);
  });

  it('applies recorded payments and ignores disputed ones', () => {
    const expenses: ExpenseRow[] = [
      { paidBy: 'ana', splits: { ana: 2500, ben: 2500 } },
    ];
    const payments: PaymentRow[] = [
      { fromUser: 'ben', toUser: 'ana', amountCents: 1000, status: 'recorded' },
      { fromUser: 'ben', toUser: 'ana', amountCents: 9999, status: 'disputed' },
    ];
    const { pairwise } = computeBalances(expenses, payments);
    expect(pairwise).toEqual([{ from: 'ben', to: 'ana', amountCents: 1500 }]);
  });

  it('nets opposing debts within a pair to a single direction', () => {
    const expenses: ExpenseRow[] = [
      { paidBy: 'ana', splits: { ben: 3000 } },
      { paidBy: 'ben', splits: { ana: 1000 } },
    ];
    const { pairwise } = computeBalances(expenses, []);
    expect(pairwise).toEqual([{ from: 'ben', to: 'ana', amountCents: 2000 }]);
  });

  it('returns nothing when fully settled', () => {
    const expenses: ExpenseRow[] = [{ paidBy: 'ana', splits: { ana: 500, ben: 500 } }];
    const payments: PaymentRow[] = [
      { fromUser: 'ben', toUser: 'ana', amountCents: 500, status: 'recorded' },
    ];
    const { net, pairwise } = computeBalances(expenses, payments);
    expect(pairwise).toEqual([]);
    expect(net).toEqual({});
  });

  it('property: net balances always sum to zero (money is conserved)', () => {
    const members = ['u1', 'u2', 'u3', 'u4'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            totalCents: fc.integer({ min: 1, max: 1_000_000 }),
            payerIdx: fc.integer({ min: 0, max: members.length - 1 }),
          }),
          { maxLength: 25 },
        ),
        fc.array(
          fc.record({
            fromIdx: fc.integer({ min: 0, max: members.length - 1 }),
            toIdx: fc.integer({ min: 0, max: members.length - 1 }),
            amountCents: fc.integer({ min: 1, max: 100_000 }),
          }),
          { maxLength: 25 },
        ),
        (rawExpenses, rawPayments) => {
          const expenses: ExpenseRow[] = rawExpenses.map((e) => ({
            paidBy: members[e.payerIdx] as string,
            splits: computeSplits({
              totalCents: e.totalCents,
              paidBy: members[e.payerIdx] as string,
              mode: 'equal',
              participants: members,
            }),
          }));
          const payments: PaymentRow[] = rawPayments
            .filter((p) => p.fromIdx !== p.toIdx)
            .map((p) => ({
              fromUser: members[p.fromIdx] as string,
              toUser: members[p.toIdx] as string,
              amountCents: p.amountCents,
              status: 'recorded' as const,
            }));
          const { net } = computeBalances(expenses, payments);
          const total = Object.values(net).reduce((a, b) => a + b, 0);
          expect(total).toBe(0);
        },
      ),
    );
  });
});
