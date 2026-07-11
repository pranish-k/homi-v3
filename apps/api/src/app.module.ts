import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DbModule } from './db.module';
import { MembershipService } from './auth/membership.service';
import { DevController } from './dev/dev.controller';
import { HealthController } from './health/health.controller';
import { HousesController, InvitesController } from './houses/houses.controller';
import { HousesService } from './houses/houses.service';
import { InvitesService } from './houses/invites.service';
import { RoomsService } from './houses/rooms.service';
import { SnapshotService } from './houses/snapshot.service';
import { LedgerController, PaymentsController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { RateLimitFilter } from './ratelimit/rate-limit.filter';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeService } from './realtime/realtime.service';

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    HousesController,
    InvitesController,
    LedgerController,
    PaymentsController,
    // DEMO BRANCH ONLY: /dev/sign-in refuses to exist in production
    ...(process.env.NODE_ENV === 'production' ? [] : [DevController]),
  ],
  providers: [
    HousesService,
    InvitesService,
    RoomsService,
    SnapshotService,
    LedgerService,
    MembershipService,
    RealtimeService,
    RealtimeGateway,
    { provide: APP_FILTER, useClass: RateLimitFilter },
  ],
})
export class AppModule {}
