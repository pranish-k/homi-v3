import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@homi/db';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { getAuth, lastMagicLink } from '../auth/auth.instance';
import { DB } from '../db.module';
import { parseBody } from '../lib/validation';

const signInSchema = z.object({ email: z.string().email().max(200) });

/**
 * DEMO BRANCH ONLY. Registered exclusively outside production (see
 * app.module.ts): lets the browser sign in as a hardcoded demo user by
 * replaying the magic link that non-prod builds already capture in
 * lastMagicLink for the integration tests. The send still goes through
 * the real Better Auth flow, including the HOMI-24 rate limit.
 */
@Controller('dev')
export class DevController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The demo UI needs "which houses am I in"; the real /v1/me endpoint
   * is future R1 work, so this stand-in lives on the demo branch only.
   */
  @Get('my-houses')
  @UseGuards(AuthGuard)
  async myHouses(@Req() req: AuthedRequest) {
    return this.db
      .select({
        id: schema.houses.id,
        name: schema.houses.name,
        currency: schema.houses.currency,
        role: schema.houseMembers.role,
      })
      .from(schema.houseMembers)
      .innerJoin(schema.houses, eq(schema.houses.id, schema.houseMembers.houseId))
      .where(and(eq(schema.houseMembers.userId, req.userId), isNull(schema.houseMembers.leftAt)))
      .orderBy(schema.houses.createdAt);
  }

  @Post('sign-in')
  async signIn(@Body() body: unknown) {
    const { email } = parseBody(signInSchema, body);
    const response = await getAuth().handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    if (!response.ok) {
      throw new BadRequestException(`magic-link send failed (${response.status})`);
    }
    const verifyUrl = lastMagicLink.get(email);
    lastMagicLink.delete(email);
    if (!verifyUrl) throw new NotFoundException('no magic link captured');
    // the browser follows this URL itself so the session cookie lands there
    return { verifyUrl: new URL(verifyUrl).pathname + new URL(verifyUrl).search };
  }
}
