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
import { resolveMediaUrl } from '../../common/utils/media-url'; // SPRINT-46: the one shared media URL resolver

const MESSAGE_PAGE_LIMIT = 30;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const DELETED_LISTING_LABEL = 'Listing no longer available';

function formatVoiceMessagePreview(durationSeconds: number): string {
  // SPRINT-36: keep conversation and notification audio summaries identical
  const minutes = Math.floor(durationSeconds / 60); // SPRINT-36: derive whole minutes from stored seconds
  const seconds = durationSeconds % 60; // SPRINT-36: derive the remaining seconds
  return `Voice message (${minutes}:${seconds.toString().padStart(2, '0')})`; // SPRINT-36: use the exact documented preview format
} // SPRINT-36: complete voice-message preview helper

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
  durationSeconds: number | null; // SPRINT-36: include audio duration in conversation last-message responses
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
  isMuted: boolean; // SPRINT-45: the calling user's own mute state, so a client renders the correct label without a second request
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
  durationSeconds: number | null; // SPRINT-36: include audio duration in history and real-time payloads
  isOwn: boolean;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: StorageService,
    private readonly moduleRef: ModuleRef,
    private readonly notificationsService: NotificationsService, // SPRINT-45: sole owner of message push and bell-badge delivery
  ) {}

  private getGateway(): {
    isUserOnline(userId: string): boolean;
    emitNewMessage(conversationId: string, message: MessageResponse): void;
    emitConversationUpdated(
      userId: string,
      payload: {
        conversationId: string;
        messagePreview: string;
        unreadCount: number;
        updatedAt: string;
      },
    ): void;
    emitMessageRemoved( // SPRINT-53: real-time removal broadcast
      conversationId: string,
      payload: { conversationId: string; messageId: string },
    ): void;
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
   * SPRINT-44: among multiples, evaluate the most recently created conversation only.
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
      { createdAt: 'desc' }, // SPRINT-44: most recently created wins (was lastMessageAt-first)
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
        isHidden?: boolean; // SPRINT-44: needed to clear delete-chat hide on re-open
      }>;
    } & Record<string, unknown>,
  ): Promise<ConversationResponse> {
    const myMember = conv.members.find((m) => m.userId === userId);
    if (myMember?.status === 'BLOCKED') {
      throw new ForbiddenException('Not allowed to access this conversation.');
    }
    // SPRINT-44: distinct from unblock — clear requester's own delete-chat hide so the thread reappears
    if (myMember && (myMember as { isHidden?: boolean }).isHidden === true) {
      // SPRINT-44: only the requester's row; never clear the other participant's hide
      await this.prisma.conversationMember.updateMany({
        // SPRINT-44
        where: { conversationId: conv.id, userId }, // SPRINT-44
        data: { isHidden: false }, // SPRINT-44
      }); // SPRINT-44
    } // SPRINT-44
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
        isMuted?: boolean; // SPRINT-45: read the caller's own mute flag from the already-included member rows
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
        durationSeconds?: number | null; // SPRINT-36: accept attachment duration from the conversation query
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
        avatarUrl: resolveMediaUrl(
          m.user.avatarUrl,
          this.fileService.getPublicBaseUrl(),
        ), // SPRINT-46: nested member avatar was returned raw
        role: m.role,
        status: m.status,
        isOnline: await this.isUserOnlineRespectingPrivacy(m.user.id),
      })),
    );

    const lastMsg = raw.messages?.[0] ?? null;
    const lastMessage: LastMessageResponse | null = lastMsg
      ? {
          id: lastMsg.id,
          type: lastMsg.type,
          senderId: lastMsg.senderId,
          senderName: lastMsg.sender.fullName,
          createdAt: lastMsg.createdAt,
          durationSeconds: lastMsg.durationSeconds ?? null, // SPRINT-36: expose last-message audio duration
          // SPRINT-36: replace empty audio text with the fixed voice-note preview
          content:
            lastMsg.type === 'AUDIO' // SPRINT-36: apply the preview only to audio messages
              ? formatVoiceMessagePreview(lastMsg.durationSeconds ?? 0) // SPRINT-36: format stored seconds as m:ss
              : lastMsg.content, // SPRINT-36: preserve existing text and image content
        }
      : null;

    const otherMember = raw.members.find((m) => m.userId !== currentUserId);
    const otherUser =
      raw.type === 'DIRECT' && otherMember
        ? {
            id: otherMember.user.id,
            username: otherMember.user.username,
            name: otherMember.user.fullName,
            avatarUrl: resolveMediaUrl(
              otherMember.user.avatarUrl,
              this.fileService.getPublicBaseUrl(),
            ), // SPRINT-46: nested otherUser avatar was returned raw
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
      // SPRINT-45: select the caller's own member row explicitly rather than relying on member ordering
      isMuted:
        raw.members.find((m) => m.userId === currentUserId)?.isMuted ?? false, // SPRINT-45: never expose the other participant's mute state
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
      durationSeconds?: number | null; // SPRINT-36: accept persisted audio duration in the shared formatter
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
        avatarUrl: resolveMediaUrl(
          raw.sender.avatarUrl,
          this.fileService.getPublicBaseUrl(),
        ), // SPRINT-46: nested message sender avatar was returned raw
      },
      // SPRINT-36: reuse the existing attachment URL field for both image and audio messages
      imageUrl:
        raw.type === 'IMAGE' || raw.type === 'AUDIO' // SPRINT-36: expose stored URL for supported attachment message types
          ? resolveMediaUrl(raw.imageUrl, this.fileService.getPublicBaseUrl()) // SPRINT-46: message attachment was returned raw
          : null, // SPRINT-36: do not expose attachment URLs for plain messages
      durationSeconds: raw.durationSeconds ?? null, // SPRINT-36: include duration in every formatted message response
      isOwn: raw.sender.id === currentUserId,
    };
  }

  async uploadAudio(
    // SPRINT-36: separate potentially slow upload from message persistence
    userId: string, // SPRINT-36: scope storage to the authenticated uploader
    file: Express.Multer.File | undefined, // SPRINT-36: accept the multipart interceptor result
  ): Promise<{ url: string; key: string; size: number }> {
    // SPRINT-36: return the documented upload response
    if (!file) {
      // SPRINT-36: reject multipart requests without an audio part
      throw new BadRequestException('Audio file is required'); // SPRINT-36: name the missing-field reason
    } // SPRINT-36: complete missing-file validation
    const stored = await this.fileService.uploadAudio(file, userId); // SPRINT-36: delegate type, content, size, key, and upload validation
    return { ...stored, size: file.size }; // SPRINT-36: return URL, key, and original byte size
  } // SPRINT-36: complete audio-only upload service

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
      // SPRINT-44: classify most-recent existing direct against requester's own member row
      const myMember = existingDirect.members.find((m) => m.userId === userId); // SPRINT-44
      if (myMember?.status === 'BLOCKED') {
        // SPRINT-53: admin chat ban must not fall through to a fresh conversation
        const provenance = (myMember as { blockProvenance?: string })
          .blockProvenance;
        if (provenance === 'ADMIN_BAN') {
          throw new ForbiddenException(
            'You are banned from messaging this user in this conversation.',
          );
        }
        // SPRINT-44 / SPRINT-53: USER_BLOCK or NONE (retired after unblock) — fall through and create brand-new
      } else {
        // SPRINT-44: usable — return existing (and clear requester hide in returnExistingDirectConversation)
        return this.returnExistingDirectConversation(userId, existingDirect);
      } // SPRINT-44
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
          // SPRINT-44: same classification on race-retry path
          const myMember = again.members.find((m) => m.userId === userId); // SPRINT-44
          if (myMember?.status === 'BLOCKED') {
            // SPRINT-53: refuse fresh conversation when the block is an admin ban
            const provenance = (myMember as { blockProvenance?: string })
              .blockProvenance;
            if (provenance === 'ADMIN_BAN') {
              throw new ForbiddenException(
                'You are banned from messaging this user in this conversation.',
              );
            }
            // SPRINT-44 / SPRINT-53: user-block / retired — do not latch onto retired thread; rethrow
          } else {
            // SPRINT-44: only return when usable
            return this.returnExistingDirectConversation(userId, again);
          }
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
    let durationSeconds: number | null = null; // SPRINT-36: default non-audio messages to no duration
    const content =
      dto.content != null ? sanitizeInput(String(dto.content)) : '';

    if (type === 'AUDIO') {
      // SPRINT-36: enforce AUDIO cross-field requirements explicitly
      if (!dto.audioUrl?.trim()) {
        // SPRINT-36: require an uploaded attachment URL
        throw new BadRequestException(
          'audioUrl is required for AUDIO messages',
        ); // SPRINT-36: name the missing field precisely
      } // SPRINT-36: complete audio URL requirement
      if (dto.durationSeconds == null) {
        // SPRINT-36: require a stored whole-second duration
        throw new BadRequestException( // SPRINT-36: produce a precise cross-field error
          'durationSeconds is required for AUDIO messages', // SPRINT-36: name the missing field precisely
        ); // SPRINT-36: complete missing-duration exception
      } // SPRINT-36: complete audio duration requirement
      if (file) {
        // SPRINT-36: keep audio upload separate from message creation
        throw new BadRequestException( // SPRINT-36: reject mixed image/audio multipart requests
          'AUDIO messages must use audioUrl from the audio upload endpoint', // SPRINT-36: explain the correct two-step contract
        ); // SPRINT-36: complete mixed-upload exception
      } // SPRINT-36: complete separated-upload enforcement
      imageUrl = dto.audioUrl.trim(); // SPRINT-36: reuse the existing Message.imageUrl attachment column
      durationSeconds = dto.durationSeconds; // SPRINT-36: persist client-rounded whole seconds
    } else if (dto.audioUrl != null || dto.durationSeconds != null) {
      // SPRINT-36: prevent audio metadata on non-audio messages
      throw new BadRequestException( // SPRINT-36: produce a precise cross-field error
        'audioUrl and durationSeconds must be absent for non-AUDIO messages', // SPRINT-36: name the invalid condition
      ); // SPRINT-36: complete non-audio metadata exception
    } // SPRINT-36: complete message-type cross-field validation

    if (type === 'TEXT' && content.trim().length === 0) {
      // SPRINT-36: preserve required text content after making DTO content optional
      throw new BadRequestException('content is required for TEXT messages'); // SPRINT-36: name the missing text field
    } // SPRINT-36: complete text-content validation

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
        durationSeconds, // SPRINT-36: persist nullable whole-second audio duration
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
      select: { userId: true, lastReadAt: true }, // SPRINT-36: calculate recipient-specific unread counts for list events
    });
    const senderName = (message as any).sender?.fullName ?? 'Someone';
    const contentPreview = // SPRINT-36: provide a non-empty shared preview for attachment-only audio messages
      type === 'AUDIO' // SPRINT-36: detect voice notes before using empty text
        ? formatVoiceMessagePreview(durationSeconds ?? 0) // SPRINT-36: format the exact m:ss voice-note label
        : content.length > 100 // SPRINT-36: preserve the existing text truncation behavior
          ? content.slice(0, 100) + '…' // SPRINT-36: bound long notification and list text
          : content; // SPRINT-36: preserve short message text
    for (const m of otherAcceptedMembers) {
      const unreadCount = await this.prisma.message.count({
        // SPRINT-36: provide an authoritative unread count after persistence
        where: {
          // SPRINT-36: count only messages unread by this recipient
          conversationId, // SPRINT-36: constrain the updated conversation
          senderId: { not: m.userId }, // SPRINT-36: exclude the recipient's own messages
          createdAt: m.lastReadAt ? { gt: m.lastReadAt } : undefined, // SPRINT-36: respect the recipient's read watermark
        }, // SPRINT-36: complete unread filter
      }); // SPRINT-36: complete recipient unread query
      g?.emitConversationUpdated(m.userId, {
        // SPRINT-36: update conversation lists through each recipient's personal room
        conversationId, // SPRINT-36: identify the row to update
        messagePreview: contentPreview, // SPRINT-36: use the same bounded text as notifications
        unreadCount, // SPRINT-36: provide the authoritative badge value
        updatedAt: now.toISOString(), // SPRINT-36: provide the new ordering timestamp
      }); // SPRINT-36: complete personal-room list emission
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
    // SPRINT-45: the Sprint 36 push from this path is removed — NotificationsService.createNotification
    // is now the single owner of message push delivery, so one message produces exactly one push.
    // Delivery remains independent of socket presence; only the owner changed.
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

  // SPRINT-45: set the calling user's own per-conversation mute state; never the other participant's
  async setConversationMute(
    userId: string, // SPRINT-45: the calling user, and the only row this method writes
    conversationId: string, // SPRINT-45: the conversation whose membership is being muted
    isMuted: boolean, // SPRINT-45: absolute desired state, so a retried tap cannot diverge
  ): Promise<{ conversationId: string; isMuted: boolean }> {
    const member = await this.prisma.conversationMember.findUnique({
      // SPRINT-45: locate only the caller's membership row
      where: { conversationId_userId: { conversationId, userId } }, // SPRINT-45: composite key scopes the lookup to the caller
    }); // SPRINT-45: complete caller membership lookup
    if (!member) {
      // SPRINT-45: match the not-found behaviour hideConversation already uses
      throw new NotFoundException('Conversation not found'); // SPRINT-45: same message as the hide path
    } // SPRINT-45: complete membership requirement
    await this.prisma.conversationMember.update({
      // SPRINT-45: write the caller's own row only
      where: { conversationId_userId: { conversationId, userId } }, // SPRINT-45: re-scope the write to the caller
      data: { isMuted }, // SPRINT-45: setting the current value again succeeds rather than erroring
    }); // SPRINT-45: complete idempotent mute write
    return { conversationId, isMuted }; // SPRINT-45: confirm the resulting state to the client
  } // SPRINT-45: complete per-conversation mute method

  // SPRINT-51: submit a chat-message report (actions deferred; submission required for nine-type coverage)
  async reportMessage(reporterId: string, messageId: string, reason: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true },
    });
    if (!message) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Message not found',
      });
    }
    if (message.senderId === reporterId) {
      // SPRINT-51: self-report block
      throw new BadRequestException('You cannot report your own message.');
    }
    await this.prisma.listingReport.create({
      data: {
        reporterId,
        targetType: 'CHAT_MESSAGE', // SPRINT-51
        targetId: messageId,
        reason,
      },
    });
    return { message: 'Report submitted. Our team will review it shortly.' };
  }

  // SPRINT-53: admin read — any conversation without participant membership check
  async getConversationForAdmin(
    conversationId: string,
  ): Promise<ConversationResponse> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: this.directConversationInclude(),
    });
    if (!conv) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    // SPRINT-53: format as if viewed by the conversation creator (formatter needs a viewer id)
    const viewerId = conv.createdById;
    const listingTitleMap = await this.buildListingTitleMapForOne(
      conv.contextType,
      conv.contextId,
    );
    return this.formatConversation(conv, viewerId, 0, listingTitleMap);
  }

  // SPRINT-53: admin message list — same cursor contract as getMessages, no member check
  async getMessagesForAdmin(
    conversationId: string,
    cursor?: string,
    limit: number = MESSAGE_PAGE_LIMIT,
  ): Promise<{ data: MessageResponse[]; nextCursor: string | null }> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conv) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation not found',
      });
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
    const data = ordered.map((m) => this.formatMessage(m as any, m.senderId));
    return { data, nextCursor };
  }

  /**
   * SPRINT-53: shared hard-delete for admin route and REMOVE_MESSAGE action.
   * Corrects lastMessageAt, best-effort deletes remote attachment, emits message_removed.
   * When reportId is provided, the report is resolved in the same DB transaction.
   */
  async adminRemoveMessage(
    messageId: string,
    reportId?: string,
  ): Promise<{ message: string; conversationId: string; messageId: string }> {
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        createdAt: true,
        imageUrl: true,
        type: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    const conversationId = existing.conversationId;
    const attachmentUrl = existing.imageUrl;

    await this.prisma.$transaction(async (tx) => {
      await tx.message.delete({ where: { id: messageId } });

      // SPRINT-53: recompute Conversation.lastMessageAt from remaining newest message
      const newest = await tx.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: newest?.createdAt ?? null },
      });

      if (reportId) {
        // SPRINT-53: resolve the report in the same transaction as the delete
        await tx.listingReport.update({
          where: { id: reportId },
          data: { status: 'RESOLVED' },
        });
      }
    });

    // SPRINT-53: remote asset cleanup — Message has no File FK; imageUrl/audioUrl live on the row.
    // Delete Cloudinary/S3 asset best-effort after DB commit; orphaned remotes are acceptable if destroy fails.
    if (attachmentUrl) {
      try {
        await this.fileService.deleteFile(attachmentUrl);
      } catch {
        // SPRINT-53: swallow remote delete failure — message row is already gone
      }
    }

    try {
      const g = this.getGateway();
      g?.emitMessageRemoved?.(conversationId, {
        conversationId,
        messageId,
      });
    } catch {
      // SPRINT-53: emission must never fail the deletion (Sprint 36/45 pattern)
    }

    return {
      message: 'Message removed.',
      conversationId,
      messageId,
    };
  }

  // SPRINT-53: apply conversation-scoped chat ban on the sender's own member row
  async adminBanFromChat(params: {
    conversationId: string;
    bannedUserId: string;
    adminId: string;
    reason: string;
    reportId?: string;
    durationDays?: number | null;
  }): Promise<{ message: string }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { id: true, type: true },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    if (conversation.type !== 'DIRECT') {
      throw new BadRequestException(
        'BAN_FROM_CHAT is only available for direct conversations.',
      );
    }

    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: params.conversationId,
          userId: params.bannedUserId,
        },
      },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation member not found',
      });
    }

    const startedAt = new Date();
    const durationDays = params.durationDays ?? null;
    const expiresAt =
      durationDays != null && durationDays >= 1
        ? new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId: params.conversationId,
            userId: params.bannedUserId,
          },
        },
        data: {
          status: 'BLOCKED',
          blockProvenance: 'ADMIN_BAN', // SPRINT-53
        },
      });
      await tx.banRecord.create({
        data: {
          userId: params.bannedUserId,
          adminId: params.adminId,
          reason: params.reason,
          reportId: params.reportId ?? null,
          conversationId: params.conversationId, // SPRINT-53: conversation-scoped
          durationDays,
          startedAt,
          expiresAt,
        },
      });
    });

    return { message: 'User banned from this conversation.' };
  }
}
