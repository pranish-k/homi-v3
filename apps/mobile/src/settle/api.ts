import { apiPost } from '@/api/client';

/**
 * HOMI-35: recording a settlement. HOMI records the truth; it does not
 * move the money (spec M4), so this is a statement that a payment
 * happened, which the recipient can dispute inside the window.
 */

export type PaymentMethod = 'venmo' | 'zelle' | 'cash_app' | 'cash' | 'other';

export const recordPayment = (
  houseId: string,
  input: { toUser: string; amountCents: number; method?: PaymentMethod },
  idempotencyKey: string,
) => apiPost<{ id: string }>(`/v1/houses/${houseId}/payments`, input, idempotencyKey);

/** 72 hours, matching DISPUTE_WINDOW_MS in the API. */
export const DISPUTE_WINDOW_HOURS = 72;

/**
 * Where each method sends you. We do not store anyone's payment handle,
 * so these open the app rather than pre-filling a recipient - the copy in
 * the UI says so rather than implying HOMI moved anything. Zelle lives
 * inside banking apps and has no reliable scheme, so it goes to the web.
 *
 * `fallback` is opened when `url` cannot be: the venmo:// scheme fails
 * when Venmo is not installed, and venmo.com then hands off to the app or
 * the store. The screen tries `openURL` directly rather than gating on
 * `canOpenURL`, which on iOS answers false for any scheme missing from
 * LSApplicationQueriesSchemes (app.json) whether or not the app is there.
 */
type MethodLink = { label: string; url?: string; fallback?: string };

export const methodLinks: Record<PaymentMethod, MethodLink> = {
  venmo: { label: 'Venmo', url: 'venmo://paycharge?txn=pay', fallback: 'https://venmo.com/' },
  cash_app: { label: 'Cash App', url: 'https://cash.app/' },
  zelle: { label: 'Zelle', url: 'https://www.zellepay.com/' },
  cash: { label: 'Cash' },
  other: { label: 'Other' },
};
