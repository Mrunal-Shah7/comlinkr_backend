import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ModuleRef } from '@nestjs/core';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ConversationContextType,
  ConversationMemberStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { CreateConversationDto } from './dto/create-conversation.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import type { UpdateMemberStatusDto } from './dto/update-member-status.dto';
import type { ConversationsQueryDto } from './dto/conversations-query.dto';
import { sanitizeInput } from '../../common/utils/sanitize';

const MESSAGE_PAGE_LIMIT = 30;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const DELETED_LISTING_LABEL = 'Listing no longer available';

export interface ConversationMemberResponse {
  id: string;
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  isOnline: boolean;
}

export interface LastMessageResponse {
  id: string;
  content: string;
  type: string;
  senderId: string;
  senderName: string;
  createdAt: Date;
}

export interface ConversationResponse {
  id: string;
  type: string;
  title: string | null;
  contextType: string;
  contextId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  members: ConversationMemberResponse[];
  otherUser: {
    id: string;
    username: string;
    name: string;
    avatarUrl: string | null;
    isOnline: boolean;
  } | null;
  lastMessage: LastMessageResponse | null;
  unreadCount: number;
  contextLabel: string | null;
}

export interface MessageSenderResponse {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface MessageResponse {
  id: string;
  content: string;
  type: string;
  isEdited: boolean;
  createdAt: Date;
  sender: MessageSenderResponse;
  imageUrl: string | null;
  isOwn: boolean;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: StorageService,
    private readonly moduleRef: ModuleRef,
    private readonly notificationsService: NotificationsService,
  ) {}

  private getGateway(): {
    isUserOnline(userId: string): boolean;
    emitNewMessage(conversationId: string, message: MessageResponse): void;
  } | null {
    try {
      // Dynamic require avoids a circular dependency with MessagingGateway.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MessagingGateway } = require('./messaging.gateway');
      return this.moduleRef.get(MessagingGateway, { strict: false });
    } catch {
      return null;
    }
  }

  private async isUserOnlineRespectingPrivacy(
    userId: string,
  ): Promise<boolean> {
    const settings = await this.prisma.privacySettings.findUnique({
      where: { userId },
    });
    if (settings?.activityStatus !== true) {
      return false;
    }
    const g = this.getGateway();
    return g ? g.isUserOnline(userId) : false;
  }

  private contextLabel(
    contextType: string,
    contextId: string | null,
    listingTitleMap: Map<string, string>,
  ): string | null {
    switch (contextType) {
      case 'LISTING':
        if (contextId === null) return null;
        if (listingTitleMap.has(contextId))
          return listingTitleMap.get(contextId)!;
        return DELETED_LISTING_LABEL;
      case 'EVENT':
        return 'Events';
      default:
        return null;
    }
  }

