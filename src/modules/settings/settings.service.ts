import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateAccountDto } from './dto/update-account.dto';
import type { UpdatePrivacyDto } from './dto/update-privacy.dto';
import type { BlockUserDto } from './dto/block-user.dto';
import type { UpdateCityDto } from './dto/update-city.dto';
import type { UpdateCultureDto } from './dto/update-culture.dto';

const PRIVACY_DEFAULTS = {
  publicProfile: true,
  showLocation: true,
  activityStatus: false,
};
const BCRYPT_ROUNDS = 12;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        username: true,
        fullName: true,
        authProviders: { select: { provider: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException();
    return {
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      providers: user.authProviders.map((p) => ({
        provider: p.provider,
        linkedAt: p.createdAt,
      })),
    };
  }

  async updateAccount(userId: string, dto: UpdateAccountDto) {
    const localProvider = await this.prisma.authProvider.findUnique({
      where: { userId_provider: { userId, provider: 'LOCAL' } },
      select: { passwordHash: true },
    });
    if (!localProvider?.passwordHash) {
      throw new BadRequestException(
        'No password set. Sign in with Google or Apple to manage your account.',
      );
    }
    const match = await bcrypt.compare(
      dto.currentPassword,
      localProvider.passwordHash,
    );
    if (!match) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Current password is incorrect.',
      });
    }
    if (!dto.newEmail && !dto.newPassword && !dto.newUsername) {
      throw new BadRequestException('Provide at least one field to update.');
    }

    if (dto.newEmail) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.newEmail },
      });
      if (existing)
        throw new ConflictException({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'Email already in use.',
        });
      await this.prisma.user.update({
        where: { id: userId },
        data: { email: dto.newEmail },
      });
    }
    if (dto.newUsername) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.newUsername },
      });
      if (existing)
        throw new ConflictException({
          code: 'AUTH_USERNAME_EXISTS',
          message: 'Username already in use.',
        });
      await this.prisma.user.update({
        where: { id: userId },
        data: { username: dto.newUsername },
      });
    }
    if (dto.newPassword) {
      const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
      await this.prisma.authProvider.update({
        where: { userId_provider: { userId, provider: 'LOCAL' } },
        data: { passwordHash: hash },
      });
    }
    return { message: 'Account updated successfully' };
  }

  async getPrivacy(userId: string) {
    const prefs = await this.prisma.privacySettings.findUnique({
      where: { userId },
    });
    return prefs ?? PRIVACY_DEFAULTS;
  }

  async updatePrivacy(userId: string, dto: UpdatePrivacyDto) {
    const data: Record<string, boolean> = { ...PRIVACY_DEFAULTS };
    if (dto.publicProfile !== undefined) data.publicProfile = dto.publicProfile;
    if (dto.showLocation !== undefined) data.showLocation = dto.showLocation;
    if (dto.activityStatus !== undefined)
      data.activityStatus = dto.activityStatus;
    const updated = await this.prisma.privacySettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return updated;
  }

  async getBlockedUsers(userId: string) {
    const list = await this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });
    return list.map((b) => ({
      id: b.id,
      user: {
        id: b.blocked.id,
        username: b.blocked.username,
        name: b.blocked.fullName,
        avatarUrl: b.blocked.avatarUrl ?? null,
      },
      blockedAt: b.createdAt,
    }));
  }

  async blockUser(userId: string, dto: BlockUserDto) {
    const target = await this.prisma.user.findFirst({
      where: { id: dto.userId, isActive: true, deletedAt: null },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (dto.userId === userId)
      throw new BadRequestException('You cannot block yourself.');
    const existing = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: { blockerId: userId, blockedId: dto.userId },
      },
    });
    if (existing) return { message: 'User is already blocked' };

    await this.prisma.$transaction(async (tx) => {
      await tx.blockedUser.create({
        data: { blockerId: userId, blockedId: dto.userId },
      });
      const blockerMemberships = await tx.conversationMember.findMany({
        where: { userId },
        select: { conversationId: true },
      });
      for (const m of blockerMemberships) {
        const otherInConv = await tx.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: m.conversationId,
              userId: dto.userId,
            },
          },
        });
        if (otherInConv) {
          await tx.conversationMember.updateMany({
            where: { conversationId: m.conversationId, userId },
            data: { status: 'BLOCKED' },
          });
        }
      }
    });
    return { message: 'User blocked' };
  }

  async unblockUser(userId: string, targetUserId: string) {
    const deleted = await this.prisma.blockedUser.deleteMany({
      where: { blockerId: userId, blockedId: targetUserId },
    });
    return {
      message: deleted.count ? 'User unblocked' : 'User was not blocked',
    };
  }

  async updateCity(userId: string, dto: UpdateCityDto) {
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
    return { message: 'City updated' };
  }

  async updateCulture(userId: string, dto: UpdateCultureDto) {
    if (
      !dto.vibeIds?.length &&
      !dto.interestIds?.length &&
      !dto.communityIds?.length
    ) {
      throw new BadRequestException(
        'Provide at least one of vibeIds, interestIds, or communityIds.',
      );
    }
    if (dto.interestIds?.length === 0) {
      throw new BadRequestException('At least one interest is required.');
    }
    if (dto.vibeIds?.length) {
      const count = await this.prisma.vibe.count({
        where: { id: { in: dto.vibeIds } },
      });
      if (count !== dto.vibeIds.length)
        throw new BadRequestException('Invalid vibe ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { vibes: { set: dto.vibeIds.map((id) => ({ id })) } },
      });
    }
    if (dto.interestIds?.length) {
      const count = await this.prisma.interest.count({
        where: { id: { in: dto.interestIds } },
      });
      if (count !== dto.interestIds.length)
        throw new BadRequestException('Invalid interest ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { interests: { set: dto.interestIds.map((id) => ({ id })) } },
      });
    }
    if (dto.communityIds?.length) {
      const count = await this.prisma.community.count({
        where: { id: { in: dto.communityIds } },
      });
      if (count !== dto.communityIds.length)
        throw new BadRequestException('Invalid community ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { communities: { set: dto.communityIds.map((id) => ({ id })) } },
      });
    }
    return { message: 'Preferences updated' };
  }

  async requestAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (!user) throw new NotFoundException();
    if (user.isActive === false && user.deletedAt != null) {
      throw new BadRequestException('Account deletion already requested.');
    }
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 15);
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, deletedAt: deletionDate },
    });
    return {
      message: 'Account scheduled for deletion',
      deletionDate: deletionDate.toISOString(),
    };
  }

  async cancelDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (
      !user ||
      user.isActive !== false ||
      !user.deletedAt ||
      user.deletedAt <= new Date()
    ) {
      throw new BadRequestException('No pending account deletion to cancel.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true, deletedAt: null },
    });
    return { message: 'Account deletion cancelled. Welcome back!' };
  }
}
