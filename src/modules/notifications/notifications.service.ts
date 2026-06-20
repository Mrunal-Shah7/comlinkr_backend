import { ForbiddenException, Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
    return notification;
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
    platform: string,
  ): Promise<{ id: string }> {
    const row = await this.prisma.pushDevice.upsert({
      where: {
        userId_token: { userId, token },
      },
      create: { userId, token, platform },
      update: { platform, updatedAt: new Date() },
    });
    return { id: row.id };
  }

  async removePushToken(
    userId: string,
    token?: string,
  ): Promise<{ removed: number }> {
    if (token) {
      const r = await this.prisma.pushDevice.deleteMany({
        where: { userId, token },
      });
      return { removed: r.count };
    }
    const r = await this.prisma.pushDevice.deleteMany({ where: { userId } });
    return { removed: r.count };
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
