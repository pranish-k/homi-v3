import { createPool } from '@homi/db';
import type { Pool } from 'pg';

// One pg pool per process (H12: pool exhaustion is a boring killer).
// Shared by Nest DI (DbModule) and the Better Auth instance; drained on
// application shutdown.
let pool: Pool | undefined;

export function getSharedPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = createPool(url);
  }
  return pool;
}

export async function closeSharedPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
