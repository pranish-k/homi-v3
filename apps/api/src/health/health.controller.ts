import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db.module';

const DB_PROBE_TIMEOUT_MS = 2_000;

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Liveness: is the process up. Deliberately does NOT touch the
   * database; a DB blip must not make the orchestrator restart every
   * healthy instance.
   */
  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  /**
   * Readiness (HOMI-27, review LOW): the probe exercises the database,
   * so a wedged pool or a dead Postgres takes the instance out of
   * rotation instead of serving 200s it cannot back up.
   */
  @Get('readyz')
  async ready() {
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('db probe timed out')), DB_PROBE_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch {
      throw new ServiceUnavailableException({ status: 'unhealthy', db: 'unreachable' });
    }
    return { status: 'ok' };
  }
}
