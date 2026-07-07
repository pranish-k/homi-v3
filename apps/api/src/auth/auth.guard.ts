import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from './auth.instance';

export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * The single authentication layer (HOMI-2). Validates the Better Auth
 * session on every request; no handler reads auth headers directly
 * (Sprint 1 retro action). Authorization (house membership) is layered
 * separately in HouseMemberGuard and checked per-request (H9).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) throw new UnauthorizedException('Sign in to continue');
    req.userId = session.user.id;
    return true;
  }
}
