import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventRegistrationStatus, SupportTicket } from '@prisma/client'; // SPRINT-38: Keep user event statistics scoped to active registrations after soft cancellation.
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ExpoNotificationService } from '../notifications/expo-notification.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { AchievementDto, UserStatsDto } from './dto/user-response.dto';

const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly expoNotificationService: ExpoNotificationService,
  ) {}

  private buildAvatarUrl(avatarUrl: string | null): string | null {
    return avatarUrl ?? null;
  }

  private async computeStats(userId: string): Promise<UserStatsDto> {
    const [
      postsCount,
      feedSaves,
      eventSaves,
      housingSaves,
      restaurantSaves,
      roommateSaves,
      storySaves,
      communitySaves,
      eventsCount,
    ] = await Promise.all([
      this.prisma.feedPost.count({ where: { authorId: userId } }),
      this.prisma.feedSave.count({ where: { userId } }),
      this.prisma.eventSave.count({ where: { userId } }),
      this.prisma.housingSave.count({ where: { userId } }),
      this.prisma.restaurantSave.count({ where: { userId } }),
      this.prisma.roommateSave.count({ where: { userId } }),
      this.prisma.storySave.count({ where: { userId } }),
      this.prisma.communitySave.count({ where: { userId } }),
      this.prisma.eventAttendee.count({
        where: { userId, status: EventRegistrationStatus.ACTIVE },
      }), // SPRINT-38: Preserve pre-sprint behavior by excluding retained cancelled rows.
    ]);
    const savedCount =
      feedSaves +
      eventSaves +
      housingSaves +
      restaurantSaves +
      roommateSaves +
      storySaves +
      communitySaves;

    let neighborsCount = 0;
    const location = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    if (location?.city) {
      const userCommunities = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { communities: { select: { id: true } } },
      });
      const communityIds = userCommunities?.communities.map((c) => c.id) ?? [];
      if (communityIds.length > 0) {
        const neighbors = await this.prisma.user.findMany({
          where: {
            id: { not: userId },
            isActive: true,
            location: { city: location.city },
            communities: { some: { id: { in: communityIds } } },
          },
          select: { id: true },
        });
        neighborsCount = neighbors.length;
      }
    }

    return { postsCount, savedCount, eventsCount, neighborsCount };
  }

  private async computeAchievements(userId: string): Promise<AchievementDto[]> {
    const [
      housingInterestCount,
      housingListingCount,
      restaurantReviewCount,
      restaurantFavoriteCount,
      connectorConversations,
      feedPostCount,
      eventAttendeeCount,
    ] = await Promise.all([
      this.prisma.housingInterest.count({ where: { userId } }),
      this.prisma.housingListing.count({ where: { ownerId: userId } }),
      this.prisma.restaurantReview.count({ where: { userId } }),
      this.prisma.restaurantFavorite.count({ where: { userId } }),
      this.prisma.conversationMember.count({
        where: { userId, status: 'ACCEPTED' },
      }),
      this.prisma.feedPost.count({ where: { authorId: userId } }),
      this.prisma.eventAttendee.count({
        where: { userId, status: EventRegistrationStatus.ACTIVE },
      }), // SPRINT-38: Do not award attendance achievements for cancelled registrations.
    ]);

    return [
      {
        slug: 'homefinder',
        name: 'Homefinder',
        icon: '🏠',
        earned: housingInterestCount > 0 || housingListingCount > 0,
      },
      {
        slug: 'foodie',
        name: 'Foodie',
        icon: '🍽️',
        earned: restaurantReviewCount > 0 || restaurantFavoriteCount >= 3,
      },
      {
        slug: 'connector',
        name: 'Connector',
        icon: '🤝',
        earned: connectorConversations >= 3,
      },
      {
        slug: 'storyteller',
        name: 'Storyteller',
        icon: '📖',
        earned: feedPostCount >= 3,
      },
      {
        slug: 'explorer',
        name: 'Explorer',
        icon: '🧭',
        earned: eventAttendeeCount >= 3,
      },
    ];
  }

  private formatFullProfile(
    user: {
      id: string;
      email: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
      bio: string | null;
      phoneNumber: string | null;
      role: string;
      onboardingCompleted: boolean;
      createdAt: Date;
      location: {
        country: string;
        countryCode: string;
        dialCode: string;
        state: string;
        city: string;
      } | null;
      vibes: Array<{
        id: string;
        slug: string;
        name: string;
        description: string;
        emoji: string;
      }>;
      interests: Array<{
        id: string;
        slug: string;
        name: string;
        description: string;
        icon: string;
      }>;
      communities: Array<{
        id: string;
        slug: string;
        name: string;
        category: string;
        countryCode: string | null;
        emoji: string;
      }>;
      roommatePreferences: {
        budgetMin: number | null;
        budgetMax: number | null;
        moveInDate: Date | null;
        sleepSchedule: string | null;
        cleanliness: string | null;
        noiseTolerance: string | null;
        petFriendly: boolean;
        smokingAllowed: boolean;
        guestsFrequency: string | null;
        workFromHome: boolean;
        aboutMe: string | null;
        isLooking: boolean;
      } | null;
      userBadges: Array<{ badgeType: string; grantedAt: Date }>;
    },
    stats: UserStatsDto,
    achievements: AchievementDto[],
  ) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.fullName,
      avatarUrl: this.buildAvatarUrl(user.avatarUrl),
      bio: user.bio,
      phoneNumber: user.phoneNumber,
      role: user.role,
      onboardingDone: user.onboardingCompleted,
      createdAt: user.createdAt,
      location: user.location
        ? {
            country: user.location.country,
            countryCode: user.location.countryCode,
            dialCode: user.location.dialCode,
            state: user.location.state,
            city: user.location.city,
          }
        : null,
      vibes: user.vibes ?? [],
      interests: user.interests ?? [],
      communities: user.communities ?? [],
      roommatePreferences: user.roommatePreferences
        ? {
            budgetMin: user.roommatePreferences.budgetMin,
            budgetMax: user.roommatePreferences.budgetMax,
            moveInDate: user.roommatePreferences.moveInDate,
            sleepSchedule: user.roommatePreferences.sleepSchedule,
            cleanliness: user.roommatePreferences.cleanliness,
            noiseTolerance: user.roommatePreferences.noiseTolerance,
            petFriendly: user.roommatePreferences.petFriendly,
            smokingAllowed: user.roommatePreferences.smokingAllowed,
            guestsFrequency: user.roommatePreferences.guestsFrequency,
            workFromHome: user.roommatePreferences.workFromHome,
            aboutMe: user.roommatePreferences.aboutMe,
            isLooking: user.roommatePreferences.isLooking,
          }
        : null,
      badges:
        user.userBadges?.map((b) => ({
          badgeType: b.badgeType,
          grantedAt: b.grantedAt,
        })) ?? [],
      stats,
      achievements,
    };
  }

  private formatPublicProfile(
    user: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
      bio: string | null;
      role: string;
      createdAt: Date;
      location: { city: string } | null;
      vibes: unknown[];
      interests: unknown[];
      communities: unknown[];
      roommatePreferences: {
        isLooking: boolean;
        budgetMin: number | null;
        budgetMax: number | null;
        moveInDate: Date | null;
        sleepSchedule: string | null;
        cleanliness: string | null;
        noiseTolerance: string | null;
        petFriendly: boolean;
        smokingAllowed: boolean;
        guestsFrequency: string | null;
        workFromHome: boolean;
        aboutMe: string | null;
      } | null;
      userBadges: Array<{ badgeType: string; grantedAt: Date }>;
    },
    privacySettings: { publicProfile?: boolean; showLocation?: boolean } | null,
    stats: UserStatsDto,
  ) {
    const base = {
      id: user.id,
      username: user.username,
      name: user.fullName,
      avatarUrl: this.buildAvatarUrl(user.avatarUrl),
      bio: user.bio,
      role: user.role,
      createdAt: user.createdAt,
      badges:
        user.userBadges?.map((b) => ({
          badgeType: b.badgeType,
          grantedAt: b.grantedAt,
        })) ?? [],
    };

    const isPublic = privacySettings?.publicProfile !== false;
    if (!isPublic) {
      return base;
    }

    const showLocation = privacySettings?.showLocation !== false;

    return {
      ...base,
      location:
        showLocation && user.location
          ? { city: user.location.city }
          : undefined,
      vibes: user.vibes ?? [],
      interests: user.interests ?? [],
      communities: user.communities ?? [],
      stats,
      roommatePreferences:
        user.roommatePreferences && user.roommatePreferences.isLooking
          ? {
              budgetMin: user.roommatePreferences.budgetMin,
              budgetMax: user.roommatePreferences.budgetMax,
              moveInDate: user.roommatePreferences.moveInDate,
              sleepSchedule: user.roommatePreferences.sleepSchedule,
              cleanliness: user.roommatePreferences.cleanliness,
              noiseTolerance: user.roommatePreferences.noiseTolerance,
              petFriendly: user.roommatePreferences.petFriendly,
              smokingAllowed: user.roommatePreferences.smokingAllowed,
              guestsFrequency: user.roommatePreferences.guestsFrequency,
              workFromHome: user.roommatePreferences.workFromHome,
              aboutMe: user.roommatePreferences.aboutMe,
              isLooking: user.roommatePreferences.isLooking,
            }
          : undefined,
    };
  }

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        location: true,
        vibes: true,
        interests: true,
        communities: true,
        roommatePreferences: true,
        userBadges: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const [stats, achievements] = await Promise.all([
      this.computeStats(userId),
      this.computeAchievements(userId),
    ]);

    return this.formatFullProfile(user, stats, achievements);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (dto.username && dto.username !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException({
          code: 'AUTH_USERNAME_EXISTS',
          message: 'Username already in use',
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      });
    }

    return this.getMyProfile(userId);
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ avatarUrl: string }> {
    if (file.size > AVATAR_MAX_SIZE) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Avatar must be under 5MB',
      });
    }
    if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'FILE_INVALID_TYPE',
        message: 'Avatar must be JPEG, PNG, or WebP',
      });
    }

    const extension = StorageService.extensionFromMime(file.mimetype);
    const avatarUrl = await this.storageService.uploadPublicFile(
      file.buffer,
      file.mimetype,
      `avatars/${userId}`,
      randomUUID(),
      extension,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    if (user?.avatarUrl) {
      try {
        await this.storageService.deleteFile(user.avatarUrl);
      } catch {
        // ignore if file already gone
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    return { avatarUrl };
  }

  async removeAvatar(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    if (!user?.avatarUrl) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No avatar to remove',
      });
    }
    try {
      await this.storageService.deleteFile(user.avatarUrl);
    } catch {
      // still clear the reference
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    return { message: 'Avatar removed' };
  }

  async getUserById(requestingUserId: string, targetUserId: string) {
    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: requestingUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: requestingUserId },
        ],
      },
    });
    if (blocked) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId, isActive: true },
      include: {
        location: true,
        vibes: true,
        interests: true,
        communities: true,
        roommatePreferences: true,
        userBadges: true,
        privacySettings: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const stats = await this.computeStats(targetUserId);
    return this.formatPublicProfile(user, user.privacySettings ?? null, stats);
  }

  async getUserByUsername(requestingUserId: string, username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    return this.getUserById(requestingUserId, user.id);
  }

  async getMyStats(userId: string): Promise<UserStatsDto> {
    return this.computeStats(userId);
  }

  async getMyAchievements(userId: string): Promise<AchievementDto[]> {
    return this.computeAchievements(userId);
  }

  async registerPushToken(userId: string, token: string): Promise<void> {
    await this.expoNotificationService.registerToken(userId, token);
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    const pushToken = await this.prisma.pushToken.findUnique({
      where: { token },
      select: { userId: true },
    });
    if (!pushToken || pushToken.userId !== userId) {
      return;
    }
    await this.expoNotificationService.removeToken(token);
  }

  async createSupportTicket(
    userId: string,
    dto: CreateSupportTicketDto,
  ): Promise<SupportTicket> {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        message: dto.message,
        status: 'OPEN',
      },
    });
  }

  async getMySupportTickets(userId: string): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
