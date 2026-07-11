// Rendering only: the server computes all money state (spec 5.3).
export function fmt(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
