import {
  BadRequestException,
  ForbiddenException, // SPRINT-35: enforce active administrator status inside state-changing service methods
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
import { ConfigService } from '@nestjs/config'; // SPRINT-35: resolve the configured session lifetime for activity approximation
import { RedisService } from '../../redis/redis.service'; // SPRINT-35: enumerate and terminate Redis-backed sessions
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
import type { AdminSessionsQueryDto } from './dto/admin-sessions-query.dto'; // SPRINT-35: type paginated session-list filters

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

const PLATFORM_DEFAULTS = {
  maintenanceMode: false,
  registrationEnabled: true,
  maxFileUploadMB: 10,
};

const SESSION_REDIS_PREFIX = 'sess:'; // SPRINT-35: match connect-redis's configured default session key prefix
const SESSION_SCAN_CEILING = 2000; // SPRINT-35: bound production Redis enumeration work
const SESSION_SCAN_COUNT = 100; // SPRINT-35: request small incremental SCAN batches

type StoredSession = { // SPRINT-35: model the subset of serialized express-session data needed by admins
  userId?: string; // SPRINT-35: identify authenticated sessions and skip anonymous entries
  provider?: string; // SPRINT-35: expose the authentication provider recorded at login
}; // SPRINT-35: complete stored session payload subset

type ScannedSession = { // SPRINT-35: retain Redis key metadata before resolving users
  key: string; // SPRINT-35: preserve the full Redis key for termination
  sessionId: string; // SPRINT-35: expose the identifier without the storage prefix
  userId: string; // SPRINT-35: batch-resolve the associated user
  provider: string | null; // SPRINT-35: tolerate legacy sessions without provider metadata
  ttlSeconds: number; // SPRINT-35: expose the remaining Redis lifetime
}; // SPRINT-35: complete scanned session representation

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly expoNotificationService: ExpoNotificationService,
    private readonly redis: RedisService, // SPRINT-35: reuse the application's injectable Redis connection
    private readonly configService: ConfigService, // SPRINT-35: reuse established session lifetime configuration
  ) {}

  private async assertActiveAdmin(adminUserId: string): Promise<void> { // SPRINT-35: provide defence in depth behind the controller roles guard
    const admin = await this.prisma.user.findUnique({ // SPRINT-35: reload current role and active state from the authoritative database
      where: { id: adminUserId }, // SPRINT-35: resolve the acting administrator by authenticated user ID
      select: { role: true, isActive: true }, // SPRINT-35: fetch only fields required for authorization
    }); // SPRINT-35: complete acting-user lookup
    if (!admin || admin.role !== 'ADMIN' || !admin.isActive) { // SPRINT-35: deny missing, demoted, or deactivated actors
      throw new ForbiddenException({ // SPRINT-35: return the same stable forbidden contract as RolesGuard
        code: 'FORBIDDEN', // SPRINT-35: preserve the platform authorization error code
        message: 'Forbidden', // SPRINT-35: avoid leaking account state
      }); // SPRINT-35: complete defence-in-depth rejection
    } // SPRINT-35: finish active-admin validation
  } // SPRINT-35: complete reusable service authorization check

  private getConfiguredSessionLifetimeSeconds(): number { // SPRINT-35: mirror express-session's configured cookie lifetime
    const configuredMilliseconds = Number( // SPRINT-35: parse the established millisecond environment value
      this.configService.get<string>('SESSION_MAX_AGE', '604800000'), // SPRINT-35: preserve the seven-day application default
    ); // SPRINT-35: complete session lifetime lookup
    const safeMilliseconds = // SPRINT-35: prevent invalid configuration from corrupting activity estimates
      Number.isFinite(configuredMilliseconds) && configuredMilliseconds > 0 // SPRINT-35: accept only a positive finite lifetime
        ? configuredMilliseconds // SPRINT-35: retain valid configured milliseconds
        : 604800000; // SPRINT-35: fall back to the same seven-day session default
    return Math.floor(safeMilliseconds / 1000); // SPRINT-35: convert Redis TTL comparisons to seconds
  } // SPRINT-35: complete session lifetime resolver

  private async scanAuthenticatedSessions( // SPRINT-35: enumerate Redis sessions incrementally without blocking the server
    userIdFilter?: string, // SPRINT-35: optionally retain sessions for one target user only
  ): Promise<{ sessions: ScannedSession[]; truncated: boolean }> { // SPRINT-35: return parsed sessions plus scan ceiling state
    const client = this.redis.getClient(); // SPRINT-35: reuse the session store's Redis connection
    const keys = new Set<string>(); // SPRINT-35: remove duplicates permitted by Redis SCAN semantics
    let cursor = '0'; // SPRINT-35: begin cursor-based Redis enumeration
    let truncated = false; // SPRINT-35: report whether the two-thousand-key safety ceiling was reached
    do { // SPRINT-35: continue until Redis returns to the zero cursor
      const result = await client.scan(cursor, { // SPRINT-35: request one non-blocking incremental key batch
        MATCH: `${SESSION_REDIS_PREFIX}*`, // SPRINT-35: restrict enumeration to connect-redis session keys
        COUNT: SESSION_SCAN_COUNT, // SPRINT-35: keep each server operation bounded
      }); // SPRINT-35: complete incremental SCAN request
      cursor = result.cursor; // SPRINT-35: advance to Redis's next cursor
      for (const key of result.keys) { // SPRINT-35: collect each session key from this batch
        keys.add(key); // SPRINT-35: avoid duplicate work when SCAN repeats a key
        if (keys.size >= SESSION_SCAN_CEILING) { // SPRINT-35: stop at the documented production safety ceiling
          truncated = true; // SPRINT-35: tell callers that more keys may exist
          break; // SPRINT-35: stop collecting this batch
        } // SPRINT-35: complete ceiling check
      } // SPRINT-35: finish current SCAN batch collection
      if (truncated) break; // SPRINT-35: avoid further Redis scans after reaching the ceiling
    } while (cursor !== '0'); // SPRINT-35: terminate after a complete cursor cycle

    const parsed = await Promise.all( // SPRINT-35: read session payloads and TTLs without serial round trips
      [...keys].map(async (key): Promise<ScannedSession | null> => { // SPRINT-35: parse each bounded session key independently
        const [raw, ttlSeconds] = await Promise.all([ // SPRINT-35: pipeline-independent concurrent reads per key
          client.get(key), // SPRINT-35: retrieve connect-redis's JSON session payload
          client.ttl(key), // SPRINT-35: retrieve remaining whole-second lifetime
        ]); // SPRINT-35: complete payload and TTL reads
        if (!raw || ttlSeconds === -2) return null; // SPRINT-35: skip sessions that expired during enumeration
        try { // SPRINT-35: isolate malformed or non-JSON session values
          const session = JSON.parse(raw) as StoredSession; // SPRINT-35: deserialize connect-redis's JSON payload
          if (!session.userId) return null; // SPRINT-35: exclude anonymous pre-login sessions
          if (userIdFilter && session.userId !== userIdFilter) return null; // SPRINT-35: filter before user lookup and pagination
          return { // SPRINT-35: retain normalized authenticated session metadata
            key, // SPRINT-35: preserve full key for termination
            sessionId: key.slice(SESSION_REDIS_PREFIX.length), // SPRINT-35: strip only the storage prefix for API exposure
            userId: session.userId, // SPRINT-35: retain associated user ID
            provider: session.provider ?? null, // SPRINT-35: expose provider when recorded
            ttlSeconds: ttlSeconds >= 0 ? ttlSeconds : 0, // SPRINT-35: normalize non-expiring legacy keys to zero
          }; // SPRINT-35: complete parsed session entry
        } catch { // SPRINT-35: malformed values must not fail the entire admin list
          return null; // SPRINT-35: skip an individually undecodable session
        } // SPRINT-35: complete safe deserialization
      }), // SPRINT-35: finish one session parser
    ); // SPRINT-35: complete bounded concurrent session reads
    return { // SPRINT-35: return only authenticated, valid sessions
      sessions: parsed.filter((session): session is ScannedSession => session !== null), // SPRINT-35: remove skipped entries with a type guard
      truncated, // SPRINT-35: preserve ceiling state for the API response
    }; // SPRINT-35: complete scan result
  } // SPRINT-35: finish incremental authenticated-session enumeration

  async getActiveSessions(query: AdminSessionsQueryDto) { // SPRINT-35: expose real Redis-backed sessions with associated users
    const page = query.page ?? 1; // SPRINT-35: apply majority admin-list page convention
    const pageSize = query.pageSize ?? 20; // SPRINT-35: apply majority admin-list pageSize convention
    const { sessions, truncated } = await this.scanAuthenticatedSessions( // SPRINT-35: enumerate and optionally filter before pagination
      query.userId, // SPRINT-35: restrict to one user when requested
    ); // SPRINT-35: complete Redis scan
    const userIds = [...new Set(sessions.map((session) => session.userId))]; // SPRINT-35: deduplicate users for one batched database query
    const users = await this.prisma.user.findMany({ // SPRINT-35: resolve all associated users in one query regardless of session count
      where: { id: { in: userIds } }, // SPRINT-35: fetch only users referenced by parsed sessions
      select: { // SPRINT-35: expose only fields required by the session-monitoring contract
        id: true, // SPRINT-35: stable user identifier
        username: true, // SPRINT-35: admin display handle
        fullName: true, // SPRINT-35: admin display name
        avatarUrl: true, // SPRINT-35: optional profile image
        email: true, // SPRINT-35: administrative account identification
        role: true, // SPRINT-35: current authorization role
        isActive: true, // SPRINT-35: current account status
      }, // SPRINT-35: complete user projection
    }); // SPRINT-35: complete batched user resolution
    const usersById = new Map(users.map((user) => [user.id, user])); // SPRINT-35: join users to sessions in memory
    const totalLifetimeSeconds = this.getConfiguredSessionLifetimeSeconds(); // SPRINT-35: resolve baseline TTL for activity approximation
    const now = Date.now(); // SPRINT-35: use one consistent timestamp for all derived activity values
    const entries = sessions // SPRINT-35: build API entries only for users that still exist
      .map((session) => { // SPRINT-35: join each Redis session to its user
        const user = usersById.get(session.userId); // SPRINT-35: resolve from the single batched query
        if (!user) return null; // SPRINT-35: skip orphaned sessions whose user was deleted
        const elapsedSeconds = Math.max( // SPRINT-35: approximate time since the rolling TTL was refreshed
          0, // SPRINT-35: prevent future activity timestamps
          totalLifetimeSeconds - session.ttlSeconds, // SPRINT-35: derive elapsed lifetime from configured total minus remaining TTL
        ); // SPRINT-35: complete elapsed-time approximation
        return { // SPRINT-35: construct one documented session-monitoring entry
          sessionId: session.sessionId, // SPRINT-35: expose prefix-free identifier for termination routes
          user, // SPRINT-35: include resolved account identity and current status
          provider: session.provider, // SPRINT-35: expose login provider recorded in session
          approximateLastActivityAt: new Date(now - elapsedSeconds * 1000), // SPRINT-35: derive approximate rolling-session activity time
          remainingLifetimeSeconds: session.ttlSeconds, // SPRINT-35: expose current Redis TTL
        }; // SPRINT-35: complete API session entry
      }) // SPRINT-35: finish session-to-user join
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null) // SPRINT-35: remove orphaned sessions
      .sort( // SPRINT-35: show most recently refreshed sessions first
        (a, b) => // SPRINT-35: compare derived activity timestamps descending
          b.approximateLastActivityAt.getTime() - // SPRINT-35: newer session activity first
          a.approximateLastActivityAt.getTime(), // SPRINT-35: older session activity later
      ); // SPRINT-35: complete activity ordering
    const start = (page - 1) * pageSize; // SPRINT-35: calculate in-memory pagination offset
    return { // SPRINT-35: preserve truncation alongside the standard admin pagination envelope
      success: true as const, // SPRINT-35: prevent the global interceptor from discarding the truncation flag
      data: entries.slice(start, start + pageSize), // SPRINT-35: return only the requested page
      meta: createPaginationMeta(page, pageSize, entries.length), // SPRINT-35: document page, limit, total, and total pages
      truncated, // SPRINT-35: report whether Redis enumeration reached two thousand keys
    }; // SPRINT-35: complete active-session list response
  } // SPRINT-35: finish session-list method

  async terminateSession( // SPRINT-35: revoke one Redis-backed session safely
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    actingSessionId: string, // SPRINT-35: current request session protected from self-termination
    targetSessionId: string, // SPRINT-35: prefix-free target session identifier
  ) { // SPRINT-35: complete single-session termination signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before session deletion
    if (targetSessionId === actingSessionId) { // SPRINT-35: prevent confusing self-revocation mid-request
      throw new BadRequestException( // SPRINT-35: return a clear client error for the unsafe action
        'You cannot terminate your current admin session.', // SPRINT-35: explain the self-session restriction
      ); // SPRINT-35: complete self-termination rejection
    } // SPRINT-35: finish acting-session comparison
    const client = this.redis.getClient(); // SPRINT-35: reuse the application Redis connection
    const key = `${SESSION_REDIS_PREFIX}${targetSessionId}`; // SPRINT-35: reconstruct the exact connect-redis key
    const raw = await client.get(key); // SPRINT-35: read before delete so the affected user is known
    if (!raw) { // SPRINT-35: distinguish an expired or already-terminated session
      throw new NotFoundException( // SPRINT-35: return the required missing-session status
        'Session was not found or has already expired.', // SPRINT-35: provide actionable termination feedback
      ); // SPRINT-35: complete missing-session rejection
    } // SPRINT-35: finish existence check
    let affectedUserId: string | null = null; // SPRINT-35: tolerate malformed legacy payloads while still terminating them
    try { // SPRINT-35: safely extract the affected authenticated user
      affectedUserId = (JSON.parse(raw) as StoredSession).userId ?? null; // SPRINT-35: retain user ID when present
    } catch { // SPRINT-35: malformed session payload does not prevent revocation
      affectedUserId = null; // SPRINT-35: report an unknown affected user
    } // SPRINT-35: complete safe target-session parsing
    await client.del(key); // SPRINT-35: delete the exact Redis session key
    return { // SPRINT-35: confirm revocation and identify the affected account
      message: 'Session terminated successfully.', // SPRINT-35: provide a stable success message
      userId: affectedUserId, // SPRINT-35: identify the affected user when available
    }; // SPRINT-35: complete termination confirmation
  } // SPRINT-35: finish single-session termination

  async terminateUserSessions( // SPRINT-35: revoke every discoverable session for a compromised account
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    actingSessionId: string, // SPRINT-35: current admin session excluded as a safety measure
    targetUserId: string, // SPRINT-35: user whose sessions must be revoked
  ) { // SPRINT-35: complete bulk termination signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before bulk revocation
    const { sessions, truncated } = await this.scanAuthenticatedSessions( // SPRINT-35: reuse bounded cursor enumeration
      targetUserId, // SPRINT-35: filter to the target user before deletion
    ); // SPRINT-35: complete target-user session scan
    const keys = sessions // SPRINT-35: prepare only safe matching keys for deletion
      .filter((session) => session.sessionId !== actingSessionId) // SPRINT-35: preserve the acting administrator's own current session
      .map((session) => session.key); // SPRINT-35: use exact Redis keys discovered by SCAN
    const terminatedCount = // SPRINT-35: report Redis's actual deletion count
      keys.length > 0 ? await this.redis.getClient().del(keys) : 0; // SPRINT-35: avoid an empty DEL call
    return { terminatedCount, truncated }; // SPRINT-35: return accurate count and ceiling state
  } // SPRINT-35: finish bulk user-session termination

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
    const [
      feedCount,
      housingCount,
      restaurantCount,
      conversationCount,
      eventCount,
    ] = await Promise.all([
      this.prisma.feedPost.count({ where: { authorId: userId } }),
      this.prisma.housingListing.count({ where: { ownerId: userId } }),
      this.prisma.restaurant.count({ where: { ownerId: userId } }),
      this.prisma.conversationMember.count({ where: { userId } }),
      this.prisma.event.count({ where: { authorId: userId } }),
    ]);
    return {
      ...user,
      counts: {
        feedPosts: feedCount,
        housingListings: housingCount,
        restaurants: restaurantCount,
        conversations: conversationCount,
        events: eventCount,
      },
    };
  }

  async updateUser( // SPRINT-35: authorize the actor independently before changing a user
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target user identifier
    dto: UpdateUserAdminDto, // SPRINT-35: requested role or active-state changes
  ) { // SPRINT-35: complete defended update-user signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: reject stale, demoted, or inactive administrator sessions
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

  async deleteUser(adminUserId: string, userId: string) { // SPRINT-35: distinguish acting administrator from deletion target
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before permanent deletion
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.expoNotificationService.removeAllTokensForUser(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'User permanently deleted' };
  }

  async warnUser(adminUserId: string, userId: string, message: string) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before issuing a warning
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
    // SPRINT-45: the explicit push here is removed — createNotification now sends it, so an
    // admin warning produces exactly one push. Consequence: warning pushes now respect the
    // recipient's pushEnabled toggle, where previously they were unconditional.
    return { message: 'Warning sent' };
  }

  async grantUserBadge(
    adminUserId: string,
    userId: string,
    badgeType: BadgeType,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before granting privileges
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

  async revokeUserBadge( // SPRINT-35: fill the audited badge-revocation endpoint gap
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target user whose badge is being revoked
    badgeType: BadgeType, // SPRINT-35: target Prisma badge type
  ) { // SPRINT-35: complete defended badge-revocation signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before revoking trust
    const badge = await this.prisma.userBadge.findUnique({ // SPRINT-35: resolve the exact granted badge record
      where: { userId_badgeType: { userId, badgeType } }, // SPRINT-35: use the model's compound uniqueness constraint
    }); // SPRINT-35: complete badge lookup
    if (!badge) throw new NotFoundException('User badge not found'); // SPRINT-35: report absent or already-revoked badges clearly
    await this.prisma.userBadge.delete({ where: { id: badge.id } }); // SPRINT-35: remove the active trust signal while retaining application history
    return { message: 'Badge revoked' }; // SPRINT-35: confirm successful revocation
  } // SPRINT-35: finish badge-revocation service method

  async getContent(query: AdminContentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const types = query.contentType
      ? [query.contentType]
      : (['feed_posts', 'housing', 'restaurants'] as const);

    const results: Array<{
      id: string;
      contentType: string;
      title?: string;
      author?: any;
      createdAt: Date;
      [k: string]: any;
    }> = [];
    if (types.includes('feed_posts')) {
      const where: Prisma.FeedPostWhereInput = {};
      if (search)
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
        ];
      const posts = await this.prisma.feedPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: {
          author: { select: { id: true, username: true, fullName: true } },
        },
      });
      results.push(
        ...posts.map((p) => ({
          ...p,
          contentType: 'feed_post' as const,
          title: p.title,
        })),
      );
    }
    if (types.includes('housing')) {
      const where: Prisma.HousingListingWhereInput = {};
      if (search)
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      const listings = await this.prisma.housingListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: {
          owner: { select: { id: true, username: true, fullName: true } },
        },
      });
      results.push(
        ...listings.map((l) => ({
          ...l,
          contentType: 'housing_listing' as const,
          title: l.title,
          author: l.owner,
        })),
      );
    }
    if (types.includes('restaurants')) {
      const where: Prisma.RestaurantWhereInput = {};
      if (search)
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      const restaurants = await this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: types.length === 1 ? limit : 50,
        skip: types.length === 1 ? skip : 0,
        include: {
          owner: { select: { id: true, username: true, fullName: true } },
        },
      });
      results.push(
        ...restaurants.map((r) => ({
          ...r,
          contentType: 'restaurant' as const,
          title: r.name,
          author: r.owner,
        })),
      );
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = results.length;
    const data =
      types.length === 1 ? results : results.slice(skip, skip + limit);
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async moderateContent( // SPRINT-35: authorize generic moderation independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    contentId: string, // SPRINT-35: target content identifier
    dto: ModerateContentDto, // SPRINT-35: moderation type and action
  ) { // SPRINT-35: complete defended content-moderation signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before content mutation
    if (dto.contentType === 'feed_post') {
      const post = await this.prisma.feedPost.findUnique({
        where: { id: contentId },
      });
      if (!post) throw new NotFoundException('Content not found');
      if (dto.action === 'approve')
        await this.prisma.feedPost.update({
          where: { id: contentId },
          data: { isPublished: true },
        });
      else
        await this.prisma.feedPost.update({
          where: { id: contentId },
          data: { isPublished: false },
        });
    } else if (dto.contentType === 'housing_listing') {
      const listing = await this.prisma.housingListing.findUnique({
        where: { id: contentId },
      });
      if (!listing) throw new NotFoundException('Content not found');
      if (dto.action === 'approve')
        await this.prisma.housingListing.update({
          where: { id: contentId },
          data: { status: 'AVAILABLE' },
        });
      else
        await this.prisma.housingListing.update({
          where: { id: contentId },
          data: { status: 'UNLISTED' },
        });
    } else if (dto.contentType === 'restaurant') {
      const restaurant = await this.prisma.restaurant.findUnique({
        where: { id: contentId },
      });
      if (!restaurant) throw new NotFoundException('Content not found');
      if (dto.action === 'approve')
        await this.prisma.restaurant.update({
          where: { id: contentId },
          data: { isVerified: true },
        });
      else
        await this.prisma.restaurant.update({
          where: { id: contentId },
          data: { isVerified: false },
        });
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
          applicant: {
            select: { id: true, username: true, fullName: true, email: true },
          },
          documents: true,
        },
      }),
      this.prisma.badgeApplication.count({ where: { status: 'PENDING' } }),
    ]);
    const data = items.map((a) => ({
      ...a,
      documents: a.documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        createdAt: d.createdAt,
      })),
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async reviewBadgeApplication(
    adminUserId: string,
    applicationId: string,
    dto: ReviewBadgeApplicationDto,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before badge review
    const application = await this.prisma.badgeApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'PENDING') {
      throw new BadRequestException(
        'This application has already been reviewed.',
      );
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
        where: {
          userId_badgeType: {
            userId: application.userId,
            badgeType: application.badgeType,
          },
        },
        create: {
          userId: application.userId,
          badgeType: application.badgeType,
          applicationId: application.id,
        },
        update: {},
      });
    }
    const badgeTypeName = BADGE_TYPE_NAMES[application.badgeType];
    const contentDesc = BADGE_CONTENT_DESC[application.badgeType];
    void this.notificationsService.createNotification({
      userId: application.userId,
      type: 'BADGE_UPDATE',
      title:
        dto.status === 'APPROVED'
          ? 'Badge application approved!'
          : 'Badge application update',
      body:
        dto.status === 'APPROVED'
          ? `Your ${badgeTypeName} badge has been approved! You can now create ${contentDesc}.`
          : `Your ${badgeTypeName} badge application was not approved. ${dto.adminNotes || 'Check the application for details.'}`,
      referenceType: 'BADGE_APPLICATION',
      referenceId: application.id,
    });
    return {
      message:
        dto.status === 'APPROVED'
          ? 'Application approved.'
          : 'Application rejected.',
    };
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
      users: {
        total: totalUsers,
        active: activeUsers,
        newThisMonth,
        newThisWeek,
      },
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
      badges: {
        pendingApplications: pendingBadges,
        totalApproved: totalApprovedBadges,
      },
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
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
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

  async moderateFeedPost(
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    postId: string,
    action: 'approve' | 'reject' | 'delete',
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before feed moderation
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
    });
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

  async dismissReport(adminUserId: string, reportId: string) { // SPRINT-35: use the existing actor parameter for authorization
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before dismissing a report
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

  async resolveReportAndDeleteListing(adminUserId: string, reportId: string) { // SPRINT-35: use the existing actor parameter for authorization
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before destructive report resolution
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
          options: {
            select: { id: true, text: true, votesCount: true, order: true },
          },
          createdBy: { select: { id: true, username: true } },
        },
      }),
      this.prisma.adminPoll.count(),
    ]);
    return {
      data: data.map((poll) => ({
        ...poll,
        totalVotes: poll.options.reduce(
          (sum, option) => sum + option.votesCount,
          0,
        ),
      })),
      meta: createPaginationMeta(page, pageSize, total),
    };
  }

  async createAdminPoll(adminUserId: string, dto: CreateAdminPollDto) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before poll creation
    return this.prisma.$transaction(async (tx) => {
      const poll = await tx.adminPoll.create({
        data: {
          question: dto.question,
          createdById: adminUserId,
          isActive: true,
        },
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
        include: {
          options: true,
          createdBy: { select: { id: true, username: true } },
        },
      });
    });
  }

  async toggleAdminPoll(adminUserId: string, pollId: string) { // SPRINT-35: accept the authenticated actor for state changes
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before toggling a poll
    const poll = await this.prisma.adminPoll.findUnique({
      where: { id: pollId },
    });
    if (!poll) throw new NotFoundException('Poll not found');
    return this.prisma.adminPoll.update({
      where: { id: pollId },
      data: { isActive: !poll.isActive },
      include: { options: true },
    });
  }

  async deleteAdminPoll(adminUserId: string, pollId: string) { // SPRINT-35: accept the authenticated actor for destructive poll action
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before poll deletion
    const poll = await this.prisma.adminPoll.findUnique({
      where: { id: pollId },
    });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.prisma.adminPoll.delete({ where: { id: pollId } });
    return { message: 'Poll deleted' };
  }

  async getCommunityQuestions(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    category?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.CommunityQuestionWhereInput = {};
    if (query.search)
      where.title = { contains: query.search, mode: 'insensitive' };
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

  async moderateCommunityQuestion(adminUserId: string, questionId: string) { // SPRINT-35: accept the authenticated actor for question deletion
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before community moderation
    const question = await this.prisma.communityQuestion.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.prisma.communityQuestion.delete({ where: { id: questionId } });
    return { message: 'Question deleted' };
  }

  async getRoommateProfiles(query: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
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

  async suspendRoommateProfile( // SPRINT-35: authorize roommate moderation independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target profile owner
    action: 'suspend' | 'delete', // SPRINT-35: requested destructive action
  ) { // SPRINT-35: complete defended roommate-moderation signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before profile mutation
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (action === 'suspend') {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { isActive: false },
        }),
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

  async getAdminRestaurants(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    isVerified?: boolean;
  }) {
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

  async moderateRestaurant(
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    restaurantId: string,
    action: 'approve' | 'reject' | 'delete' | 'hide',
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before restaurant moderation
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (action === 'delete') {
      await this.prisma.restaurant.delete({ where: { id: restaurantId } });
    } else if (action === 'approve') {
      await this.prisma.restaurant.update({
        where: { id: restaurantId },
        data: { isVerified: true },
      });
    } else {
      await this.prisma.restaurant.update({
        where: { id: restaurantId },
        data: { isVerified: false },
      });
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

  async moderateListing(
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    listingId: string,
    action: 'approve' | 'reject' | 'delete' | 'hide',
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before listing moderation
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
    });
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
      include: {
        reporter: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const contentReportDelegate = (this.prisma as any).contentReport;
    if (!contentReportDelegate) {
      console.warn(
        'ContentReport model not available in deployed schema; returning listing reports only.',
      );
    }
    const contentReportsPromise = contentReportDelegate
      ? contentReportDelegate.findMany({
          include: {
            reporter: { select: { id: true, username: true, fullName: true } },
          },
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
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const start = (page - 1) * pageSize;
    return {
      data: merged.slice(start, start + pageSize),
      meta: createPaginationMeta(page, pageSize, merged.length),
    };
  }

  async sendBroadcast(adminUserId: string, dto: SendBroadcastDto) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before sending a broadcast
    let recipientCount = 0;
    if (dto.audienceType === BroadcastAudienceType.ALL) {
      recipientCount = await this.expoNotificationService.sendToAll(
        dto.title,
        dto.body,
      );
    } else if (dto.audienceType === BroadcastAudienceType.CITY) {
      if (!dto.audienceCity)
        throw new BadRequestException('audienceCity is required for CITY');
      recipientCount = await this.expoNotificationService.sendToCity(
        dto.audienceCity,
        dto.title,
        dto.body,
      );
      const cityUsers = await this.prisma.user.findMany({
        where: {
          location: { city: { equals: dto.audienceCity, mode: 'insensitive' } },
        },
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
        throw new BadRequestException(
          'audienceUserIds is required for SELECTIVE',
        );
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
        include: {
          sentBy: { select: { id: true, username: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.broadcastNotification.count(),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async getSupportTickets(query: {
    page?: number;
    pageSize?: number;
    status?: SupportTicketStatus;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status;
    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  async replyToSupportTicket(
    adminUserId: string,
    ticketId: string,
    dto: ReplyToTicketDto,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before replying or closing a ticket
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new BadRequestException('Cannot reply to a closed ticket');
    }
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        adminReply: dto.reply,
        status: dto.close
          ? SupportTicketStatus.CLOSED
          : SupportTicketStatus.REPLIED,
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
        out[r.key] =
          r.key === 'maxFileUploadMB'
            ? parseInt(r.value, 10)
            : JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  }

  async updatePlatformSettings( // SPRINT-35: authorize platform configuration changes independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    dto: UpdatePlatformSettingsDto, // SPRINT-35: validated platform setting changes
  ) { // SPRINT-35: complete defended platform-settings signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before settings mutation
    const keys = [
      'maintenanceMode',
      'registrationEnabled',
      'maxFileUploadMB',
    ] as const;
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
