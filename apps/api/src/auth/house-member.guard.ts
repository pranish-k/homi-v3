import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MembershipService } from './membership.service';
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
    if (!(await this.membership.isActiveMember(houseId, req.userId))) {
      throw new ForbiddenException('You are not a member of this house');
    }
    return true;
  }
}
