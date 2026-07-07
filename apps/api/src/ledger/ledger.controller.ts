import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { HouseMemberGuard } from '../auth/house-member.guard';
import { parseBody } from '../lib/validation';
import { LedgerService } from './ledger.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createExpenseSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).toUpperCase().optional(),
  paidBy: z.string().uuid(),
  category: z.string().max(50).optional(),
  isStaple: z.boolean().optional(),
  mode: z.enum(['equal', 'exact', 'percent', 'room_weighted']),
  participants: z.array(z.string().uuid()).min(1).max(50),
  exactCents: z.record(z.string().uuid(), z.number().int().nonnegative()).optional(),
  weightsBp: z.record(z.string().uuid(), z.number().int().nonnegative()).optional(),
});

const recordPaymentSchema = z.object({
  toUser: z.string().uuid(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).toUpperCase().optional(),
  method: z.enum(['venmo', 'zelle', 'cash_app', 'cash', 'other']).optional(),
});

@Controller('v1/houses/:houseId')
@UseGuards(AuthGuard, HouseMemberGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('payments')
  async recordPayment(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('houseId') houseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header (UUID) is required on money mutations');
    }
    const input = parseBody(recordPaymentSchema, body);
    const result = await this.ledger.recordPayment(houseId, req.userId, idempotencyKey, input);
    res.status(result.status).json(result.body);
  }

  @Post('expenses')
  async createExpense(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('houseId') houseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header (UUID) is required on money mutations');
    }
    const input = parseBody(createExpenseSchema, body);
    const result = await this.ledger.createExpense(houseId, req.userId, idempotencyKey, input);
    res.status(result.status).json(result.body);
  }

  @Get('balances')
  async balances(@Param('houseId') houseId: string) {
    return this.ledger.getBalances(houseId);
  }
}

@Controller('v1/payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly ledger: LedgerService) {}

  /** Membership and recipient checks happen in the service against the payment's house (H9). */
  @Post(':paymentId/dispute')
  async dispute(@Req() req: AuthedRequest, @Param('paymentId') paymentId: string) {
    return this.ledger.disputePayment(paymentId, req.userId);
  }
}
