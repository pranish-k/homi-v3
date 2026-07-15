import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * as schema from './schema';
export { isUniqueViolation } from './errors';

export type Db = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
