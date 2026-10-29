/**
 * Typed amount -> integer cents, with no Expo or React Native imports so it
 * runs under plain vitest. The device decimal separator is passed in;
 * `format.ts` looks it up and is what screens call.
 *
 * Parsed digit-wise rather than via parseFloat * 100, because 19.99 * 100
 * is 1998.9999999999998 in binary floating point and the ledger stores
 * integer cents (invariant 2). Money must never round-trip through a float
 * on its way in.
 *
 * Strict on purpose. The previous version stripped every non-digit, so a
 * comma-decimal locale's "12,50" became 125000 cents: a $1,250.00 expense
 * from someone who meant twelve fifty. Anything that is not unambiguously
 * an amount is rejected (undefined) rather than guessed at:
 *
 * - one decimal separator at most, either "." or the device's own
 * - at most two fraction digits, so "1.234" is never read as a grouped
 *   thousand or silently truncated
 * - no grouping characters, signs, exponents, or currency symbols
 * - nothing above the API's ceiling
 */

/** Mirrors MAX_AMOUNT_CENTS in apps/api/src/ledger/ledger.controller.ts. */
export const MAX_AMOUNT_CENTS = 10_000_000_000;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "12.5" -> 1250, "12" -> 1200, "0" -> 0, "" -> undefined, "1,234" with a
 * "." device separator -> undefined. Zero is a valid result here because
 * an exact split may give someone nothing; see `parseAmount` for the
 * positive-only form used for a total.
 */
export function parseCents(input: string, decimalSeparator: string): number | undefined {
  const text = input.trim();
  const separators = new Set(['.', decimalSeparator]);
  const sep = [...separators].map(escapeRegExp).join('|');
  const match = new RegExp(`^(\\d*)(?:(?:${sep})(\\d{0,2}))?$`).exec(text);
  if (match === null) return undefined;

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  // "." alone, or nothing at all, is not an amount yet.
  if (whole.length === 0 && fraction.length === 0) return undefined;

  // Digit-wise: whole digits then exactly two fraction digits.
  const cents = Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return undefined;
  return cents;
}

/** A total: like `parseCents`, but only a positive amount counts. */
export function parseAmount(input: string, decimalSeparator: string): number | undefined {
  const cents = parseCents(input, decimalSeparator);
  return cents !== undefined && cents > 0 ? cents : undefined;
}
