import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

/**
 * Cookie / express-session only (no Bearer JWT).
 * Mobile clients send `Cookie: comlinkr.sid=...` from the login response field `sessionCookie`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();

    if (isOptionalAuth) {
      await this.tryAttachUserFromSession(request);
      return true;
    }

    const attached = await this.tryAttachUserFromSession(request);
    if (!attached) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or not authenticated',
      });
    }
    return true;
  }

  /**
   * Hydrate `request.user` from the session when possible.
   * Returns true if a valid user was attached; false otherwise (never throws).
   */
  private async tryAttachUserFromSession(request: {
    session?: { userId?: string };
    user?: unknown;
  }): Promise<boolean> {
    const userId = request.session?.userId;
    if (!userId) {
      return false;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        deletedAt: true,
        onboardingCompleted: true,
      },
    });

    if (!user) {
      return false;
    }

    const now = new Date();
    if (!user.isActive) {
      if (user.deletedAt && user.deletedAt > now) {
        request.user = user;
        return true;
      }
      return false;
    }

    request.user = user;
    return true;
  }
}
