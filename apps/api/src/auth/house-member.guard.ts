import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MembershipService } from './membership.service';
import { UUID_RE } from '../lib/validation';
import type { AuthedRequest } from './auth.guard';

/**
 * The single authorization layer (spec 5.5): every house-scoped route is
 * checked against CURRENT active membership on EVERY request (H9), never
 * against claims baked into a token.
 */
@Injectable()
export class HouseMemberGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const rawHouseId = req.params.houseId;
    const houseId = typeof rawHouseId === 'string' ? rawHouseId : undefined;
    if (!houseId) throw new ForbiddenException('house scope missing');
    // a malformed id can never be a membership; without this it reaches
    // Postgres as a uuid cast error and turns a 403 into a 500 (the WS
    // path learned the same lesson in the Sprint 3 review)
    if (!UUID_RE.test(houseId)) {
      throw new ForbiddenException('You are not a member of this house');
    }
    if (!(await this.membership.isActiveMember(houseId, req.userId))) {
      throw new ForbiddenException('You are not a member of this house');
    }
    return true;
  }
}
