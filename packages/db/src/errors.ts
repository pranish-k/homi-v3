const PG_UNIQUE_VIOLATION = '23505';

/**
 * The one place that knows what a Postgres unique violation looks like.
 * Both the API (idempotency-key replays) and the worker (the H4
 * (template_id, period) posting guard) branch on it.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
