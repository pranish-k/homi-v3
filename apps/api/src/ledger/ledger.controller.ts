import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { HouseMemberGuard } from '../auth/house-member.guard';
import { parseBody, UUID_RE } from '../lib/validation';
import { BillsService } from './bills.service';
import { LedgerService } from './ledger.service';

// H3 bound: bigint columns hold more than Number can represent safely;
// zod's .int() alone accepts 1e100. $100M in cents is a generous ceiling
// for a household ledger and keeps every stored amount a safe integer.
const MAX_AMOUNT_CENTS = 10_000_000_000;

const createExpenseSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  currency: z.string().length(3).toUpperCase().optional(),
  paidBy: z.string().uuid(),
  category: z.string().max(50).optional(),
  isStaple: z.boolean().optional(),
  mode: z.enum(['equal', 'exact', 'percent', 'room_weighted']),
  participants: z.array(z.string().uuid()).min(1).max(50),
  exactCents: z
    .record(z.string().uuid(), z.number().int().nonnegative().max(MAX_AMOUNT_CENTS))
    .optional(),
  weightsBp: z.record(z.string().uuid(), z.number().int().nonnegative().max(10000)).optional(),
});

const editExpenseSchema = createExpenseSchema.omit({ currency: true });

const recordPaymentSchema = z.object({
  toUser: z.string().uuid(),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  currency: z.string().length(3).toUpperCase().optional(),
  method: z.enum(['venmo', 'zelle', 'cash_app', 'cash', 'other']).optional(),
});

// exact/percent recurring bills need a participants-drift story
// (who owes what when someone joins mid-template?); equal and
// room_weighted derive participants at posting time, so they are safe.
const createBillSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  splitMode: z.enum(['equal', 'room_weighted']),
  cadence: z.enum(['monthly', 'weekly']),
  cadenceDay: z.string().min(1).max(10),
  ownerId: z.string().uuid().optional(),
});

const setBillActiveSchema = z.object({ active: z.boolean() });

@Controller('v1/houses/:houseId')
@UseGuards(AuthGuard, HouseMemberGuard)
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly bills: BillsService,
  ) {}

  /** HOMI-13: creating a template is creating every future posting - idempotency-keyed (H1). */
  @Post('bills')
  async createBill(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('houseId') houseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header (UUID) is required on money mutations');
    }
    const input = parseBody(createBillSchema, body);
    const result = await this.bills.createBill(houseId, req.userId, idempotencyKey, input);
    res.status(result.status).json(result.body);
  }

  @Get('bills')
  async listBills(@Param('houseId') houseId: string) {
    return this.bills.listBills(houseId);
  }

  @Patch('bills/:billId')
  async setBillActive(
    @Req() req: AuthedRequest,
    @Param('houseId') houseId: string,
    @Param('billId') billId: string,
    @Body() body: unknown,
  ) {
    if (!UUID_RE.test(billId)) throw new BadRequestException('billId must be a UUID');
    const input = parseBody(setBillActiveSchema, body);
    return this.bills.setActive(houseId, billId, req.userId, input.active);
  }

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

  /** HOMI-16: unified expenses + payments, newest first, keyset cursor. */
  @Get('ledger')
  async getLedger(
    @Param('houseId') houseId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const limit = rawLimit === undefined ? 30 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }
    return this.ledger.getLedger(houseId, { cursor, limit });
  }
}

@Controller('v1/payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly ledger: LedgerService) {}

  /** Membership and recipient checks happen in the service against the payment's house (H9). */
  @Post(':paymentId/dispute')
  async dispute(@Req() req: AuthedRequest, @Param('paymentId') paymentId: string) {
    // a non-UUID id must 400 here, not surface as a Postgres cast error
    if (!UUID_RE.test(paymentId)) throw new BadRequestException('paymentId must be a UUID');
    return this.ledger.disputePayment(paymentId, req.userId);
  }

  /** HOMI-29: the recipient confirms a disputed payment did happen; it counts in balances again. */
  @Post(':paymentId/resolve')
  async resolve(@Req() req: AuthedRequest, @Param('paymentId') paymentId: string) {
    if (!UUID_RE.test(paymentId)) throw new BadRequestException('paymentId must be a UUID');
    return this.ledger.resolvePayment(paymentId, req.userId);
  }
}

@Controller('v1/expenses')
@UseGuards(AuthGuard)
export class ExpensesController {
  constructor(private readonly ledger: LedgerService) {}

  /** HOMI-12: full respec; membership is checked in the service against the expense's house (H9). */
  @Put(':expenseId')
  async edit(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('expenseId') expenseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header (UUID) is required on money mutations');
    }
    if (!UUID_RE.test(expenseId)) throw new BadRequestException('expenseId must be a UUID');
    const input = parseBody(editExpenseSchema, body);
    const result = await this.ledger.editExpense(expenseId, req.userId, idempotencyKey, input);
    res.status(result.status).json(result.body);
  }
}
