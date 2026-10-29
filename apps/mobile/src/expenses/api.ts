import { apiPost } from '@/api/client';

/**
 * HOMI-34: creating an expense. The server owns the split maths - the
 * client sends the mode and the participants, never computed shares, so
 * there is exactly one splitter (invariant 2).
 */

export type SplitMode = 'equal' | 'exact';

export type CreateExpenseInput = {
  description: string;
  amountCents: number;
  paidBy: string;
  mode: SplitMode;
  participants: string[];
  /** Required by the API when mode is 'exact': user id -> cents. */
  exactCents?: Record<string, number>;
};

/** The fields the app reads; mirrors the expenses row the API returns. */
export type Expense = {
  id: string;
  houseId: string;
  description: string;
  amountCents: number;
  currency: string;
  paidBy: string;
  createdBy: string;
};

/**
 * 201 body of POST /v1/houses/:houseId/expenses
 * (apps/api/src/ledger/ledger.service.ts): the expense plus the splits the
 * server computed, user id -> cents.
 */
export type CreateExpenseResponse = { expense: Expense; splits: Record<string, number> };

export const createExpense = (houseId: string, input: CreateExpenseInput, idempotencyKey: string) =>
  apiPost<CreateExpenseResponse>(`/v1/houses/${houseId}/expenses`, input, idempotencyKey);
