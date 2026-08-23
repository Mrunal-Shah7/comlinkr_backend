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
  ListingReportTargetType, // SPRINT-51
  ListingStatus,
  NotificationType,
  Prisma,
  PropertyType,
  SupportTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpoNotificationService } from '../notifications/expo-notification.service';
import { MessagingService } from '../messaging/messaging.service'; // SPRINT-53
import { StorageService } from '../storage/storage.service'; // SPRINT-54: mirror stories cron file cleanup
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import { randomUUID } from 'crypto'; // SPRINT-55
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
import type { AdminReportsQueryDto } from './dto/admin-reports-query.dto'; // SPRINT-51
import {
  AdminReportAction,
  type ReportActionDto,
} from './dto/report-action.dto'; // SPRINT-51

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

type StoredSession = {
  // SPRINT-35: model the subset of serialized express-session data needed by admins
  userId?: string; // SPRINT-35: identify authenticated sessions and skip anonymous entries
  provider?: string; // SPRINT-35: expose the authentication provider recorded at login
}; // SPRINT-35: complete stored session payload subset

type ScannedSession = {
  // SPRINT-35: retain Redis key metadata before resolving users
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
    private readonly messagingService: MessagingService, // SPRINT-53: shared chat moderation paths
    private readonly storageService: StorageService, // SPRINT-54: story media cleanup
  ) {}

  private async assertActiveAdmin(adminUserId: string): Promise<void> {
    // SPRINT-35: provide defence in depth behind the controller roles guard
    const admin = await this.prisma.user.findUnique({
      // SPRINT-35: reload current role and active state from the authoritative database
      where: { id: adminUserId }, // SPRINT-35: resolve the acting administrator by authenticated user ID
      select: { role: true, isActive: true }, // SPRINT-35: fetch only fields required for authorization
    }); // SPRINT-35: complete acting-user lookup
    if (!admin || admin.role !== 'ADMIN' || !admin.isActive) {
      // SPRINT-35: deny missing, demoted, or deactivated actors
      throw new ForbiddenException({
        // SPRINT-35: return the same stable forbidden contract as RolesGuard
        code: 'FORBIDDEN', // SPRINT-35: preserve the platform authorization error code
        message: 'Forbidden', // SPRINT-35: avoid leaking account state
      }); // SPRINT-35: complete defence-in-depth rejection
    } // SPRINT-35: finish active-admin validation
  } // SPRINT-35: complete reusable service authorization check

  private getConfiguredSessionLifetimeSeconds(): number {
    // SPRINT-35: mirror express-session's configured cookie lifetime
    const configuredMilliseconds = Number(
      // SPRINT-35: parse the established millisecond environment value
      this.configService.get<string>('SESSION_MAX_AGE', '604800000'), // SPRINT-35: preserve the seven-day application default
    ); // SPRINT-35: complete session lifetime lookup
    const safeMilliseconds = // SPRINT-35: prevent invalid configuration from corrupting activity estimates
      Number.isFinite(configuredMilliseconds) && configuredMilliseconds > 0 // SPRINT-35: accept only a positive finite lifetime
        ? configuredMilliseconds // SPRINT-35: retain valid configured milliseconds
        : 604800000; // SPRINT-35: fall back to the same seven-day session default
    return Math.floor(safeMilliseconds / 1000); // SPRINT-35: convert Redis TTL comparisons to seconds
  } // SPRINT-35: complete session lifetime resolver

  private async scanAuthenticatedSessions(
    // SPRINT-35: enumerate Redis sessions incrementally without blocking the server
    userIdFilter?: string, // SPRINT-35: optionally retain sessions for one target user only
  ): Promise<{ sessions: ScannedSession[]; truncated: boolean }> {
    // SPRINT-35: return parsed sessions plus scan ceiling state
    const client = this.redis.getClient(); // SPRINT-35: reuse the session store's Redis connection
    const keys = new Set<string>(); // SPRINT-35: remove duplicates permitted by Redis SCAN semantics
    let cursor = '0'; // SPRINT-35: begin cursor-based Redis enumeration
    let truncated = false; // SPRINT-35: report whether the two-thousand-key safety ceiling was reached
    do {
      // SPRINT-35: continue until Redis returns to the zero cursor
      const result = await client.scan(cursor, {
        // SPRINT-35: request one non-blocking incremental key batch
        MATCH: `${SESSION_REDIS_PREFIX}*`, // SPRINT-35: restrict enumeration to connect-redis session keys
        COUNT: SESSION_SCAN_COUNT, // SPRINT-35: keep each server operation bounded
      }); // SPRINT-35: complete incremental SCAN request
      cursor = result.cursor; // SPRINT-35: advance to Redis's next cursor
      for (const key of result.keys) {
        // SPRINT-35: collect each session key from this batch
        keys.add(key); // SPRINT-35: avoid duplicate work when SCAN repeats a key
        if (keys.size >= SESSION_SCAN_CEILING) {
          // SPRINT-35: stop at the documented production safety ceiling
          truncated = true; // SPRINT-35: tell callers that more keys may exist
          break; // SPRINT-35: stop collecting this batch
        } // SPRINT-35: complete ceiling check
      } // SPRINT-35: finish current SCAN batch collection
      if (truncated) break; // SPRINT-35: avoid further Redis scans after reaching the ceiling
    } while (cursor !== '0'); // SPRINT-35: terminate after a complete cursor cycle

    const parsed = await Promise.all(
      // SPRINT-35: read session payloads and TTLs without serial round trips
      [...keys].map(async (key): Promise<ScannedSession | null> => {
        // SPRINT-35: parse each bounded session key independently
        const [raw, ttlSeconds] = await Promise.all([
          // SPRINT-35: pipeline-independent concurrent reads per key
          client.get(key), // SPRINT-35: retrieve connect-redis's JSON session payload
          client.ttl(key), // SPRINT-35: retrieve remaining whole-second lifetime
        ]); // SPRINT-35: complete payload and TTL reads
        if (!raw || ttlSeconds === -2) return null; // SPRINT-35: skip sessions that expired during enumeration
        try {
          // SPRINT-35: isolate malformed or non-JSON session values
          const session = JSON.parse(raw) as StoredSession; // SPRINT-35: deserialize connect-redis's JSON payload
          if (!session.userId) return null; // SPRINT-35: exclude anonymous pre-login sessions
          if (userIdFilter && session.userId !== userIdFilter) return null; // SPRINT-35: filter before user lookup and pagination
          return {
            // SPRINT-35: retain normalized authenticated session metadata
            key, // SPRINT-35: preserve full key for termination
            sessionId: key.slice(SESSION_REDIS_PREFIX.length), // SPRINT-35: strip only the storage prefix for API exposure
            userId: session.userId, // SPRINT-35: retain associated user ID
            provider: session.provider ?? null, // SPRINT-35: expose provider when recorded
            ttlSeconds: ttlSeconds >= 0 ? ttlSeconds : 0, // SPRINT-35: normalize non-expiring legacy keys to zero
          }; // SPRINT-35: complete parsed session entry
        } catch {
          // SPRINT-35: malformed values must not fail the entire admin list
          return null; // SPRINT-35: skip an individually undecodable session
        } // SPRINT-35: complete safe deserialization
      }), // SPRINT-35: finish one session parser
    ); // SPRINT-35: complete bounded concurrent session reads
    return {
      // SPRINT-35: return only authenticated, valid sessions
      sessions: parsed.filter(
        (session): session is ScannedSession => session !== null,
      ), // SPRINT-35: remove skipped entries with a type guard
      truncated, // SPRINT-35: preserve ceiling state for the API response
    }; // SPRINT-35: complete scan result
  } // SPRINT-35: finish incremental authenticated-session enumeration

  async getActiveSessions(query: AdminSessionsQueryDto) {
    // SPRINT-35: expose real Redis-backed sessions with associated users
    const page = query.page ?? 1; // SPRINT-35: apply majority admin-list page convention
    const pageSize = query.pageSize ?? 20; // SPRINT-35: apply majority admin-list pageSize convention
    const { sessions, truncated } = await this.scanAuthenticatedSessions(
      // SPRINT-35: enumerate and optionally filter before pagination
      query.userId, // SPRINT-35: restrict to one user when requested
    ); // SPRINT-35: complete Redis scan
    const userIds = [...new Set(sessions.map((session) => session.userId))]; // SPRINT-35: deduplicate users for one batched database query
    const users = await this.prisma.user.findMany({
      // SPRINT-35: resolve all associated users in one query regardless of session count
      where: { id: { in: userIds } }, // SPRINT-35: fetch only users referenced by parsed sessions
      select: {
        // SPRINT-35: expose only fields required by the session-monitoring contract
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
      .map((session) => {
        // SPRINT-35: join each Redis session to its user
        const user = usersById.get(session.userId); // SPRINT-35: resolve from the single batched query
        if (!user) return null; // SPRINT-35: skip orphaned sessions whose user was deleted
        const elapsedSeconds = Math.max(
          // SPRINT-35: approximate time since the rolling TTL was refreshed
          0, // SPRINT-35: prevent future activity timestamps
          totalLifetimeSeconds - session.ttlSeconds, // SPRINT-35: derive elapsed lifetime from configured total minus remaining TTL
        ); // SPRINT-35: complete elapsed-time approximation
        return {
          // SPRINT-35: construct one documented session-monitoring entry
          sessionId: session.sessionId, // SPRINT-35: expose prefix-free identifier for termination routes
          user, // SPRINT-35: include resolved account identity and current status
          provider: session.provider, // SPRINT-35: expose login provider recorded in session
          approximateLastActivityAt: new Date(now - elapsedSeconds * 1000), // SPRINT-35: derive approximate rolling-session activity time
          remainingLifetimeSeconds: session.ttlSeconds, // SPRINT-35: expose current Redis TTL
        }; // SPRINT-35: complete API session entry
      }) // SPRINT-35: finish session-to-user join
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null) // SPRINT-35: remove orphaned sessions
      .sort(
        // SPRINT-35: show most recently refreshed sessions first
        (
          a,
          b, // SPRINT-35: compare derived activity timestamps descending
        ) =>
          b.approximateLastActivityAt.getTime() - // SPRINT-35: newer session activity first
          a.approximateLastActivityAt.getTime(), // SPRINT-35: older session activity later
      ); // SPRINT-35: complete activity ordering
    const start = (page - 1) * pageSize; // SPRINT-35: calculate in-memory pagination offset
    return {
      // SPRINT-35: preserve truncation alongside the standard admin pagination envelope
      success: true as const, // SPRINT-35: prevent the global interceptor from discarding the truncation flag
      data: entries.slice(start, start + pageSize), // SPRINT-35: return only the requested page
      meta: createPaginationMeta(page, pageSize, entries.length), // SPRINT-35: document page, limit, total, and total pages
      truncated, // SPRINT-35: report whether Redis enumeration reached two thousand keys
    }; // SPRINT-35: complete active-session list response
  } // SPRINT-35: finish session-list method

  async terminateSession(
    // SPRINT-35: revoke one Redis-backed session safely
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    actingSessionId: string, // SPRINT-35: current request session protected from self-termination
    targetSessionId: string, // SPRINT-35: prefix-free target session identifier
  ) {
    // SPRINT-35: complete single-session termination signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before session deletion
    if (targetSessionId === actingSessionId) {
      // SPRINT-35: prevent confusing self-revocation mid-request
      throw new BadRequestException( // SPRINT-35: return a clear client error for the unsafe action
        'You cannot terminate your current admin session.', // SPRINT-35: explain the self-session restriction
      ); // SPRINT-35: complete self-termination rejection
    } // SPRINT-35: finish acting-session comparison
    const client = this.redis.getClient(); // SPRINT-35: reuse the application Redis connection
    const key = `${SESSION_REDIS_PREFIX}${targetSessionId}`; // SPRINT-35: reconstruct the exact connect-redis key
    const raw = await client.get(key); // SPRINT-35: read before delete so the affected user is known
    if (!raw) {
      // SPRINT-35: distinguish an expired or already-terminated session
      throw new NotFoundException( // SPRINT-35: return the required missing-session status
        'Session was not found or has already expired.', // SPRINT-35: provide actionable termination feedback
      ); // SPRINT-35: complete missing-session rejection
    } // SPRINT-35: finish existence check
    let affectedUserId: string | null = null; // SPRINT-35: tolerate malformed legacy payloads while still terminating them
    try {
      // SPRINT-35: safely extract the affected authenticated user
      affectedUserId = (JSON.parse(raw) as StoredSession).userId ?? null; // SPRINT-35: retain user ID when present
    } catch {
      // SPRINT-35: malformed session payload does not prevent revocation
      affectedUserId = null; // SPRINT-35: report an unknown affected user
    } // SPRINT-35: complete safe target-session parsing
    await client.del(key); // SPRINT-35: delete the exact Redis session key
    return {
      // SPRINT-35: confirm revocation and identify the affected account
      message: 'Session terminated successfully.', // SPRINT-35: provide a stable success message
      userId: affectedUserId, // SPRINT-35: identify the affected user when available
    }; // SPRINT-35: complete termination confirmation
  } // SPRINT-35: finish single-session termination

  async terminateUserSessions(
    // SPRINT-35: revoke every discoverable session for a compromised account
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    actingSessionId: string, // SPRINT-35: current admin session excluded as a safety measure
    targetUserId: string, // SPRINT-35: user whose sessions must be revoked
  ) {
    // SPRINT-35: complete bulk termination signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before bulk revocation
    const { sessions, truncated } = await this.scanAuthenticatedSessions(
      // SPRINT-35: reuse bounded cursor enumeration
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

  // SPRINT-52: paginated warning history for a user's safety case file
  async getUserWarnings(
    adminUserId: string,
    userId: string,
    page = 1,
    limit = 20,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-52: defence-in-depth for moderation history exposure
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.warningRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          admin: { select: { id: true, username: true, fullName: true } },
        },
      }),
      this.prisma.warningRecord.count({ where: { userId } }),
    ]);

    const data = rows.map((w) => ({
      id: w.id,
      reason: w.reason,
      reportId: w.reportId,
      createdAt: w.createdAt,
      admin: w.admin,
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  // SPRINT-52: paginated ban/restoration history with derived isActive per entry
  async getUserBanHistory(
    adminUserId: string,
    userId: string,
    page = 1,
    limit = 20,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-52: defence-in-depth for moderation history exposure
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const skip = (page - 1) * limit;
    const now = new Date();
    const [rows, total] = await Promise.all([
      this.prisma.banRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          admin: { select: { id: true, username: true, fullName: true } },
          liftedBy: { select: { id: true, username: true, fullName: true } },
        },
      }),
      this.prisma.banRecord.count({ where: { userId } }),
    ]);

    const data = rows.map((b) => {
      // SPRINT-52: active = not lifted AND (no expiry OR expiry still in the future)
      const isActive =
        b.liftedAt == null && (b.expiresAt == null || b.expiresAt > now);
      return {
        id: b.id,
        reason: b.reason,
        reportId: b.reportId,
        durationDays: b.durationDays,
        startedAt: b.startedAt,
        expiresAt: b.expiresAt,
        liftedAt: b.liftedAt,
        liftedBy: b.liftedBy,
        isActive,
        createdAt: b.createdAt,
        admin: b.admin,
      };
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  // SPRINT-52: paginated general admin activity trail
  async getAuditLog(adminUserId: string, page = 1, limit = 20) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-52: defence-in-depth for audit trail exposure
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          admin: { select: { id: true, username: true, fullName: true } },
        },
      }),
      this.prisma.adminAuditLog.count(),
    ]);

    const data = rows.map((e) => ({
      id: e.id,
      httpMethod: e.httpMethod,
      routePattern: e.routePattern,
      action: `${e.httpMethod} ${e.routePattern}`, // SPRINT-52: derived action label for consumers
      targetType: e.targetType,
      targetId: e.targetId,
      reason: e.reason,
      createdAt: e.createdAt,
      admin: e.admin,
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  // SPRINT-53: admin chat read — bypass participant membership check
  async getAdminChatConversation(adminUserId: string, conversationId: string) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-53: defence-in-depth
    return this.messagingService.getConversationForAdmin(conversationId);
  }

  // SPRINT-53: admin chat messages — cursor pagination matching Sprint 8 contract
  async getAdminChatMessages(
    adminUserId: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-53: defence-in-depth
    return this.messagingService.getMessagesForAdmin(
      conversationId,
      cursor,
      limit,
    );
  }

  // SPRINT-53: direct admin message hard-delete (shared path with REMOVE_MESSAGE)
  async deleteAdminChatMessage(adminUserId: string, messageId: string) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-53: defence-in-depth
    return this.messagingService.adminRemoveMessage(messageId);
  }

  async updateUser(
    // SPRINT-35: authorize the actor independently before changing a user
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target user identifier
    dto: UpdateUserAdminDto, // SPRINT-35: requested role or active-state changes
  ) {
    // SPRINT-35: complete defended update-user signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: reject stale, demoted, or inactive administrator sessions
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const data: Prisma.UserUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // SPRINT-51: when isActive flips, also write ban history without changing the endpoint contract
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data,
      });
      if (dto.isActive !== undefined && dto.isActive !== user.isActive) {
        if (dto.isActive === false) {
          // SPRINT-51: deactivation via original path → indefinite/manual ban record
          await tx.banRecord.create({
            data: {
              userId,
              adminId: adminUserId,
              reason: 'Deactivated via admin user update',
              durationDays: null,
              expiresAt: null,
            },
          });
        } else {
          // SPRINT-51: reactivation → lift the newest open ban (if any)
          const openBan = await tx.banRecord.findFirst({
            where: { userId, liftedAt: null },
            orderBy: { createdAt: 'desc' },
          });
          if (openBan) {
            await tx.banRecord.update({
              where: { id: openBan.id },
              data: {
                liftedAt: new Date(),
                liftedByAdminId: adminUserId,
              },
            });
          }
        }
      }
      return next;
    });
    return updated;
  }

  async deleteUser(adminUserId: string, userId: string) {
    // SPRINT-35: distinguish acting administrator from deletion target
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

  async revokeUserBadge(
    // SPRINT-35: fill the audited badge-revocation endpoint gap
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target user whose badge is being revoked
    badgeType: BadgeType, // SPRINT-35: target Prisma badge type
  ) {
    // SPRINT-35: complete defended badge-revocation signature
    await this.assertActiveAdmin(adminUserId); // SPRINT-35: enforce active ADMIN role before revoking trust
    const badge = await this.prisma.userBadge.findUnique({
      // SPRINT-35: resolve the exact granted badge record
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

  async moderateContent(
    // SPRINT-35: authorize generic moderation independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    contentId: string, // SPRINT-35: target content identifier
    dto: ModerateContentDto, // SPRINT-35: moderation type and action
  ) {
    // SPRINT-35: complete defended content-moderation signature
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

  async getReports(query: AdminReportsQueryDto) {
    // SPRINT-51: accept targetType / targetId / reporterId filters alongside pagination
    return this.getUnifiedReports({
      page: query.page ?? 1,
      pageSize: query.limit ?? 20,
      targetType: query.targetType,
      targetId: query.targetId,
      reporterId: query.reporterId,
    });
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

  async dismissReport(adminUserId: string, reportId: string) {
    // SPRINT-35: use the existing actor parameter for authorization
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

  async resolveReportAndDeleteListing(adminUserId: string, reportId: string) {
    // SPRINT-35: use the existing actor parameter for authorization
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

  // SPRINT-51: generic admin action endpoint for the seven non-listing target types
  async actionReport(
    adminUserId: string,
    reportId: string,
    dto: ReportActionDto,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-51: Sprint 35 defence-in-depth
    const report = await this.prisma.listingReport.findUnique({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status !== 'PENDING') {
      throw new BadRequestException('This report has already been actioned.');
    }

    const { targetType } = report;
    const action = dto.action;

    // SPRINT-51: housing/restaurant keep their dedicated dismiss/delete-listing flow
    if (
      targetType === ListingReportTargetType.HOUSING ||
      targetType === ListingReportTargetType.RESTAURANT
    ) {
      throw new BadRequestException(
        'Housing and restaurant reports must be resolved via PATCH /admin/reports/:id/dismiss or DELETE /admin/reports/:id/listing.',
      );
    }

    const isChatBan =
      action === AdminReportAction.BAN_FROM_CHAT ||
      action === AdminReportAction.CHAT_BAN; // SPRINT-53: accept both names

    // SPRINT-53: CHAT_MESSAGE accepts REMOVE_MESSAGE or BAN_FROM_CHAT only
    if (targetType === ListingReportTargetType.CHAT_MESSAGE) {
      if (action === AdminReportAction.REMOVE_MESSAGE) {
        return this.executeRemoveMessageAction(adminUserId, report);
      }
      if (isChatBan) {
        return this.executeBanFromChatAction(
          adminUserId,
          report,
          dto.reason,
          dto.durationDays,
        );
      }
      throw new BadRequestException(
        `Action ${action} is not valid for target type CHAT_MESSAGE. Use REMOVE_MESSAGE or BAN_FROM_CHAT.`,
      );
    }

    if (action === AdminReportAction.REMOVE_MESSAGE || isChatBan) {
      throw new BadRequestException(
        `Action ${action} is only valid for CHAT_MESSAGE reports.`,
      );
    }

    const userTargets: ListingReportTargetType[] = [
      ListingReportTargetType.USER,
      ListingReportTargetType.COMMUNITY_MEMBER,
    ];
    const contentTargets: ListingReportTargetType[] = [
      ListingReportTargetType.COMMUNITY_POST,
      ListingReportTargetType.COMMUNITY_QUESTION,
      ListingReportTargetType.COMMUNITY_ANSWER,
      ListingReportTargetType.EVENT,
    ];

    if (userTargets.includes(targetType)) {
      if (
        action !== AdminReportAction.WARN &&
        action !== AdminReportAction.SUSPEND
      ) {
        throw new BadRequestException(
          `Action ${action} is not valid for target type ${targetType}. Use WARN or SUSPEND.`,
        );
      }
    } else if (contentTargets.includes(targetType)) {
      if (action !== AdminReportAction.REMOVE_CONTENT) {
        throw new BadRequestException(
          `Action ${action} is not valid for target type ${targetType}. Use REMOVE_CONTENT.`,
        );
      }
    } else {
      throw new BadRequestException(
        `Unsupported report target type: ${targetType}`,
      );
    }

    if (action === AdminReportAction.WARN) {
      return this.executeWarnAction(adminUserId, report, dto.reason);
    }
    if (action === AdminReportAction.SUSPEND) {
      return this.executeSuspendAction(
        adminUserId,
        report,
        dto.reason,
        dto.durationDays,
      );
    }
    return this.executeRemoveContentAction(adminUserId, report);
  }

  // SPRINT-53: REMOVE_MESSAGE via shared messaging delete path
  private async executeRemoveMessageAction(
    adminUserId: string,
    report: { id: string; targetId: string },
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-53: defence-in-depth
    await this.messagingService.adminRemoveMessage(report.targetId, report.id);
    return { message: 'Message removed and report resolved.' };
  }

  // SPRINT-53: BAN_FROM_CHAT — sender blocked in direct conversation only
  private async executeBanFromChatAction(
    adminUserId: string,
    report: { id: string; targetId: string },
    reason: string | undefined,
    durationDays: number | undefined,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-53: defence-in-depth
    const message = await this.prisma.message.findUnique({
      where: { id: report.targetId },
      select: {
        id: true,
        senderId: true,
        conversationId: true,
        conversation: { select: { type: true } },
      },
    });
    if (!message) {
      throw new NotFoundException('Reported message not found');
    }
    if (message.conversation.type !== 'DIRECT') {
      throw new BadRequestException(
        'BAN_FROM_CHAT is only available for direct conversations.',
      );
    }

    const banReason = reason?.trim() || 'Banned from chat via report review';
    const startedAt = new Date();
    const expiresAt =
      durationDays != null && durationDays >= 1
        ? new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId: message.conversationId,
            userId: message.senderId,
          },
        },
        data: {
          status: 'BLOCKED',
          blockProvenance: 'ADMIN_BAN', // SPRINT-53
        },
      });
      await tx.banRecord.create({
        data: {
          userId: message.senderId,
          adminId: adminUserId,
          reason: banReason,
          reportId: report.id,
          conversationId: message.conversationId, // SPRINT-53
          durationDays: durationDays ?? null,
          startedAt,
          expiresAt,
        },
      });
      await tx.listingReport.update({
        where: { id: report.id },
        data: { status: 'RESOLVED' },
      });
    });

    return { message: 'User banned from conversation and report resolved.' };
  }

  // SPRINT-51: resolve community-member / user report target to a user id
  private resolveReportedUserId(
    targetType: ListingReportTargetType,
    targetId: string,
  ): string {
    // SPRINT-51: COMMUNITY_MEMBER stores the raw user id (no membership join table exists)
    return targetId;
  }

  private async executeWarnAction(
    adminUserId: string,
    report: {
      id: string;
      targetType: ListingReportTargetType;
      targetId: string;
    },
    reason?: string,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-51: defence-in-depth on state-changing branch
    const userId = this.resolveReportedUserId(
      report.targetType,
      report.targetId,
    );
    const warnReason = reason?.trim() || 'Account warning from report review';

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Reported user not found');

      await tx.warningRecord.create({
        data: {
          userId,
          adminId: adminUserId,
          reason: warnReason,
          reportId: report.id,
        },
      });
      await tx.listingReport.update({
        where: { id: report.id },
        data: { status: 'RESOLVED' },
      });
    });

    // SPRINT-51: same notification side-effect as warnUser (history + resolve already committed)
    await this.notificationsService.createNotification({
      userId,
      type: NotificationType.SYSTEM,
      title: 'Account warning',
      body: warnReason,
      referenceType: 'ADMIN_WARN',
      referenceId: adminUserId,
    });
    return { message: 'User warned and report resolved.' };
  }

  private async executeSuspendAction(
    adminUserId: string,
    report: {
      id: string;
      targetType: ListingReportTargetType;
      targetId: string;
    },
    reason: string | undefined,
    durationDays: number | undefined,
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-51: defence-in-depth on state-changing branch
    if (durationDays == null || durationDays < 1) {
      throw new BadRequestException(
        'durationDays is required for SUSPEND and must be at least 1.',
      );
    }
    const userId = this.resolveReportedUserId(
      report.targetType,
      report.targetId,
    );
    const banReason = reason?.trim() || 'Suspended from report review';
    const startedAt = new Date();
    const expiresAt = new Date(
      startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Reported user not found');
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });
      await tx.banRecord.create({
        data: {
          userId,
          adminId: adminUserId,
          reason: banReason,
          reportId: report.id,
          durationDays,
          startedAt,
          expiresAt,
        },
      });
      await tx.listingReport.update({
        where: { id: report.id },
        data: { status: 'RESOLVED' },
      });
    });

    return { message: 'User suspended and report resolved.' };
  }

  private async executeRemoveContentAction(
    adminUserId: string,
    report: {
      id: string;
      targetType: ListingReportTargetType;
      targetId: string;
    },
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-51: defence-in-depth on state-changing branch

    await this.prisma.$transaction(async (tx) => {
      if (report.targetType === ListingReportTargetType.COMMUNITY_POST) {
        // SPRINT-51: FeedPost cascades media/likes/comments/saves
        try {
          await tx.feedPost.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      } else if (
        report.targetType === ListingReportTargetType.COMMUNITY_QUESTION
      ) {
        // SPRINT-51: answers/saves cascade; CommunityUpvote has no FK — delete explicitly
        const answers = await tx.communityAnswer.findMany({
          where: { questionId: report.targetId },
          select: { id: true },
        });
        const answerIds = answers.map((a) => a.id);
        await tx.communityUpvote.deleteMany({
          where: { targetType: 'QUESTION', targetId: report.targetId },
        });
        if (answerIds.length) {
          await tx.communityUpvote.deleteMany({
            where: { targetType: 'ANSWER', targetId: { in: answerIds } },
          });
        }
        try {
          await tx.communityQuestion.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      } else if (
        report.targetType === ListingReportTargetType.COMMUNITY_ANSWER
      ) {
        await tx.communityUpvote.deleteMany({
          where: { targetType: 'ANSWER', targetId: report.targetId },
        });
        try {
          await tx.communityAnswer.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      } else if (report.targetType === ListingReportTargetType.EVENT) {
        // SPRINT-51: attendees/reviews/saves/images cascade from Event
        try {
          await tx.event.delete({ where: { id: report.targetId } });
        } catch (error: any) {
          if (error?.code !== 'P2025') throw error;
        }
      }

      await tx.listingReport.update({
        where: { id: report.id },
        data: { status: 'RESOLVED' },
      });
    });

    return { message: 'Content removed and report resolved.' };
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

  async toggleAdminPoll(adminUserId: string, pollId: string) {
    // SPRINT-35: accept the authenticated actor for state changes
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

  async deleteAdminPoll(adminUserId: string, pollId: string) {
    // SPRINT-35: accept the authenticated actor for destructive poll action
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

  async moderateCommunityQuestion(adminUserId: string, questionId: string) {
    // SPRINT-35: accept the authenticated actor for question deletion
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

  async suspendRoommateProfile(
    // SPRINT-35: authorize roommate moderation independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    userId: string, // SPRINT-35: target profile owner
    action: 'suspend' | 'delete', // SPRINT-35: requested destructive action
  ) {
    // SPRINT-35: complete defended roommate-moderation signature
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
    reason?: string, // SPRINT-54: optional rejection note from shared ModerateActionDto
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
        data: {
          status: 'AVAILABLE',
          moderationReason: null, // SPRINT-54: clear stale rejection reason on approval
        },
      });
    } else if (action === 'reject') {
      // SPRINT-54: persist reason only on reject; empty/missing clears the field
      await this.prisma.housingListing.update({
        where: { id: listingId },
        data: {
          status: 'UNLISTED',
          moderationReason: reason?.trim() ? reason.trim() : null,
        },
      });
    } else {
      // hide (and any other non-reject path): clear reason so it cannot linger
      await this.prisma.housingListing.update({
        where: { id: listingId },
        data: {
          status: 'UNLISTED',
          moderationReason: null, // SPRINT-54
        },
      });
    }
    return { message: `Listing ${action}d successfully` };
  }

  // SPRINT-54: admin stories list matching restaurant/listing pagination convention
  async getAdminStories(
    adminUserId: string,
    query: { page?: number; pageSize?: number },
  ) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-54: defence-in-depth for user-data exposure
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.story.findMany({
        include: {
          author: { select: { id: true, username: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.story.count(),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  // SPRINT-54: hard-delete story; mirror stories.cron file cleanup exactly
  async adminDeleteStory(adminUserId: string, storyId: string) {
    await this.assertActiveAdmin(adminUserId); // SPRINT-54: defence-in-depth
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, mediaUrl: true },
    });
    if (!story) throw new NotFoundException('Story not found');
    await this.prisma.story.delete({ where: { id: story.id } }); // SPRINT-54: comments/likes/saves cascade
    if (story.mediaUrl) {
      // SPRINT-54: identical to StoriesCronService.handleStoryExpiry
      try {
        await this.storageService.deleteFile(story.mediaUrl);
      } catch {
        // ignore
      }
    }
    return { message: 'Story deleted successfully' };
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

  async getUnifiedReports(query: {
    page?: number;
    pageSize?: number;
    targetType?: ListingReportTargetType; // SPRINT-51
    targetId?: string; // SPRINT-51
    reporterId?: string; // SPRINT-51
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // SPRINT-51: single authoritative source is ListingReport after ContentReport migration
    const where: Prisma.ListingReportWhereInput = {
      status: 'PENDING',
    };
    if (query.targetType) where.targetType = query.targetType; // SPRINT-51
    if (query.targetId) where.targetId = query.targetId; // SPRINT-51
    if (query.reporterId) where.reporterId = query.reporterId; // SPRINT-51

    const listingReports = await this.prisma.listingReport.findMany({
      where,
      include: {
        reporter: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const listingMapped = await Promise.all(
      listingReports.map(async (report) => {
        let targetTitle: string | null = null;
        let targetAddress: string | null = null;
        if (report.targetType === 'HOUSING') {
          const target = await this.prisma.housingListing.findUnique({
            where: { id: report.targetId },
            select: { title: true, address: true },
          });
          targetTitle = target?.title ?? null;
          targetAddress = target?.address ?? null;
        } else if (report.targetType === 'RESTAURANT') {
          const target = await this.prisma.restaurant.findUnique({
            where: { id: report.targetId },
            select: { name: true, address: true },
          });
          targetTitle = target?.name ?? null;
          targetAddress = target?.address ?? null;
        }
        return {
          ...report,
          // SPRINT-51: keep source tag for mobile compatibility; all rows are ListingReport now
          source: 'LISTING_REPORT' as const,
          targetTitle,
          targetAddress,
        };
      }),
    );

    const start = (page - 1) * pageSize;
    return {
      data: listingMapped.slice(start, start + pageSize),
      meta: createPaginationMeta(page, pageSize, listingMapped.length),
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

  async updatePlatformSettings(
    // SPRINT-35: authorize platform configuration changes independently of route guards
    adminUserId: string, // SPRINT-35: authenticated acting administrator
    dto: UpdatePlatformSettingsDto, // SPRINT-35: validated platform setting changes
  ) {
    // SPRINT-35: complete defended platform-settings signature
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

  // SPRINT-55: assemble export scoped exactly to performHardDelete tables
  private async buildUserDataExport(userId: string) {
    const feedPosts = await this.prisma.feedPost.findMany({
      where: { authorId: userId },
    });
    const feedPostIds = feedPosts.map((p) => p.id);
    const housingListings = await this.prisma.housingListing.findMany({
      where: { ownerId: userId },
    });
    const listingIds = housingListings.map((l) => l.id);
    const sharedSpaces = await this.prisma.sharedSpace.findMany({
      where: { ownerId: userId },
    });
    const sharedSpaceIds = sharedSpaces.map((s) => s.id);
    const restaurants = await this.prisma.restaurant.findMany({
      where: { ownerId: userId },
    });
    const restaurantIds = restaurants.map((r) => r.id);
    const communityQuestions = await this.prisma.communityQuestion.findMany({
      where: { authorId: userId },
    });
    const questionIds = communityQuestions.map((q) => q.id);
    const answerIdsUnderQuestions = questionIds.length
      ? (
          await this.prisma.communityAnswer.findMany({
            where: { questionId: { in: questionIds } },
            select: { id: true },
          })
        ).map((a) => a.id)
      : [];
    const conversationsCreated = await this.prisma.conversation.findMany({
      where: { createdById: userId },
    });
    const conversationIds = conversationsCreated.map((c) => c.id);
    const events = await this.prisma.event.findMany({
      where: { authorId: userId },
    });
    const eventIds = events.map((e) => e.id);
    const stories = await this.prisma.story.findMany({
      where: { authorId: userId },
    });
    const storyIds = stories.map((s) => s.id);
    const challenges = await this.prisma.challenge.findMany({
      where: { authorId: userId },
    });
    const challengeIds = challenges.map((c) => c.id);
    const badgeApplications = await this.prisma.badgeApplication.findMany({
      where: { userId },
    });
    const applicationIds = badgeApplications.map((a) => a.id);
    const adminPolls = await this.prisma.adminPoll.findMany({
      where: { createdById: userId },
    });
    const adminPollIds = adminPolls.map((p) => p.id);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vibes: true,
        interests: true,
        communities: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const authProviders = (
      await this.prisma.authProvider.findMany({ where: { userId } })
    ).map((p) => ({
      ...p,
      passwordHash: p.passwordHash ? '[REDACTED]' : null, // SPRINT-55: never export credential secrets
      refreshToken: p.refreshToken ? '[REDACTED]' : null,
    }));

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        role: user.role,
        isActive: user.isActive,
        deletedAt: user.deletedAt,
        onboardingCompleted: user.onboardingCompleted,
        agreementAcceptedAt: user.agreementAcceptedAt,
        termsAcceptedVersion: user.termsAcceptedVersion,
        lastActiveAt: user.lastActiveAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        vibes: user.vibes,
        interests: user.interests,
        communities: user.communities,
      },
      AuthProvider: authProviders,
      UserLocation: await this.prisma.userLocation.findMany({
        where: { userId },
      }),
      RoommatePreferences: await this.prisma.roommatePreferences.findUnique({
        where: { userId },
      }),
      FeedPost: feedPosts,
      FeedPostMedia: feedPostIds.length
        ? await this.prisma.feedPostMedia.findMany({
            where: { feedPostId: { in: feedPostIds } },
          })
        : [],
      FeedLike: await this.prisma.feedLike.findMany({
        where: {
          OR: [
            { userId },
            ...(feedPostIds.length
              ? [{ feedPostId: { in: feedPostIds } }]
              : []),
          ],
        },
      }),
      FeedComment: await this.prisma.feedComment.findMany({
        where: {
          OR: [
            { userId },
            ...(feedPostIds.length
              ? [{ feedPostId: { in: feedPostIds } }]
              : []),
          ],
        },
      }),
      FeedSave: await this.prisma.feedSave.findMany({
        where: {
          OR: [
            { userId },
            ...(feedPostIds.length
              ? [{ feedPostId: { in: feedPostIds } }]
              : []),
          ],
        },
      }),
      HousingListing: housingListings,
      HousingImage: listingIds.length
        ? await this.prisma.housingImage.findMany({
            where: { listingId: { in: listingIds } },
          })
        : [],
      HousingInterest: await this.prisma.housingInterest.findMany({
        where: {
          OR: [
            { userId },
            ...(listingIds.length ? [{ listingId: { in: listingIds } }] : []),
          ],
        },
      }),
      HousingSave: await this.prisma.housingSave.findMany({
        where: {
          OR: [
            { userId },
            ...(listingIds.length ? [{ listingId: { in: listingIds } }] : []),
          ],
        },
      }),
      SharedSpace: sharedSpaces,
      SharedSpaceImage: sharedSpaceIds.length
        ? await this.prisma.sharedSpaceImage.findMany({
            where: { sharedSpaceId: { in: sharedSpaceIds } },
          })
        : [],
      SharedSpaceApplication: await this.prisma.sharedSpaceApplication.findMany(
        {
          where: {
            OR: [
              { userId },
              ...(sharedSpaceIds.length
                ? [{ sharedSpaceId: { in: sharedSpaceIds } }]
                : []),
            ],
          },
        },
      ),
      SharedSpaceSave: await this.prisma.sharedSpaceSave.findMany({
        where: {
          OR: [
            { userId },
            ...(sharedSpaceIds.length
              ? [{ sharedSpaceId: { in: sharedSpaceIds } }]
              : []),
          ],
        },
      }),
      Restaurant: restaurants,
      RestaurantImage: restaurantIds.length
        ? await this.prisma.restaurantImage.findMany({
            where: { restaurantId: { in: restaurantIds } },
          })
        : [],
      RestaurantReview: await this.prisma.restaurantReview.findMany({
        where: {
          OR: [
            { userId },
            ...(restaurantIds.length
              ? [{ restaurantId: { in: restaurantIds } }]
              : []),
          ],
        },
      }),
      RestaurantReservation: await this.prisma.restaurantReservation.findMany({
        where: {
          OR: [
            { userId },
            ...(restaurantIds.length
              ? [{ restaurantId: { in: restaurantIds } }]
              : []),
          ],
        },
      }),
      RestaurantFavorite: await this.prisma.restaurantFavorite.findMany({
        where: {
          OR: [
            { userId },
            ...(restaurantIds.length
              ? [{ restaurantId: { in: restaurantIds } }]
              : []),
          ],
        },
      }),
      RestaurantSave: await this.prisma.restaurantSave.findMany({
        where: {
          OR: [
            { userId },
            ...(restaurantIds.length
              ? [{ restaurantId: { in: restaurantIds } }]
              : []),
          ],
        },
      }),
      CommunityQuestion: communityQuestions,
      CommunityAnswer: await this.prisma.communityAnswer.findMany({
        where: {
          OR: [
            { authorId: userId },
            ...(questionIds.length
              ? [{ questionId: { in: questionIds } }]
              : []),
          ],
        },
      }),
      CommunityUpvote: await this.prisma.communityUpvote.findMany({
        where: {
          OR: [
            { userId },
            ...(questionIds.length
              ? [
                  {
                    targetType: 'QUESTION' as const,
                    targetId: { in: questionIds },
                  },
                ]
              : []),
            ...(answerIdsUnderQuestions.length
              ? [
                  {
                    targetType: 'ANSWER' as const,
                    targetId: { in: answerIdsUnderQuestions },
                  },
                ]
              : []),
          ],
        },
      }),
      CommunitySave: await this.prisma.communitySave.findMany({
        where: {
          OR: [
            { userId },
            ...(questionIds.length
              ? [{ questionId: { in: questionIds } }]
              : []),
          ],
        },
      }),
      CommunityPollVote: await this.prisma.communityPollVote.findMany({
        where: { userId },
      }),
      NeighborhoodMoodVote: await this.prisma.neighborhoodMoodVote.findMany({
        where: { userId },
      }),
      Conversation: conversationsCreated,
      ConversationMember: await this.prisma.conversationMember.findMany({
        where: {
          OR: [
            { userId },
            ...(conversationIds.length
              ? [{ conversationId: { in: conversationIds } }]
              : []),
          ],
        },
      }),
      Message: await this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId },
            ...(conversationIds.length
              ? [{ conversationId: { in: conversationIds } }]
              : []),
          ],
        },
      }),
      Event: events,
      EventImage: eventIds.length
        ? await this.prisma.eventImage.findMany({
            where: { eventId: { in: eventIds } },
          })
        : [],
      EventAttendee: await this.prisma.eventAttendee.findMany({
        where: {
          OR: [
            { userId },
            ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
          ],
        },
      }),
      EventSave: await this.prisma.eventSave.findMany({
        where: {
          OR: [
            { userId },
            ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
          ],
        },
      }),
      Story: stories,
      StoryComment: await this.prisma.storyComment.findMany({
        where: {
          OR: [
            { authorId: userId },
            ...(storyIds.length ? [{ storyId: { in: storyIds } }] : []),
          ],
        },
      }),
      StoryLike: await this.prisma.storyLike.findMany({
        where: {
          OR: [
            { userId },
            ...(storyIds.length ? [{ storyId: { in: storyIds } }] : []),
          ],
        },
      }),
      StorySave: await this.prisma.storySave.findMany({
        where: {
          OR: [
            { userId },
            ...(storyIds.length ? [{ storyId: { in: storyIds } }] : []),
          ],
        },
      }),
      Challenge: challenges,
      ChallengeParticipant: await this.prisma.challengeParticipant.findMany({
        where: {
          OR: [
            { userId },
            ...(challengeIds.length
              ? [{ challengeId: { in: challengeIds } }]
              : []),
          ],
        },
      }),
      BadgeApplication: badgeApplications,
      BadgeDocument: applicationIds.length
        ? await this.prisma.badgeDocument.findMany({
            where: { applicationId: { in: applicationIds } },
          })
        : [],
      UserBadge: await this.prisma.userBadge.findMany({ where: { userId } }),
      Notification: await this.prisma.notification.findMany({
        where: { userId },
      }),
      NotificationPreference:
        await this.prisma.notificationPreference.findUnique({
          where: { userId },
        }),
      PrivacySettings: await this.prisma.privacySettings.findUnique({
        where: { userId },
      }),
      BlockedUser: await this.prisma.blockedUser.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      }),
      RoommateSave: await this.prisma.roommateSave.findMany({
        where: { OR: [{ userId }, { savedUserId: userId }] },
      }),
      PushToken: await this.prisma.pushToken.findMany({ where: { userId } }),
      PushDevice: await this.prisma.pushDevice.findMany({ where: { userId } }),
      BroadcastNotification: await this.prisma.broadcastNotification.findMany({
        where: { sentById: userId },
      }),
      SupportTicket: await this.prisma.supportTicket.findMany({
        where: { userId },
      }),
      AdminPoll: adminPolls,
      AdminPollOption: adminPollIds.length
        ? await this.prisma.adminPollOption.findMany({
            where: { pollId: { in: adminPollIds } },
          })
        : [],
      AdminPollVote: await this.prisma.adminPollVote.findMany({
        where: {
          OR: [
            { userId },
            ...(adminPollIds.length ? [{ pollId: { in: adminPollIds } }] : []),
          ],
        },
      }),
      ContentReport: await this.prisma.contentReport.findMany({
        where: { reporterId: userId },
      }),
      ListingReport: await this.prisma.listingReport.findMany({
        where: { reporterId: userId },
      }),
      NewsArticleLike: await this.prisma.newsArticleLike.findMany({
        where: { userId },
      }),
      NewsArticleComment: await this.prisma.newsArticleComment.findMany({
        where: { userId },
      }),
      NewsArticleSave: await this.prisma.newsArticleSave.findMany({
        where: { userId },
      }),
    };
  }

  // SPRINT-55: immediate data export + completed compliance record
  async createDataExport(
    adminUserId: string,
    targetUserId: string,
    reason?: string,
  ) {
    await this.assertActiveAdmin(adminUserId);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, email: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const payload = await this.buildUserDataExport(targetUserId);
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    let exportFileKey = `inline:pending`; // SPRINT-55: replaced after PrivacyRequest id known
    try {
      exportFileKey = await this.storageService.uploadPrivateGeneratedJson(
        buffer,
        `privacy-exports/${targetUserId}`,
        randomUUID(),
      );
    } catch {
      // SPRINT-55: Cloudinary optional; payload always stored on the compliance row
      exportFileKey = `inline:db`;
    }

    const record = await this.prisma.privacyRequest.create({
      data: {
        userId: target.id,
        snapshotUsername: target.username,
        snapshotEmail: target.email,
        type: 'DATA_EXPORT',
        status: 'COMPLETED',
        requestedByAdminId: adminUserId,
        reason: reason?.trim() || null,
        exportFileKey,
        exportPayload: payload,
      },
    });

    if (exportFileKey === 'inline:db' || exportFileKey === 'inline:pending') {
      await this.prisma.privacyRequest.update({
        where: { id: record.id },
        data: { exportFileKey: `inline:${record.id}` },
      });
      record.exportFileKey = `inline:${record.id}`;
    }

    return {
      message: 'Data export completed',
      privacyRequestId: record.id,
      exportFileKey: record.exportFileKey,
      downloadPath: `/admin/privacy-requests/${record.id}/export-download`,
    };
  }

  // SPRINT-55: admin-guarded download — never a public Cloudinary URL
  async downloadDataExport(adminUserId: string, privacyRequestId: string) {
    await this.assertActiveAdmin(adminUserId);
    const record = await this.prisma.privacyRequest.findUnique({
      where: { id: privacyRequestId },
    });
    if (!record || record.type !== 'DATA_EXPORT') {
      throw new NotFoundException('Export not found');
    }
    if (record.exportPayload == null) {
      throw new NotFoundException('Export payload missing');
    }
    return record.exportPayload;
  }

  // SPRINT-55: start Sprint 10 soft-delete, tag ADMIN source, log pending erasure
  async createErasureRequest(
    adminUserId: string,
    targetUserId: string,
    reason?: string,
  ) {
    await this.assertActiveAdmin(adminUserId);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.isActive === false && target.deletedAt != null) {
      throw new BadRequestException('Account deletion already requested.');
    }

    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 15);
    // SPRINT-55: mirror SettingsService.requestAccountDeletion fields + ADMIN tag
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isActive: false,
        deletedAt: deletionDate,
        deletionSource: 'ADMIN',
      },
    });

    const record = await this.prisma.privacyRequest.create({
      data: {
        userId: target.id,
        snapshotUsername: target.username,
        snapshotEmail: target.email,
        type: 'ERASURE',
        status: 'PENDING',
        requestedByAdminId: adminUserId,
        reason: reason?.trim() || null,
      },
    });

    return {
      message: 'Erasure request started; account scheduled for deletion',
      privacyRequestId: record.id,
      deletionDate: deletionDate.toISOString(),
    };
  }

  // SPRINT-55: paginated compliance log
  async getPrivacyRequests(
    adminUserId: string,
    query: { page?: number; pageSize?: number },
  ) {
    await this.assertActiveAdmin(adminUserId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.privacyRequest.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          snapshotUsername: true,
          snapshotEmail: true,
          type: true,
          status: true,
          requestedByAdminId: true,
          reason: true,
          exportFileKey: true,
          resolvedAt: true,
          resolvedByAdminId: true,
          createdAt: true,
        },
      }),
      this.prisma.privacyRequest.count(),
    ]);
    return { data, meta: createPaginationMeta(page, pageSize, total) };
  }

  // SPRINT-55: compliance-only sign-off; does not change user soft-delete state
  async approvePrivacyRequest(adminUserId: string, requestId: string) {
    await this.assertActiveAdmin(adminUserId);
    const record = await this.prisma.privacyRequest.findUnique({
      where: { id: requestId },
    });
    if (!record) throw new NotFoundException('Privacy request not found');
    if (record.type !== 'ERASURE') {
      throw new BadRequestException(
        'Approve is only valid for pending erasure requests.',
      );
    }
    if (record.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending erasure requests can be approved.',
      );
    }
    const updated = await this.prisma.privacyRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        resolvedAt: new Date(),
        resolvedByAdminId: adminUserId,
      },
    });
    return {
      message:
        'Erasure request approved for compliance record only; soft-delete state unchanged',
      privacyRequest: updated,
    };
  }

  // SPRINT-55: cancel pending admin erasure (restore user) + mark rejected
  async rejectPrivacyRequest(adminUserId: string, requestId: string) {
    await this.assertActiveAdmin(adminUserId);
    const record = await this.prisma.privacyRequest.findUnique({
      where: { id: requestId },
    });
    if (!record) throw new NotFoundException('Privacy request not found');
    if (record.type !== 'ERASURE') {
      throw new BadRequestException(
        'Reject is only valid for pending erasure requests.',
      );
    }
    if (record.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending erasure requests can be rejected.',
      );
    }

    if (record.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: record.userId },
        select: { isActive: true, deletedAt: true, deletionSource: true },
      });
      if (
        user &&
        user.isActive === false &&
        user.deletedAt != null &&
        user.deletedAt > new Date()
      ) {
        await this.prisma.user.update({
          where: { id: record.userId },
          data: {
            isActive: true,
            deletedAt: null,
            deletionSource: 'NONE',
          },
        });
      }
    }

    const updated = await this.prisma.privacyRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        resolvedAt: new Date(),
        resolvedByAdminId: adminUserId,
      },
    });
    return {
      message: 'Erasure request rejected; pending deletion cancelled',
      privacyRequest: updated,
    };
  }
}
