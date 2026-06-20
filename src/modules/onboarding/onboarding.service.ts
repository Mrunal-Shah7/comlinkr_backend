import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import {
  SetLocationDto,
  SetVibesDto,
  SetInterestsDto,
  SetCommunitiesDto,
  AcceptAgreementDto,
} from './dto';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getVibes() {
    return this.prisma.vibe.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        emoji: true,
      },
    });
  }

  async getInterests() {
    return this.prisma.interest.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        icon: true,
      },
    });
  }

  async getCommunities() {
    return this.prisma.community.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        countryCode: true,
        emoji: true,
      },
    });
  }

  private assertSupportedEnrollmentRegion(country: string) {
    const c = (country || '').trim().toLowerCase();
    const allowed =
      c === 'united states' ||
      c === 'us' ||
      c === 'usa' ||
      c === 'united kingdom' ||
      c === 'uk' ||
      c === 'gb' ||
      c === 'great britain';
    if (!allowed) {
      throw new BadRequestException({
        code: 'REGION_NOT_SUPPORTED',
        message:
          'ComLinkr is currently available in the United States and United Kingdom only.',
      });
    }
  }

  async setLocation(userId: string, dto: SetLocationDto) {
    this.assertSupportedEnrollmentRegion(dto.country);
    await this.prisma.userLocation.upsert({
      where: { userId },
      create: {
        userId,
        country: dto.country,
        countryCode: dto.countryCode,
        dialCode: dto.dialCode,
        state: dto.state,
        city: dto.city,
      },
      update: {
        country: dto.country,
        countryCode: dto.countryCode,
        dialCode: dto.dialCode,
        state: dto.state,
        city: dto.city,
      },
    });
    return { message: 'Location saved' };
  }

  async setVibes(userId: string, dto: SetVibesDto) {
    const vibeIds = dto.vibeIds ?? [];
    if (vibeIds.length > 0) {
      const count = await this.prisma.vibe.count({
        where: { id: { in: vibeIds } },
      });
      if (count !== vibeIds.length) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'One or more invalid vibe IDs',
        });
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        vibes: {
          set: vibeIds.map((id) => ({ id })),
        },
      },
    });
    return { message: 'Vibes saved' };
  }

  async setInterests(userId: string, dto: SetInterestsDto) {
    const interestIds = dto.interestIds;
    const count = await this.prisma.interest.count({
      where: { id: { in: interestIds } },
    });
    if (count !== interestIds.length) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'One or more invalid interest IDs',
      });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        interests: {
          set: interestIds.map((id) => ({ id })),
        },
      },
    });
    return { message: 'Interests saved' };
  }

  async setCommunities(userId: string, dto: SetCommunitiesDto) {
    const communityIds = dto.communityIds ?? [];
    if (communityIds.length > 0) {
      const count = await this.prisma.community.count({
        where: { id: { in: communityIds } },
      });
      if (count !== communityIds.length) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'One or more invalid community IDs',
        });
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        communities: {
          set: communityIds.map((id) => ({ id })),
        },
      },
    });
    return { message: 'Communities saved' };
  }

  async acceptAgreement(userId: string, _dto: AcceptAgreementDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { agreementAcceptedAt: new Date() },
    });
    return { message: 'Agreement accepted' };
  }

  async completeOnboarding(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        location: true,
        vibes: true,
        interests: true,
        communities: true,
      },
    });

    if (!user) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'User not found',
      });
    }

    if (!user.location) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Complete all onboarding steps first. Location is missing.',
      });
    }

    const interestsCount = user.interests?.length ?? 0;
    if (interestsCount === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Select at least one interest.',
      });
    }

    if (!user.agreementAcceptedAt) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Accept the agreement first.',
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
    });

    const userProfile = await this.authService.getUserProfileResponse(userId);

    return {
      message: 'Welcome to ComLinkr!',
      summary: {
        location: {
          city: user.location.city,
          state: user.location.state,
          country: user.location.country,
          countryCode: user.location.countryCode,
          dialCode: user.location.dialCode,
        },
        vibes: (user.vibes ?? []).map((v) => ({
          name: v.name,
          emoji: v.emoji,
        })),
        interests: (user.interests ?? []).map((i) => ({
          name: i.name,
          icon: i.icon,
        })),
        communities: (user.communities ?? []).map((c) => ({
          name: c.name,
          emoji: c.emoji,
        })),
      },
      user: userProfile,
    };
  }
}
