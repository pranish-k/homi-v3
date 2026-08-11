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

export const createExpense = (houseId: string, input: CreateExpenseInput, idempotencyKey: string) =>
  apiPost<{ id: string }>(`/v1/houses/${houseId}/expenses`, input, idempotencyKey);
