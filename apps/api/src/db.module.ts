import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool, type Db } from '@homi/db';
import type { Pool } from 'pg';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        return createPool(url);
      },
    },
    {
      provide: DB,
      useFactory: (pool: Pool): Db => createDb(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown(): Promise<void> {
    // pool closed by Nest lifecycle owners in tests; no-op here
  }
}
