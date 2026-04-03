import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BadgeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import type { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import type { AdminContentQueryDto } from './dto/admin-content-query.dto';
import type { ModerateContentDto } from './dto/moderate-content.dto';
import type { ReviewBadgeApplicationDto } from './dto/review-badge-application.dto';
import type { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

const BADGE_TYPE_NAMES: Record<BadgeType, string> = {
  LANDLORD: 'Verified Landlord',
  RESTAURANT_OWNER: 'Verified Restaurant Owner',
  AGENCY: 'Verified Agency',
  LOCAL_REVIEWER: 'Local Reviewer',
};
const BADGE_CONTENT_DESC: Record<BadgeType, string> = {
  LANDLORD: 'housing listings',
  RESTAURANT_OWNER: 'restaurant listings',
  AGENCY: 'agency listings',
  LOCAL_REVIEWER: 'community reviews',
};

const PLATFORM_DEFAULTS = { maintenanceMode: false, registrationEnabled: true, maxFileUploadMB: 10 };

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getUsers(query: AdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {};
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.role) where.role = query.role;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          location: { select: { city: true, country: true } },
          authProviders: { select: { provider: true } },
          userBadges: { select: { badgeType: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const data = items.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      isActive: u.isActive,
      deletedAt: u.deletedAt,
      createdAt: u.createdAt,
      location: u.location,
      providers: u.authProviders.map((p) => p.provider),
      badges: u.userBadges.map((b) => b.badgeType),
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        location: true,
        vibes: true,
        interests: true,
        communities: true,
        roommatePreferences: true,
        authProviders: { select: { provider: true, createdAt: true } },
        userBadges: true,
        badgeApplications: { orderBy: { createdAt: 'desc' }, take: 5 },
        privacySettings: true,
        notificationPreference: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const [feedCount, housingCount, restaurantCount, conversationCount, eventCount] = await Promise.all([
      this.prisma.feedPost.count({ where: { authorId: userId } }),
      this.prisma.housingListing.count({ where: { ownerId: userId } }),
      this.prisma.restaurant.count({ where: { ownerId: userId } }),
      this.prisma.conversationMember.count({ where: { userId } }),
      this.prisma.event.count({ where: { authorId: userId } }),
    ]);
    return {
      ...user,
      counts: { feedPosts: feedCount, housingListings: housingCount, restaurants: restaurantCount, conversations: conversationCount, events: eventCount },
    };
  }

  async updateUser(userId: string, dto: UpdateUserAdminDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const data: Prisma.UserUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return updated;
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'User permanently deleted' };
  }

  async getContent(query: AdminContentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const types = query.contentType
      ? [query.contentType]
      : (['feed_posts', 'housing', 'restaurants'] as const);

    const results: Array<{ id: string; contentType: string; title?: string; author?: any; createdAt: Date; [k: string]: any }> = [];
    if (types.includes('feed_posts')) {
      const where: Prisma.FeedPostWhereInput = {};
      if (search) where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }];
      const posts = await this.prisma.feedPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: { author: { select: { id: true, username: true, fullName: true } } },
      });
      results.push(...posts.map((p) => ({ ...p, contentType: 'feed_post' as const, title: p.title })));
    }
    if (types.includes('housing')) {
      const where: Prisma.HousingListingWhereInput = {};
      if (search) where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const listings = await this.prisma.housingListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: { owner: { select: { id: true, username: true, fullName: true } } },
      });
      results.push(...listings.map((l) => ({ ...l, contentType: 'housing_listing' as const, title: l.title, author: l.owner })));
    }
    if (types.includes('restaurants')) {
      const where: Prisma.RestaurantWhereInput = {};
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const restaurants = await this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: { owner: { select: { id: true, username: true, fullName: true } } },
      });
      results.push(...restaurants.map((r) => ({ ...r, contentType: 'restaurant' as const, title: r.name, author: r.owner })));
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = results.length;
    const data = types.length === 1 ? results : results.slice(skip, skip + limit);
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async moderateContent(contentId: string, dto: ModerateContentDto) {
    if (dto.contentType === 'feed_post') {
      const post = await this.prisma.feedPost.findUnique({ where: { id: contentId } });
      if (!post) throw new NotFoundException('Content not found');
      if (dto.action === 'approve') await this.prisma.feedPost.update({ where: { id: contentId }, data: { isPublished: true } });
      else await this.prisma.feedPost.update({ where: { id: contentId }, data: { isPublished: false } });
    } else if (dto.contentType === 'housing_listing') {
      const listing = await this.prisma.housingListing.findUnique({ where: { id: contentId } });
      if (!listing) throw new NotFoundException('Content not found');
      if (dto.action === 'approve') await this.prisma.housingListing.update({ where: { id: contentId }, data: { status: 'AVAILABLE' } });
      else await this.prisma.housingListing.update({ where: { id: contentId }, data: { status: 'UNLISTED' } });
    } else if (dto.contentType === 'restaurant') {
      const restaurant = await this.prisma.restaurant.findUnique({ where: { id: contentId } });
      if (!restaurant) throw new NotFoundException('Content not found');
      if (dto.action === 'approve') await this.prisma.restaurant.update({ where: { id: contentId }, data: { isVerified: true } });
      else await this.prisma.restaurant.update({ where: { id: contentId }, data: { isVerified: false } });
    }
    return { message: `Content ${dto.action}d successfully` };
  }

  async getBadgeApplications(query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.badgeApplication.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        include: {
          applicant: { select: { id: true, username: true, fullName: true, email: true } },
          documents: true,
        },
      }),
      this.prisma.badgeApplication.count({ where: { status: 'PENDING' } }),
    ]);
    const data = items.map((a) => ({
      ...a,
      documents: a.documents.map((d) => ({ id: d.id, documentType: d.documentType, createdAt: d.createdAt })),
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async reviewBadgeApplication(adminUserId: string, applicationId: string, dto: ReviewBadgeApplicationDto) {
    const application = await this.prisma.badgeApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'PENDING') {
      throw new BadRequestException('This application has already been reviewed.');
    }
    await this.prisma.badgeApplication.update({
      where: { id: applicationId },
      data: {
        status: dto.status,
        adminNotes: dto.adminNotes ?? null,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      },
    });
    if (dto.status === 'APPROVED') {
      await this.prisma.userBadge.upsert({
        where: { userId_badgeType: { userId: application.userId, badgeType: application.badgeType } },
        create: { userId: application.userId, badgeType: application.badgeType, applicationId: application.id },
        update: {},
      });
    }
    const badgeTypeName = BADGE_TYPE_NAMES[application.badgeType];
    const contentDesc = BADGE_CONTENT_DESC[application.badgeType];
    this.notificationsService.createNotification({
      userId: application.userId,
      type: 'BADGE_UPDATE',
      title: dto.status === 'APPROVED' ? 'Badge application approved!' : 'Badge application update',
      body:
        dto.status === 'APPROVED'
          ? `Your ${badgeTypeName} badge has been approved! You can now create ${contentDesc}.`
          : `Your ${badgeTypeName} badge application was not approved. ${dto.adminNotes || 'Check the application for details.'}`,
      referenceType: 'BADGE_APPLICATION',
      referenceId: application.id,
    });
    return { message: dto.status === 'APPROVED' ? 'Application approved' : 'Application rejected' };
  }

  async getAnalytics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalUsers,
      activeUsers,
      newThisMonth,
      newThisWeek,
      feedPosts,
      housingListings,
      restaurants,
      events,
      activeStories,
      activeChallenges,
      communityQuestions,
      totalLikes,
      totalComments,
      totalMessages,
      totalReviews,
      pendingBadges,
      totalApprovedBadges,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.feedPost.count(),
      this.prisma.housingListing.count(),
      this.prisma.restaurant.count(),
      this.prisma.event.count(),
      this.prisma.story.count({ where: { expiresAt: { gt: now } } }),
      this.prisma.challenge.count({ where: { status: 'ACTIVE' } }),
      this.prisma.communityQuestion.count(),
      this.prisma.feedLike.count(),
      this.prisma.feedComment.count(),
      this.prisma.message.count(),
      this.prisma.restaurantReview.count(),
      this.prisma.badgeApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.userBadge.count(),
    ]);
    return {
      users: { total: totalUsers, active: activeUsers, newThisMonth, newThisWeek },
      content: {
        feedPosts,
        housingListings,
        restaurants,
        events,
        stories: activeStories,
        challenges: activeChallenges,
        communityQuestions,
      },
      engagement: { totalLikes, totalComments, totalMessages, totalReviews },
      badges: { pendingApplications: pendingBadges, totalApproved: totalApprovedBadges },
    };
  }

  async getReports() {
    const [unpublishedPosts, unlistedListings] = await Promise.all([
      this.prisma.feedPost.findMany({
        where: { isPublished: false },
        include: { author: { select: { id: true, username: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.housingListing.findMany({
        where: { status: 'UNLISTED' },
        include: { owner: { select: { id: true, username: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
    ]);
    const data = [
      ...unpublishedPosts.map((p) => ({ id: p.id, contentType: 'feed_post', title: p.title, author: p.author, updatedAt: p.updatedAt })),
      ...unlistedListings.map((l) => ({ id: l.id, contentType: 'housing_listing', title: l.title, author: l.owner, updatedAt: l.updatedAt })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return data;
  }

  async getPlatformSettings() {
    const records = await this.prisma.platformSettings.findMany();
    const out: Record<string, unknown> = { ...PLATFORM_DEFAULTS };
    for (const r of records) {
      try {
        out[r.key] = r.key === 'maxFileUploadMB' ? parseInt(r.value, 10) : JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  }

  async updatePlatformSettings(dto: UpdatePlatformSettingsDto) {
    const keys = ['maintenanceMode', 'registrationEnabled', 'maxFileUploadMB'] as const;
    for (const key of keys) {
      const v = dto[key];
      if (v !== undefined) {
        await this.prisma.platformSettings.upsert({
          where: { key },
          create: { key, value: JSON.stringify(v) },
          update: { value: JSON.stringify(v) },
        });
      }
    }
    return this.getPlatformSettings();
  }
}
