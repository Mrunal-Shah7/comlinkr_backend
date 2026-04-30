import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BadgeType,
  BroadcastAudienceType,
  FeedCategory,
  ListingStatus,
  NotificationType,
  Prisma,
  PropertyType,
  SupportTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpoNotificationService } from '../notifications/expo-notification.service';
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import type { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import type { AdminContentQueryDto } from './dto/admin-content-query.dto';
import type { ModerateContentDto } from './dto/moderate-content.dto';
import type { ReviewBadgeApplicationDto } from './dto/review-badge-application.dto';
import type { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import type { CreateAdminPollDto } from './dto/create-admin-poll.dto';
import type { SendBroadcastDto } from './dto/send-broadcast.dto';
import type { ReplyToTicketDto } from './dto/reply-to-ticket.dto';

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
    private readonly expoNotificationService: ExpoNotificationService,
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
    await this.expoNotificationService.removeAllTokensForUser(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'User permanently deleted' };
  }

  async warnUser(adminUserId: string, userId: string, message: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.notificationsService.createNotification({
      userId,
      type: NotificationType.SYSTEM,
      title: 'Account warning',
      body: message,
      referenceType: 'ADMIN_WARN',
      referenceId: adminUserId,
    });
    try {
      await this.expoNotificationService.sendToUsers([userId], 'Account warning', message);
    } catch {
      // Push delivery is best-effort; in-app notification is already stored.
    }
    return { message: 'Warning sent' };
  }

  async grantUserBadge(adminUserId: string, userId: string, badgeType: BadgeType) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.prisma.userBadge.findUnique({
      where: { userId_badgeType: { userId, badgeType } },
    });
    if (existing) {
      throw new BadRequestException('User already has this badge');
    }
    const application = await this.prisma.badgeApplication.create({
      data: {
        userId,
        badgeType,
        status: 'APPROVED',
        fullLegalName: user.fullName || user.username,
        businessPhone: '0000000000',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        adminNotes: 'Granted directly by admin',
      },
    });
    await this.prisma.userBadge.create({
      data: {
        userId,
        badgeType,
        applicationId: application.id,
      },
    });
    const badgeTypeName = BADGE_TYPE_NAMES[badgeType];
    const contentDesc = BADGE_CONTENT_DESC[badgeType];
    await this.notificationsService.createNotification({
      userId,
      type: NotificationType.BADGE_UPDATE,
      title: 'New badge',
      body: `You have been granted the ${badgeTypeName} badge. You can now create ${contentDesc}.`,
      referenceType: 'BADGE_APPLICATION',
      referenceId: application.id,
    });
    return { message: 'Badge granted' };
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
    return { message: dto.status === 'APPROVED' ? 'Application approved.' : 'Application rejected.' };
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
      pendingReports,
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
      this.prisma.listingReport.count({ where: { status: 'PENDING' } }),
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
      reports: { pending: pendingReports },
      badges: { pendingApplications: pendingBadges, totalApproved: totalApprovedBadges },
    };
  }

  async getReports(page = 1, pageSize = 20) {
    return this.getUnifiedReports({ page, pageSize });
  }

  async getFeedPosts(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    category?: FeedCategory;
    published?: boolean;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.FeedPostWhereInput = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.category) where.category = query.category;
    if (query.published !== undefined) where.isPublished = query.published;

    const [data, total] = await Promise.all([
      this.prisma.feedPost.findMany({
        where,
        include: {
          author: {
            select: { id: true, username: true, fullName: true, avatarUrl: true },
          },
          media: { select: { imageUrl: true, order: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.feedPost.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async getTrendingPosts(limit = 20) {
    return this.prisma.feedPost.findMany({
      take: limit,
      orderBy: [{ likesCount: 'desc' }, { commentsCount: 'desc' }],
      include: {
        author: { select: { id: true, username: true, fullName: true } },
      },
    });
  }

  async moderateFeedPost(postId: string, action: 'approve' | 'reject' | 'delete') {
    const post = await this.prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (action === 'delete') {
      await this.prisma.feedPost.delete({ where: { id: postId } });
    } else {
      await this.prisma.feedPost.update({
        where: { id: postId },
        data: { isPublished: action === 'approve' },
      });
    }
    return { message: `Post ${action}d successfully` };
  }

  async dismissReport(_adminUserId: string, reportId: string) {
    const report = await this.prisma.listingReport.findUnique({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status !== 'PENDING') {
      throw new BadRequestException('This report has already been actioned.');
    }
    await this.prisma.listingReport.update({
      where: { id: reportId },
      data: { status: 'DISMISSED' },
    });
    return { message: 'Report dismissed.' };
  }

  async resolveReportAndDeleteListing(_adminUserId: string, reportId: string) {
    const report = await this.prisma.listingReport.findUnique({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status !== 'PENDING') {
      throw new BadRequestException('This report has already been actioned.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (report.targetType === 'HOUSING') {
        try {
          await tx.housingListing.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      } else {
        try {
          await tx.restaurant.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      }

      await tx.listingReport.updateMany({
        where: {
          targetType: report.targetType,
          targetId: report.targetId,
        },
        data: { status: 'RESOLVED' },
      });
    });

    return { message: 'Listing deleted and all associated reports resolved.' };
  }

  async getAdminPolls(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.adminPoll.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          options: { select: { id: true, text: true, votesCount: true, order: true } },
          createdBy: { select: { id: true, username: true } },
        },
      }),
      this.prisma.adminPoll.count(),
    ]);
    return {
      data: data.map((poll) => ({
        ...poll,
        totalVotes: poll.options.reduce((sum, option) => sum + option.votesCount, 0),
      })),
      meta: createPaginationMeta(page, pageSize, total),
    };
  }

  async createAdminPoll(adminUserId: string, dto: CreateAdminPollDto) {
    return this.prisma.$transaction(async (tx) => {
      const poll = await tx.adminPoll.create({
        data: { question: dto.question, createdById: adminUserId, isActive: true },
      });
      await tx.adminPollOption.createMany({
        data: dto.options.map((text, index) => ({
          pollId: poll.id,
          text,
          order: index,
          votesCount: 0,
        })),
      });
      return tx.adminPoll.findUnique({
        where: { id: poll.id },
        include: { options: true, createdBy: { select: { id: true, username: true } } },
      });
    });
  }

  async toggleAdminPoll(pollId: string) {
    const poll = await this.prisma.adminPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('Poll not found');
    return this.prisma.adminPoll.update({
      where: { id: pollId },
      data: { isActive: !poll.isActive },
      include: { options: true },
    });
  }

  async deleteAdminPoll(pollId: string) {
    const poll = await this.prisma.adminPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.prisma.adminPoll.delete({ where: { id: pollId } });
    return { message: 'Poll deleted' };
  }

  async getCommunityQuestions(query: { page?: number; pageSize?: number; search?: string; category?: string }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.CommunityQuestionWhereInput = {};
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };
    if (query.category) where.category = query.category as any;
    const [data, total] = await Promise.all([
      this.prisma.communityQuestion.findMany({
        where,
        include: {
          author: { select: { id: true, username: true, fullName: true } },
          _count: { select: { answers: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.communityQuestion.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async getCommunityNewsPosts(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    category?: FeedCategory;
    published?: boolean;
  }) {
    return this.getFeedPosts(query);
  }

  async moderateCommunityQuestion(questionId: string) {
    const question = await this.prisma.communityQuestion.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');
    await this.prisma.communityQuestion.delete({ where: { id: questionId } });
    return { message: 'Question deleted' };
  }

  async getRoommateProfiles(query: { page?: number; pageSize?: number; search?: string }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.RoommatePreferencesWhereInput = {
      isLooking: true,
      ...(query.search
        ? {
            user: {
              OR: [
                { username: { contains: query.search, mode: 'insensitive' } },
                { fullName: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.roommatePreferences.findMany({
        where,
        include: {
          user: {
            include: { location: true },
          },
        },
        orderBy: { user: { createdAt: 'desc' } },
        skip,
        take: pageSize,
      }),
      this.prisma.roommatePreferences.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async suspendRoommateProfile(userId: string, action: 'suspend' | 'delete') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (action === 'suspend') {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
        this.prisma.roommatePreferences.updateMany({
          where: { userId },
          data: { isLooking: false },
        }),
      ]);
      return { message: 'User suspended and roommate profile hidden' };
    }
    await this.prisma.roommatePreferences.deleteMany({ where: { userId } });
    return { message: 'Roommate profile deleted' };
  }

  async getAdminRestaurants(query: { page?: number; pageSize?: number; search?: string; isVerified?: boolean }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.RestaurantWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { address: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.isVerified !== undefined) where.isVerified = query.isVerified;
    const [data, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        include: {
          owner: { select: { id: true, username: true, fullName: true } },
          _count: { select: { reviews: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.restaurant.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async moderateRestaurant(restaurantId: string, action: 'approve' | 'reject' | 'delete' | 'hide') {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (action === 'delete') {
      await this.prisma.restaurant.delete({ where: { id: restaurantId } });
    } else if (action === 'approve') {
      await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { isVerified: true } });
    } else {
      await this.prisma.restaurant.update({ where: { id: restaurantId }, data: { isVerified: false } });
    }
    return { message: `Restaurant ${action}d successfully` };
  }

  async getAdminListings(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: ListingStatus;
    propertyType?: PropertyType;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.HousingListingWhereInput = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { address: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.propertyType) where.propertyType = query.propertyType;
    const [data, total] = await Promise.all([
      this.prisma.housingListing.findMany({
        where,
        include: {
          owner: { select: { id: true, username: true, fullName: true } },
          _count: { select: { interests: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.housingListing.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async moderateListing(listingId: string, action: 'approve' | 'reject' | 'delete' | 'hide') {
    const listing = await this.prisma.housingListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (action === 'delete') {
      await this.prisma.housingListing.delete({ where: { id: listingId } });
    } else if (action === 'approve') {
      await this.prisma.housingListing.update({
        where: { id: listingId },
        data: { status: 'AVAILABLE' },
      });
    } else {
      await this.prisma.housingListing.update({
        where: { id: listingId },
        data: { status: 'UNLISTED' },
      });
    }
    return { message: `Listing ${action}d successfully` };
  }

  async getAreas() {
    const groups = await this.prisma.userLocation.groupBy({
      by: ['city', 'state', 'country', 'countryCode'],
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
    });
    return groups.map((group) => ({
      city: group.city,
      state: group.state,
      country: group.country,
      countryCode: group.countryCode,
      userCount: group._count.userId,
    }));
  }

  async getUnifiedReports(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const listingReportsPromise = this.prisma.listingReport.findMany({
      where: { status: 'PENDING' },
      include: { reporter: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const contentReportDelegate = (this.prisma as any).contentReport;
    if (!contentReportDelegate) {
      console.warn('ContentReport model not available in deployed schema; returning listing reports only.');
    }
    const contentReportsPromise = contentReportDelegate
      ? contentReportDelegate.findMany({
          include: { reporter: { select: { id: true, username: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]);
    const [listingReports, contentReports] = await Promise.all([
      listingReportsPromise,
      contentReportsPromise,
    ]);
    const listingMapped = await Promise.all(
      listingReports.map(async (report) => {
        const target =
          report.targetType === 'HOUSING'
            ? await this.prisma.housingListing.findUnique({
                where: { id: report.targetId },
                select: { title: true, address: true },
              })
            : await this.prisma.restaurant.findUnique({
                where: { id: report.targetId },
                select: { name: true, address: true },
              });
        return {
          ...report,
          source: 'LISTING_REPORT' as const,
          targetTitle: (target as any)?.title ?? (target as any)?.name ?? null,
          targetAddress: (target as any)?.address ?? null,
        };
      }),
    );
    const contentMapped = (contentReports as any[]).map((report) => ({
      ...report,
      source: 'CONTENT_REPORT' as const,
    }));
    const merged = [...listingMapped, ...contentMapped].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const start = (page - 1) * pageSize;
    return {
      data: merged.slice(start, start + pageSize),
      meta: createPaginationMeta(page, pageSize, merged.length),
    };
  }

  async sendBroadcast(adminUserId: string, dto: SendBroadcastDto) {
    let recipientCount = 0;
    if (dto.audienceType === BroadcastAudienceType.ALL) {
      recipientCount = await this.expoNotificationService.sendToAll(dto.title, dto.body);
    } else if (dto.audienceType === BroadcastAudienceType.CITY) {
      if (!dto.audienceCity) throw new BadRequestException('audienceCity is required for CITY');
      recipientCount = await this.expoNotificationService.sendToCity(
        dto.audienceCity,
        dto.title,
        dto.body,
      );
      const cityUsers = await this.prisma.user.findMany({
        where: { location: { city: { equals: dto.audienceCity, mode: 'insensitive' } } },
        select: { id: true },
      });
      await this.prisma.notification.createMany({
        data: cityUsers.map((user) => ({
          userId: user.id,
          type: NotificationType.SYSTEM,
          title: dto.title,
          body: dto.body,
        })),
      });
    } else {
      if (!dto.audienceUserIds || dto.audienceUserIds.length === 0) {
        throw new BadRequestException('audienceUserIds is required for SELECTIVE');
      }
      recipientCount = await this.expoNotificationService.sendToUsers(
        dto.audienceUserIds,
        dto.title,
        dto.body,
      );
      await this.prisma.notification.createMany({
        data: dto.audienceUserIds.map((userId) => ({
          userId,
          type: NotificationType.SYSTEM,
          title: dto.title,
          body: dto.body,
        })),
      });
    }
    return this.prisma.broadcastNotification.create({
      data: {
        title: dto.title,
        body: dto.body,
        sentById: adminUserId,
        audienceType: dto.audienceType,
        audienceCity: dto.audienceCity ?? null,
        audienceUserIds: dto.audienceUserIds ?? [],
        recipientCount,
      },
    });
  }

  async getBroadcastHistory(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.broadcastNotification.findMany({
        include: { sentBy: { select: { id: true, username: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.broadcastNotification.count(),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async getSupportTickets(query: { page?: number; pageSize?: number; status?: SupportTicketStatus }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status;
    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: { user: { select: { id: true, username: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async replyToSupportTicket(adminUserId: string, ticketId: string, dto: ReplyToTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new BadRequestException('Cannot reply to a closed ticket');
    }
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        adminReply: dto.reply,
        status: dto.close ? SupportTicketStatus.CLOSED : SupportTicketStatus.REPLIED,
        repliedAt: new Date(),
        repliedById: adminUserId,
      },
    });
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
