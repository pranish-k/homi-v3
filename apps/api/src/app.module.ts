import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DbModule } from './db.module';
import { MembershipService } from './auth/membership.service';
import { HealthController } from './health/health.controller';
import { HousesController, InvitesController } from './houses/houses.controller';
import { HousesService } from './houses/houses.service';
import { InvitesService } from './houses/invites.service';
import { MembersService } from './houses/members.service';
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
  ],
  providers: [
    HousesService,
    InvitesService,
    MembersService,
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
