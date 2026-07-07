import { Module } from '@nestjs/common';
import { DbModule } from './db.module';
import { HealthController } from './health/health.controller';
import { HousesController, InvitesController } from './houses/houses.controller';
import { HousesService } from './houses/houses.service';
import { InvitesService } from './houses/invites.service';
import { RoomsService } from './houses/rooms.service';
import { LedgerController, PaymentsController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    HousesController,
    InvitesController,
    LedgerController,
    PaymentsController,
  ],
  providers: [HousesService, InvitesService, RoomsService, LedgerService],
})
export class AppModule {}
