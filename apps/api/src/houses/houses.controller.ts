import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { HouseMemberGuard } from '../auth/house-member.guard';
import { RateLimit, RateLimitGuard } from '../ratelimit/rate-limit.guard';
import { parseBody } from '../lib/validation';
import { HousesService } from './houses.service';
import { InvitesService } from './invites.service';
import { MembersService } from './members.service';
import { RoomsService } from './rooms.service';
import { SnapshotService } from './snapshot.service';

// HOMI-24: invites gate house membership, so both creating and
// accepting are budgeted per user. Generous for humans, hostile to
// scripts enumerating tokens or spraying links.
const INVITE_RULE = { limit: 20, windowSec: 60 * 60 };

const createHouseSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64),
  currency: z.string().length(3).toUpperCase().default('USD'),
});

const setDisplayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable(),
});

const setRoomsSchema = z.object({
  rooms: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        weightBp: z.number().int().positive().max(10000),
        // HOMI-23: a shared room lists all its occupants
        userIds: z.array(z.string().uuid()).min(1).max(4),
      }),
    )
    .min(1)
    .max(20),
});

@Controller('v1/houses')
@UseGuards(AuthGuard)
export class HousesController {
  constructor(
    private readonly houses: HousesService,
    private readonly invites: InvitesService,
    private readonly members: MembersService,
    private readonly rooms: RoomsService,
    private readonly snapshot: SnapshotService,
  ) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(createHouseSchema, body);
    return this.houses.createHouse(req.userId, input);
  }

  /** HOMI-20: the HOME tab in one call; the refetch target for realtime hints (H6). */
  @Get(':houseId/snapshot')
  @UseGuards(HouseMemberGuard)
  async getSnapshot(@Req() req: AuthedRequest, @Param('houseId') houseId: string) {
    return this.snapshot.getSnapshot(houseId, req.userId);
  }

  @Post(':houseId/invites')
  @UseGuards(HouseMemberGuard, RateLimitGuard)
  @RateLimit({ bucket: 'invite:create', ...INVITE_RULE })
  async createInvite(@Req() req: AuthedRequest, @Param('houseId') houseId: string) {
    return this.invites.createInvite(houseId, req.userId);
  }

  /** HOMI-28: what this house calls me; null goes back to my account name. */
  @Patch(':houseId/members/me')
  @UseGuards(HouseMemberGuard)
  async setDisplayName(
    @Req() req: AuthedRequest,
    @Param('houseId') houseId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(setDisplayNameSchema, body);
    return this.members.setDisplayName(houseId, req.userId, input.displayName);
  }

  @Put(':houseId/rooms')
  @UseGuards(HouseMemberGuard)
  async setRooms(
    @Req() req: AuthedRequest,
    @Param('houseId') houseId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(setRoomsSchema, body);
    return this.rooms.setRooms(houseId, req.userId, input.rooms);
  }

  @Get(':houseId/rooms')
  @UseGuards(HouseMemberGuard)
  async getRooms(@Param('houseId') houseId: string) {
    return this.rooms.getRooms(houseId);
  }
}

@Controller('v1/invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post(':token/accept')
  @UseGuards(RateLimitGuard)
  @RateLimit({ bucket: 'invite:accept', ...INVITE_RULE })
  async accept(@Req() req: AuthedRequest, @Param('token') token: string) {
    return this.invites.acceptInvite(token, req.userId);
  }
}
