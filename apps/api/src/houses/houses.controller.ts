import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { HouseMemberGuard } from '../auth/house-member.guard';
import { parseBody } from '../lib/validation';
import { HousesService } from './houses.service';
import { InvitesService } from './invites.service';
import { RoomsService } from './rooms.service';

const createHouseSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64),
  currency: z.string().length(3).toUpperCase().default('USD'),
});

const setRoomsSchema = z.object({
  rooms: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        weightBp: z.number().int().positive().max(10000),
        userId: z.string().uuid(),
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
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(createHouseSchema, body);
    return this.houses.createHouse(req.userId, input);
  }

  @Post(':houseId/invites')
  @UseGuards(HouseMemberGuard)
  async createInvite(@Req() req: AuthedRequest, @Param('houseId') houseId: string) {
    return this.invites.createInvite(houseId, req.userId);
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
  async accept(@Req() req: AuthedRequest, @Param('token') token: string) {
    return this.invites.acceptInvite(token, req.userId);
  }
}
