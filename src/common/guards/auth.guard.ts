import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

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

    const request = context.switchToHttp().getRequest();
    const userId = request.session?.userId as string | undefined;

    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or not authenticated',
      });
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
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or not authenticated',
      });
    }
    const now = new Date();
    if (!user.isActive) {
      if (user.deletedAt && user.deletedAt > now) {
        request.user = user;
        return true;
      }
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or not authenticated',
      });
    }

    request.user = user;
    return true;
  }
}
