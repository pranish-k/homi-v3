import * as Localization from 'expo-localization';

/**
 * HOMI-36: the one place money becomes a string.
 *
 * The API returns integer cents plus a 3-letter currency code and leaves
 * formatting to the client (spec 5). Keeping that in a single function is
 * what makes "zero balance-math bug reports" checkable - there is exactly
 * one rounding and one grouping rule in the app.
 */

const localeTag = (): string => Localization.getLocales()[0]?.languageTag ?? 'en-US';

/** Manual fallback for a JS runtime without full ICU. */
const basic = (cents: number, currency: string): string => {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toLocaleString('en-US');
  const fraction = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${whole}.${fraction}`;
};

/**
 * 2500 USD -> "$25.00", -2500 USD -> "-$25.00".
 * Pass `absolute` when the caller renders the direction itself (a Money
 * with an explicit + or -, or a row already labelled "owes you").
 */
export function formatMoney(
  cents: number,
  currency: string,
  options: { absolute?: boolean } = {},
): string {
  const value = options.absolute === true ? Math.abs(cents) : cents;
  try {
    return new Intl.NumberFormat(localeTag(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100);
  } catch {
    // Intl without the currency data, or an unknown code: never let a
    // formatting problem hide an amount.
    return basic(value, currency);
  }
}
