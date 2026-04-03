import { SetMetadata } from '@nestjs/common';
import { BadgeType } from '@prisma/client';

export const REQUIRED_BADGES_KEY = 'requiredBadges';

/**
 * Require at least one of the given badge types to access the route.
 * Use with @UseGuards(BadgeGuard).
 */
export const RequireBadge = (...badgeTypes: BadgeType[]) =>
  SetMetadata(REQUIRED_BADGES_KEY, badgeTypes);
