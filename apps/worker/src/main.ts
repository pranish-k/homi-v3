/**
 * Worker service skeleton (spec 5.2).
 *
 * Sprint 1 scope: process boots, connects, and exits health-checkable.
 * BullMQ queues land with HOMI-13 (recurring bills), HOMI-18 (stale-debt
 * nudges), and HOMI-19 (digests). Job rules from day one:
 * - every job idempotent and retry-safe (H4): bill materialization is
 *   keyed on (template_id, period) with a unique constraint;
 * - all schedules computed in the house timezone, server-side (H5);
 * - alert on "expected job did not run", not only on errors.
 */
import { createDb, createPool } from '@homi/db';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool(url);
  createDb(pool);
  console.log('HOMI worker up (queues arrive with HOMI-13)');

  const shutdown = async () => {
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
