import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRED_BADGES_KEY } from '../decorators/require-badge.decorator';
import { BadgeType } from '@prisma/client';

@Injectable()
export class BadgeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredBadges = this.reflector.getAllAndOverride<BadgeType[]>(
      REQUIRED_BADGES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredBadges?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        code: 'BADGE_REQUIRED',
        message:
          'You need a verified badge to perform this action. Apply for verification in Settings.',
      });
    }

    const hasBadge = await this.prisma.userBadge.findFirst({
      where: {
        userId,
        badgeType: { in: requiredBadges },
      },
    });

    if (!hasBadge) {
      throw new ForbiddenException({
        code: 'BADGE_REQUIRED',
        message:
          'You need a verified badge to perform this action. Apply for verification in Settings.',
      });
    }

    return true;
  }
}
