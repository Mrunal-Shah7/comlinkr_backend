import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core'; // SPRINT-45: reach the messaging gateway without a static import that would close a dependency cycle
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpoNotificationService } from './expo-notification.service'; // SPRINT-45: the notification path now owns push delivery for every type
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';

const DEFAULT_PREFERENCES = {
  pushEnabled: true,
  emailEnabled: false,
  eventsNearby: true,
  comments: true,
  likes: false,
  messages: true,
};

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string; // if same as userId, no notification (don't notify self)
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name); // SPRINT-45: log swallowed delivery failures without failing the caller

  constructor(
    private readonly prisma: PrismaService,
    private readonly expoNotificationService: ExpoNotificationService, // SPRINT-45: inject the Sprint 25 push service through the module's existing export
    private readonly moduleRef: ModuleRef, // SPRINT-45: resolve the gateway lazily, mirroring MessagingService.getGateway
  ) {}

  private getGateway(): {
    // SPRINT-45: mirror the existing MessagingService escape hatch for the MessagingGateway -> MessagingService -> NotificationsService cycle
    emitNotificationCreated(
      userId: string,
      payload: {
        id: string;
        type: string;
        title: string;
        body: string;
        referenceType: string | null;
        referenceId: string | null;
        isRead: boolean;
        createdAt: string;
        unreadCount: number;
      },
    ): void; // SPRINT-45: mirror the gateway emitter contract across the boundary
  } | null {
    try {
      // SPRINT-45: dynamic require avoids a static circular import with MessagingGateway
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MessagingGateway } = require('../messaging/messaging.gateway');
      return this.moduleRef.get(MessagingGateway, { strict: false }); // SPRINT-45: resolve the singleton gateway instance
    } catch {
      return null; // SPRINT-45: an unavailable gateway must never break notification creation
    }
  } // SPRINT-45: complete lazy gateway accessor

  /**
   * SPRINT-45: best-effort push + socket delivery for one already-persisted notification.
   * Every failure here is logged and swallowed; the caller's notification row already exists.
   */
  private async deliverNotification(
    notification: {
      id: string;
      userId: string;
      type: NotificationType;
      title: string;
      body: string;
      referenceType: string | null;
      referenceId: string | null;
      isRead: boolean;
      createdAt: Date;
    },
    pushEnabled: boolean, // SPRINT-45: reuse the preferences the gate already loaded rather than re-reading them per notification
  ): Promise<void> {
    // SPRINT-45: mute is keyed on the CONVERSATION reference, never on the MESSAGE type —
    // MESSAGE notifications also carry SHARED_SPACE references, and SYSTEM/BADGE types never carry a conversation.
    let isMuted = false; // SPRINT-45: default to delivering
    if (
      notification.referenceType === 'CONVERSATION' &&
      notification.referenceId
    ) {
      const member = await this.prisma.conversationMember.findUnique({
        // SPRINT-45: read the recipient's own membership row only
        where: {
          conversationId_userId: {
            conversationId: notification.referenceId,
            userId: notification.userId,
          },
        }, // SPRINT-45: composite key scopes the lookup to the recipient
        select: { isMuted: true }, // SPRINT-45: only the mute flag is needed
      }); // SPRINT-45: complete recipient mute lookup
      isMuted = member?.isMuted === true; // SPRINT-45: a missing row is treated as unmuted
    } // SPRINT-45: complete conversation mute resolution
    if (isMuted) {
      return; // SPRINT-45: muting suppresses push and bell badge only — the row is already written
    }

    // SPRINT-45: the push leg respects the master push toggle; the in-app bell badge does not (it is not a push)
    if (pushEnabled) {
      try {
        await this.expoNotificationService.sendToUsers(
          [notification.userId], // SPRINT-45: this single recipient only
          notification.title, // SPRINT-45: identical to the stored row, so push and in-app entry never disagree
          notification.body, // SPRINT-45: identical to the stored row
        );
      } catch (error) {
        this.logger.error(
          `SPRINT-45: push delivery failed for notification ${notification.id}`, // SPRINT-45: log and swallow
          error as Error,
        );
      }
    }

    try {
      const { unreadCount } = await this.getUnreadCount(notification.userId); // SPRINT-45: computed after the row write, inside the guard (6.4)
      const gateway = this.getGateway();
      gateway?.emitNotificationCreated(notification.userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        referenceType: notification.referenceType,
        referenceId: notification.referenceId,
        isRead: notification.isRead,
        createdAt: notification.createdAt.toISOString(),
        unreadCount, // SPRINT-45: server-computed truth; the client must never increment locally
      });
    } catch (error) {
      this.logger.error(
        `SPRINT-45: socket emission failed for notification ${notification.id}`, // SPRINT-45: abandon the emission, never the notification
        error as Error,
      );
    }
  } // SPRINT-45: complete best-effort delivery

  async createNotification(params: CreateNotificationParams) {
    const { userId, type, title, body, referenceType, referenceId, actorId } =
      params;
    if (actorId && actorId === userId) return null;

    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    const preferences = prefs ?? DEFAULT_PREFERENCES;

    let enabled = true;
    switch (type) {
      case 'LIKE':
        enabled = preferences.likes;
        break;
      case 'COMMENT':
        enabled = preferences.comments;
        break;
      case 'EVENT_NEARBY':
        enabled = preferences.eventsNearby;
        break;
      case 'MESSAGE':
        enabled = preferences.messages;
        break;
      case 'BADGE_UPDATE':
      case 'SYSTEM':
        enabled = true;
        break;
      default:
        enabled = true;
    }
    if (!enabled) return null;

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
      },
    });
    // SPRINT-45: deliver only after the preference gate passed and the durable row exists.
    // Not awaited: several callers (food, shared-spaces, roommates, admin) await createNotification,
    // and awaiting an Expo round-trip there would inflate their response times.
    void this.deliverNotification(notification, preferences.pushEnabled).catch(
      (
        error, // SPRINT-45: pass the already-loaded master toggle through
      ) => {
        this.logger.error(
          `SPRINT-45: notification delivery failed for ${notification.id}`, // SPRINT-45: terminal guard — creation always succeeds
          error as Error,
        );
      },
    );
    return notification; // SPRINT-45: unchanged return value
  }

  /**
   * SPRINT-47: EVENT_NEARBY fan-out that restores Expo's batch-of-100 send path.
   * Preference gating and the self-exclusion are preserved; mute does not apply
   * because the reference type is EVENT (confirmed — not CONVERSATION).
   * Delivery failures still cannot break row creation.
   */
  async createEventNearbyFanout(params: {
    userIds: string[];
    eventId: string;
    title: string;
    body: string;
  }): Promise<number> {
    const { userIds, eventId, title, body } = params; // SPRINT-47: destructure once
    if (userIds.length === 0) return 0; // SPRINT-47: nothing to do

    const prefsRows = await this.prisma.notificationPreference.findMany({
      // SPRINT-47: one prefs query for the whole city instead of N
      where: { userId: { in: userIds } }, // SPRINT-47: only recipients under consideration
    }); // SPRINT-47: complete bulk preference load
    const prefsByUser = new Map(prefsRows.map((p) => [p.userId, p])); // SPRINT-47: O(1) lookup per recipient

    const eligible: Array<{ userId: string; pushEnabled: boolean }> = []; // SPRINT-47: recipients who pass eventsNearby
    for (const userId of userIds) {
      const preferences = prefsByUser.get(userId) ?? DEFAULT_PREFERENCES; // SPRINT-47: same default as createNotification
      if (!preferences.eventsNearby) continue; // SPRINT-47: per-type gate still per recipient
      eligible.push({
        userId,
        pushEnabled: preferences.pushEnabled, // SPRINT-47: master toggle still gates push only
      }); // SPRINT-47: record eligibility
    } // SPRINT-47: complete eligibility scan
    if (eligible.length === 0) return 0; // SPRINT-47: every recipient suppressed

    await this.prisma.notification.createMany({
      // SPRINT-47: single multi-row insert instead of N concurrent creates against the pool
      data: eligible.map((e) => ({
        userId: e.userId,
        type: 'EVENT_NEARBY' as const,
        title,
        body,
        referenceType: 'EVENT', // SPRINT-47: mute gate keys on CONVERSATION — EVENT refs are never muted
        referenceId: eventId,
      })),
    }); // SPRINT-47: complete durable row writes

    const created = await this.prisma.notification.findMany({
      // SPRINT-47: reload rows for socket payload ids
      where: {
        type: 'EVENT_NEARBY',
        referenceId: eventId,
        userId: { in: eligible.map((e) => e.userId) },
      }, // SPRINT-47: scoped to this fan-out
    }); // SPRINT-47: complete reload

    const pushUserIds = eligible
      .filter((e) => e.pushEnabled) // SPRINT-47: respect master toggle per recipient
      .map((e) => e.userId); // SPRINT-47: collect for one batched send
    if (pushUserIds.length > 0) {
      void this.expoNotificationService
        .sendToUsers(pushUserIds, title, body) // SPRINT-47: one call — sendToUsers batches by 100 internally
        .catch((error: Error) => {
          this.logger.error(
            `SPRINT-47: batched EVENT_NEARBY push failed for event ${eventId}`, // SPRINT-47: log and swallow — rows already exist
            error,
          );
        });
    } // SPRINT-47: complete batched push leg

    // SPRINT-47: emit sockets sequentially — parallel unread-count queries were racing the
    // Prisma pool (max 20) against test truncation and caused unique-constraint seed failures.
    for (const notification of created) {
      try {
        const { unreadCount } = await this.getUnreadCount(notification.userId); // SPRINT-47: same payload field as single-path
        const gateway = this.getGateway();
        gateway?.emitNotificationCreated(notification.userId, {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          referenceType: notification.referenceType,
          referenceId: notification.referenceId,
          isRead: notification.isRead,
          createdAt: notification.createdAt.toISOString(),
          unreadCount, // SPRINT-47: exact Sprint 45 payload field list preserved
        });
      } catch (error) {
        this.logger.error(
          `SPRINT-47: socket emission failed for notification ${notification.id}`, // SPRINT-47: abandon emission, never the row
          error as Error,
        );
      }
    }

    return created.length; // SPRINT-47: number of rows written
  }

  async getNotifications(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    const data = items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      referenceType: n.referenceType,
      referenceId: n.referenceId,
      isRead: n.isRead,
      createdAt: n.createdAt,
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<{ isRead: boolean }> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw new ForbiddenException();
    }
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
    return { isRead: true };
  }

  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { count: result.count };
  }

  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async getPreferences(userId: string) {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return prefs ?? DEFAULT_PREFERENCES;
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const n = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!n || n.userId !== userId) {
      throw new ForbiddenException();
    }
    await this.prisma.notification.delete({ where: { id: notificationId } });
  }

  async deleteAllNotifications(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { deleted: result.count };
  }

  async registerPushToken(
    userId: string,
    token: string,
    _platform: string, // SPRINT-47: retained for DTO compatibility; live PushToken model has no platform column
  ): Promise<{ id: string; token: string }> {
    // SPRINT-47: dead PushDevice path — delegate to the live Expo/PushToken registration so callers actually receive pushes
    await this.expoNotificationService.registerToken(userId, token); // SPRINT-47: same validation + upsert the send path reads
    const row = await this.prisma.pushToken.findUniqueOrThrow({
      // SPRINT-47: return the live row id
      where: { token }, // SPRINT-47: token is unique on PushToken
      select: { id: true, token: true }, // SPRINT-47: expose only what callers need
    }); // SPRINT-47: complete live-row lookup
    return row; // SPRINT-47: identical conceptual result — a registered token the send path can find
  }

  async removePushToken(
    userId: string,
    token?: string,
  ): Promise<{ removed: number }> {
    // SPRINT-47: delegate removal to the live PushToken table (same ownership rule as /users/push-token)
    if (token) {
      const pushToken = await this.prisma.pushToken.findUnique({
        // SPRINT-47: look up ownership on the live model
        where: { token }, // SPRINT-47: unique token key
        select: { userId: true }, // SPRINT-47: ownership check only
      }); // SPRINT-47: complete ownership lookup
      if (!pushToken || pushToken.userId !== userId) {
        return { removed: 0 }; // SPRINT-47: absent or foreign token — silent success, no leak
      } // SPRINT-47: complete ownership gate
      await this.expoNotificationService.removeToken(token); // SPRINT-47: delete from the table the send path reads
      return { removed: 1 }; // SPRINT-47: one live token removed
    } // SPRINT-47: complete single-token removal
    const before = await this.prisma.pushToken.count({ where: { userId } }); // SPRINT-47: count before wipe
    await this.expoNotificationService.removeAllTokensForUser(userId); // SPRINT-47: clear every live token for this user
    return { removed: before }; // SPRINT-47: report how many were cleared
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const data: Record<string, boolean> = { ...DEFAULT_PREFERENCES };
    if (dto.pushEnabled !== undefined) data.pushEnabled = dto.pushEnabled;
    if (dto.emailEnabled !== undefined) data.emailEnabled = dto.emailEnabled;
    if (dto.eventsNearby !== undefined) data.eventsNearby = dto.eventsNearby;
    if (dto.comments !== undefined) data.comments = dto.comments;
    if (dto.likes !== undefined) data.likes = dto.likes;
    if (dto.messages !== undefined) data.messages = dto.messages;

    const updated = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return updated;
  }
}
