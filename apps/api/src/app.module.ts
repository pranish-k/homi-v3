import { Module } from '@nestjs/common';
import { DbModule } from './db.module';
import { HealthController } from './health/health.controller';
import { HousesController } from './houses/houses.controller';
import { HousesService } from './houses/houses.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';

@Module({
  imports: [DbModule],
  controllers: [HealthController, HousesController, LedgerController],
  providers: [HousesService, LedgerService],
})
export class AppModule {}
