/**
 * The single balance function (spec 5.4, invariant 3).
 *
 * Every surface that shows money owed (header, drilldown, nudge, digest,
 * move-out report) must derive from this computation and nothing else.
 * Input rows come from expenses + expense_splits + payments; the server
 * feeds it, clients never compute state (spec 5.3).
 */

export interface ExpenseRow {
  paidBy: string;
  /** user id -> share in cents; sums to the expense total by invariant 2. */
  splits: Record<string, number>;
}

export interface PaymentRow {
  fromUser: string;
  toUser: string;
  amountCents: number;
  /** disputed payments are excluded from balances until resolved. */
  status: 'recorded' | 'disputed' | 'resolved';
}

export interface Balances {
  /** user id -> net cents. Positive: the house owes them. Negative: they owe. */
  net: Record<string, number>;
  /** "from owes to" pairs, minimal per pair, only non-zero entries. */
  pairwise: { from: string; to: string; amountCents: number }[];
}

export function computeBalances(expenses: ExpenseRow[], payments: PaymentRow[]): Balances {
  // pair key "a|b" with a < b; value = cents b owes a (negative: a owes b)
  const pair = new Map<string, number>();
  const addDebt = (debtor: string, creditor: string, cents: number) => {
    if (debtor === creditor || cents === 0) return;
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const signed = debtor === b ? cents : -cents;
    pair.set(`${a}|${b}`, (pair.get(`${a}|${b}`) ?? 0) + signed);
  };

  for (const e of expenses) {
    for (const [userId, cents] of Object.entries(e.splits)) {
      addDebt(userId, e.paidBy, cents);
    }
  }
  for (const p of payments) {
    if (p.status === 'disputed') continue;
    // paying someone reduces what you owe them
    addDebt(p.toUser, p.fromUser, p.amountCents);
  }

  const net: Record<string, number> = {};
  const pairwise: Balances['pairwise'] = [];
  for (const [key, value] of [...pair.entries()].sort()) {
    if (value === 0) continue;
    const [a, b] = key.split('|') as [string, string];
    const [from, to, amountCents] = value > 0 ? [b, a, value] : [a, b, -value];
    pairwise.push({ from, to, amountCents });
    net[from] = (net[from] ?? 0) - amountCents;
    net[to] = (net[to] ?? 0) + amountCents;
  }
  return { net, pairwise };
}
