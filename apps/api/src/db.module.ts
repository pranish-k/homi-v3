import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from '@homi/db';
import type { Pool } from 'pg';
import { closeSharedPool, getSharedPool } from './db.pool';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => getSharedPool(),
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
  async onApplicationShutdown(): Promise<void> {
    await closeSharedPool();
  }
}
