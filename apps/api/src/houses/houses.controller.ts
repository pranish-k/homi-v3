import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DevAuthGuard, type AuthedRequest } from '../auth/dev-auth.guard';
import { HouseMemberGuard } from '../auth/house-member.guard';
import { parseBody } from '../lib/validation';
import { HousesService } from './houses.service';

const createHouseSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64),
  currency: z.string().length(3).toUpperCase().default('USD'),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(80).optional(),
});

@Controller('v1/houses')
@UseGuards(DevAuthGuard)
export class HousesController {
  constructor(private readonly houses: HousesService) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(createHouseSchema, body);
    return this.houses.createHouse(req.userId, input);
  }

  @Post(':houseId/members')
  @UseGuards(HouseMemberGuard)
  async addMember(
    @Req() req: AuthedRequest,
    @Param('houseId') houseId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(addMemberSchema, body);
    return this.houses.addMember(houseId, req.userId, input);
  }
}
