import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * as schema from './schema';
export { isUniqueViolation } from './errors';

export type Db = NodePgDatabase<typeof schema>;

/** A transaction handle as drizzle passes it to the callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A Db or a transaction handle within one; both run the same query
 * builders. The ONE home of this union (Sprint 5 review): every layer
 * speaks the same type, so a future narrowing lands everywhere at once.
 */
export type DbConn = Db | Tx;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