  private async buildListingTitleMapForOne(
    contextType: string,
    contextId: string | null,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (contextType !== 'LISTING' || contextId === null) {
      return map;
    }
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: contextId },
      select: { id: true, title: true },
    });
    if (listing) {
      map.set(listing.id, listing.title);
    }
    return map;
  }

  /** True 1:1 direct threads only (both users present; no third member). */
  private buildDirectPairWhere(
    userId: string,
    participantId: string,
  ): Prisma.ConversationWhereInput {
    return {
      type: 'DIRECT',
      members: {
        every: { userId: { in: [userId, participantId] } },
      },
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: participantId } } },
      ],
    };
  }

  private directConversationInclude() {
    return {
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      },
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' as const },
        include: { sender: { select: { fullName: true } } },
      },
    };
  }

  /**
   * Prefer exact context (listing/event id). For GENERAL, reuse an existing open DM between the pair.
   */
  private async findExistingDirectConversation(
    userId: string,
    participantId: string,
    contextType: ConversationContextType,
    contextId: string | null,
  ) {
    const include = this.directConversationInclude();
    const pairWhere = this.buildDirectPairWhere(userId, participantId);
    const orderBy: Prisma.ConversationOrderByWithRelationInput[] = [
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ];

    const exactWhere: Prisma.ConversationWhereInput = {
      ...pairWhere,
      contextType,
      contextId: contextId === null ? null : contextId,
    };
    const exactRows = await this.prisma.conversation.findMany({
      where: exactWhere,
      include,
      orderBy,
    });
    const exactTwo = exactRows.filter((c) => c.members.length === 2);
    if (exactTwo.length > 0) {
      return exactTwo[0];
    }

    if (contextType === 'LISTING' || contextType === 'EVENT') {
      if (contextId != null) {
        return null;
      }
    }

    if (contextType !== 'GENERAL') {
      return null;
    }

    const anyRows = await this.prisma.conversation.findMany({
      where: pairWhere,
      include,
      orderBy,
    });
    const pairOnly = anyRows.filter((c) => c.members.length === 2);
    if (pairOnly.length === 0) {
      return null;
    }
    const generalOpen = pairOnly.find(
      (c) => c.contextType === 'GENERAL' && c.contextId == null,
    );
    return generalOpen ?? pairOnly[0];
  }

  private async returnExistingDirectConversation(
    userId: string,
    conv: {
      id: string;
      members: Array<{
        userId: string;
        status: string;
        lastReadAt: Date | null;
      }>;
    } & Record<string, unknown>,
  ): Promise<ConversationResponse> {
    const myMember = conv.members.find((m) => m.userId === userId);
    if (myMember?.status === 'BLOCKED') {
      throw new ForbiddenException('Not allowed to access this conversation.');
    }
    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId: conv.id,
        senderId: { not: userId },
        ...(myMember?.lastReadAt
          ? { createdAt: { gt: myMember.lastReadAt } }
          : {}),
      },
    });
    const listingTitleMap = await this.buildListingTitleMapForOne(
      conv.contextType as string,
      (conv.contextId as string | null) ?? null,
    );
    return this.formatConversation(
      conv as any,
      userId,
      unreadCount,
      listingTitleMap,
    );
  }

  async formatConversation(
    raw: {
      id: string;
      type: string;
      title: string | null;
      contextType: string;
      contextId: string | null;
      lastMessageAt: Date | null;
      createdAt: Date;
      members: Array<{
        id: string;
        userId: string;
        role: string;
        status: string;
        user: {
          id: string;
          username: string;
          fullName: string;
          avatarUrl: string | null;
          avatarFile?: { id: string } | null;
        };
      }>;
      messages?: Array<{
        id: string;
        content: string;
        type: string;
        senderId: string;
        createdAt: Date;
        sender: { fullName: string };
      }>;
    },
    currentUserId: string,
    unreadCount: number,
    listingTitleMap: Map<string, string> = new Map(),
  ): Promise<ConversationResponse> {
    const memberResponses: ConversationMemberResponse[] = await Promise.all(
      raw.members.map(async (m) => ({
        id: m.id,
        userId: m.user.id,
        username: m.user.username,
        name: m.user.fullName,
        avatarUrl: m.user.avatarUrl ?? null,
        role: m.role,
        status: m.status,
        isOnline: await this.isUserOnlineRespectingPrivacy(m.user.id),
      })),
    );

    const lastMsg = raw.messages?.[0] ?? null;
    const lastMessage: LastMessageResponse | null = lastMsg
      ? {
          id: lastMsg.id,
          content: lastMsg.content,
          type: lastMsg.type,
          senderId: lastMsg.senderId,
          senderName: lastMsg.sender.fullName,
          createdAt: lastMsg.createdAt,
        }
      : null;

    const otherMember = raw.members.find((m) => m.userId !== currentUserId);
    const otherUser =
      raw.type === 'DIRECT' && otherMember
        ? {
            id: otherMember.user.id,
            username: otherMember.user.username,
            name: otherMember.user.fullName,
            avatarUrl: otherMember.user.avatarUrl ?? null,
            isOnline: await this.isUserOnlineRespectingPrivacy(
              otherMember.user.id,
            ),
          }
        : null;

    return {
      id: raw.id,
      type: raw.type,
      title: raw.title,
      contextType: raw.contextType,
      contextId: raw.contextId,
      lastMessageAt: raw.lastMessageAt,
      createdAt: raw.createdAt,
      members: memberResponses,
      otherUser,
      lastMessage,
      unreadCount,
      contextLabel: this.contextLabel(
        raw.contextType,
        raw.contextId,
        listingTitleMap,
      ),
    };
  }

  formatMessage(
    raw: {
      id: string;
      content: string;
      type: string;
      isEdited: boolean;
      createdAt: Date;
      sender: {
        id: string;
        username: string;
        fullName: string;
        avatarUrl: string | null;
      };
      imageUrl?: string | null;
    },
    currentUserId: string,
  ): MessageResponse {
    return {
      id: raw.id,
      content: raw.content,
      type: raw.type,
      isEdited: raw.isEdited,
      createdAt: raw.createdAt,
      sender: {
        id: raw.sender.id,
        username: raw.sender.username,
        name: raw.sender.fullName,
        avatarUrl: raw.sender.avatarUrl ?? null,
      },
      imageUrl: raw.type === 'IMAGE' ? (raw.imageUrl ?? null) : null,
      isOwn: raw.sender.id === currentUserId,
    };
  }

  async getConversations(
    userId: string,
    query: ConversationsQueryDto,
  ): Promise<ConversationResponse[]> {
    const type = query.type ?? 'all';
    const search = query.search?.trim();

    const myMemberships = await this.prisma.conversationMember.findMany({
      where: { userId, status: { not: 'BLOCKED' }, isHidden: false }, // SPRINT-27: exclude soft-hidden
      select: { conversationId: true },
    });
    const conversationIds = myMemberships.map((m) => m.conversationId);
    if (conversationIds.length === 0) {
      return [];
    }

    const where: {
      id: { in: string[] };
      contextType?: ConversationContextType;
    } = { id: { in: conversationIds } };
    if (type === 'listings') where.contextType = 'LISTING';
    if (type === 'events') where.contextType = 'EVENT';

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { fullName: true } } },
        },
      },
    });

    let filtered = conversations;
    if (search) {
      const lower = search.toLowerCase();
      filtered = conversations.filter((c) => {
        if (c.title && c.title.toLowerCase().includes(lower)) return true;
        for (const m of c.members) {
          if (m.userId === userId) continue;
          if (
            m.user.fullName.toLowerCase().includes(lower) ||
            m.user.username.toLowerCase().includes(lower)
          ) {
            return true;
          }
        }
        return false;
      });
    }

    const listingIds = new Set<string>();
    for (const conv of filtered) {
      if (conv.contextType === 'LISTING' && conv.contextId !== null) {
        listingIds.add(conv.contextId);
      }
    }
    const listingTitleMap = new Map<string, string>();
    if (listingIds.size > 0) {
      const listings = await this.prisma.housingListing.findMany({
        where: { id: { in: [...listingIds] } },
        select: { id: true, title: true },
      });
      for (const listing of listings) {
        listingTitleMap.set(listing.id, listing.title);
      }
    }

    const result: ConversationResponse[] = [];
    for (const conv of filtered) {
      const myMember = conv.members.find((m) => m.userId === userId);
      const lastReadAt = myMember?.lastReadAt ?? null;
      const unreadCount = await this.prisma.message.count({
        where: {
          conversationId: conv.id,
          createdAt: lastReadAt ? { gt: lastReadAt } : undefined,
          senderId: { not: userId },
        },
      });
      result.push(
        await this.formatConversation(
          conv,
          userId,
          unreadCount,
          listingTitleMap,
        ),
      );
    }
    return result;
  }

  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponse> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member || member.status === 'BLOCKED') {
      throw new ForbiddenException('FORBIDDEN');
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { fullName: true } } },
        },
      },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const lastReadAt = member.lastReadAt ?? null;
    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId: conv.id,
        createdAt: lastReadAt ? { gt: lastReadAt } : undefined,
        senderId: { not: userId },
      },
    });
    const listingTitleMap = await this.buildListingTitleMapForOne(
      conv.contextType,
      conv.contextId,
    );
    return this.formatConversation(conv, userId, unreadCount, listingTitleMap);
  }

  async createConversation(
    userId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationResponse> {
    const participant = await this.prisma.user.findFirst({
      where: { id: dto.participantId, isActive: true, deletedAt: null },
    });
    if (!participant) {
      throw new NotFoundException('User not found');
    }

    const [blockedByMe, blockedByThem] = await Promise.all([
      this.prisma.blockedUser.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId: userId,
            blockedId: dto.participantId,
          },
        },
      }),
      this.prisma.blockedUser.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId: dto.participantId,
            blockedId: userId,
          },
        },
      }),
    ]);
    if (blockedByMe || blockedByThem) {
      throw new BadRequestException(
        'Cannot start a conversation with this user.',
      );
    }

    if (dto.participantId === userId) {
      throw new BadRequestException(
        'Cannot start a conversation with yourself.',
      );
    }

    const contextType = dto.contextType ?? 'GENERAL';
    const contextId = dto.contextId ?? null;

    const existingDirect = await this.findExistingDirectConversation(
      userId,
      dto.participantId,
      contextType,
      contextId,
    );
    if (existingDirect) {
      return this.returnExistingDirectConversation(userId, existingDirect);
    }

    try {
      const created = await this.prisma.conversation.create({
        data: {
          type: 'DIRECT',
          contextType,
          contextId,
          createdById: userId,
          members: {
            create: [
              { userId, role: 'MEMBER', status: 'ACCEPTED' },
              { userId: dto.participantId, role: 'MEMBER', status: 'PENDING' },
            ],
          },
        },
      });
      const fullConv = await this.prisma.conversation.findUnique({
        where: { id: created.id },
        include: this.directConversationInclude(),
      });
      if (!fullConv) {
        throw new NotFoundException('Conversation not found');
      }
      const listingTitleMap = await this.buildListingTitleMapForOne(
        fullConv.contextType,
        fullConv.contextId,
      );
      return this.formatConversation(fullConv, userId, 0, listingTitleMap);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const again = await this.findExistingDirectConversation(
          userId,
          dto.participantId,
          contextType,
          contextId,
        );
        if (again) {
          return this.returnExistingDirectConversation(userId, again);
        }
      }
      throw e;
    }
  }

  async getMessages(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit: number = MESSAGE_PAGE_LIMIT,
  ): Promise<{ data: MessageResponse[]; nextCursor: string | null }> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member || member.status === 'BLOCKED') {
      throw new ForbiddenException('FORBIDDEN');
    }

    const cursorDate = cursor ? new Date(cursor) : undefined;
    const where: { conversationId: string; createdAt?: { lt: Date } } = {
      conversationId,
    };
    if (cursorDate && !isNaN(cursorDate.getTime())) {
      where.createdAt = { lt: cursorDate };
    }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        sender: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor =
      hasMore && page.length > 0
        ? page[page.length - 1].createdAt.toISOString()
        : null;

    const ordered = page.reverse();
    const data = ordered.map((m) => this.formatMessage(m as any, userId));
    return { data, nextCursor };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    file?: Express.Multer.File,
  ): Promise<MessageResponse> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: {
        conversation: { select: { type: true } },
      },
    });
    if (!member) {
      throw new ForbiddenException('FORBIDDEN');
    }
    if (member.status === 'PENDING') {
      throw new ForbiddenException(
        'Accept the conversation request before sending messages.',
      );
    }
    if (member.status === 'BLOCKED') {
      throw new ForbiddenException('FORBIDDEN');
    }

    const otherMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
    });
    if (member.conversation.type === 'DIRECT') {
      for (const other of otherMembers) {
        const blocked = await this.prisma.blockedUser.findUnique({
          where: {
            blockerId_blockedId: {
              blockerId: other.userId,
              blockedId: userId,
            },
          },
        });
        if (blocked) {
          throw new ForbiddenException('Cannot send messages to this user.');
        }
      }
    }

    let type: MessageType = (dto.type as MessageType) ?? 'TEXT';
    let imageUrl: string | null = null;
    const content =
      dto.content != null ? sanitizeInput(String(dto.content)) : '';

    if (file) {
      if (file.size > IMAGE_MAX_SIZE_BYTES) {
        throw new BadRequestException('Image must be at most 5MB');
      }
      if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
        throw new BadRequestException('Image must be JPEG, PNG, or GIF');
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      imageUrl = await this.fileService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `messages/${conversationId}`,
        randomUUID(),
        extension,
      );
      type = 'IMAGE';
    }

    const now = new Date();
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content,
        type,
        imageUrl,
      },
      include: {
        sender: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: now },
    });

    const formatted = this.formatMessage(message, userId);
    const g = this.getGateway();
    if (g && typeof g.emitNewMessage === 'function') {
      g.emitNewMessage(conversationId, formatted);
    }
    const otherAcceptedMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: userId }, status: 'ACCEPTED' },
      select: { userId: true },
    });
    const senderName = (message as any).sender?.fullName ?? 'Someone';
    const contentPreview =
      content.length > 100 ? content.slice(0, 100) + '…' : content;
    for (const m of otherAcceptedMembers) {
      void this.notificationsService.createNotification({
        userId: m.userId,
        type: 'MESSAGE',
        title: `New message from ${senderName}`,
        body: contentPreview,
        referenceType: 'CONVERSATION',
        referenceId: conversationId,
        actorId: userId,
      });
    }
    return formatted;
  }

  async markAsRead(
    userId: string,
    conversationId: string,
  ): Promise<{ lastReadAt: string }> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('FORBIDDEN');
    }
    const now = new Date();
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: now },
    });
    return { lastReadAt: now.toISOString() };
  }

  async updateMemberStatus(
    userId: string,
    memberId: string,
    dto: UpdateMemberStatusDto,
  ): Promise<{ status: string }> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { id: memberId },
      include: { conversation: true },
    });
    if (!member || member.userId !== userId) {
      throw new ForbiddenException('FORBIDDEN');
    }
    if (member.status !== 'PENDING') {
      throw new BadRequestException('Status can only be changed from PENDING.');
    }
    await this.prisma.conversationMember.update({
      where: { id: memberId },
      data: { status: dto.status },
    });
    if (dto.status === 'ACCEPTED') {
      await this.prisma.message.create({
        data: {
          conversationId: member.conversationId,
          senderId: userId,
          content: 'Conversation request accepted.',
          type: 'SYSTEM',
        },
      });
    }
    return { status: dto.status };
  }

  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const members = await this.prisma.conversationMember.findMany({
      where: { userId, status: 'ACCEPTED' },
      select: { conversationId: true, lastReadAt: true },
    });
    let total = 0;
    for (const m of members) {
      const count = await this.prisma.message.count({
        where: {
          conversationId: m.conversationId,
          senderId: { not: userId },
          createdAt: m.lastReadAt ? { gt: m.lastReadAt } : undefined,
        },
      });
      total += count;
    }
    return { unreadCount: total };
  }

  async getConversationPartnerIds(userId: string): Promise<string[]> {
    const myConvs = await this.prisma.conversationMember.findMany({
      where: { userId, status: 'ACCEPTED' },
      select: { conversationId: true },
    });
    const convIds = myConvs.map((c) => c.conversationId);
    if (convIds.length === 0) return [];
    const others = await this.prisma.conversationMember.findMany({
      where: { conversationId: { in: convIds }, userId: { not: userId } },
      select: { userId: true },
    });
    return [...new Set(others.map((o) => o.userId))];
  }

  async isMemberWithStatus(
    conversationId: string,
    userId: string,
    status: ConversationMemberStatus,
  ): Promise<boolean> {
    const m = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return m?.status === status;
  }

  async getMemberStatus(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMemberStatus | null> {
    const m = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return m?.status ?? null;
  }

  async findMemberByConversationAndUser(
    conversationId: string,
    userId: string,
  ) {
    return this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
  }

  // SPRINT-27: soft-hide conversation for the requesting user only
  async hideConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) {
      throw new NotFoundException('Conversation not found');
    }
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isHidden: true },
    });
    return { message: 'Conversation removed' };
  }
}
