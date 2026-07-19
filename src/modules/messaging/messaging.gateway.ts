import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Server } from 'socket.io';
import session from 'express-session';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getSessionOptions } from '../../config/session.config';
import { MessagingService, type MessageResponse } from './messaging.service';

/** Match HTTP CORS: empty list would block Expo / RN (no browser Origin). */
const SOCKET_CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function conversationRoomName(conversationId: string): string {
  // SPRINT-36: centralize every conversation-room construction
  return `conversation:${conversationId}`; // SPRINT-36: namespace conversation rooms to prevent future collisions
} // SPRINT-36: complete shared conversation-room helper

export function userRoomName(userId: string): string {
  // SPRINT-36: centralize personal room construction
  return `user:${userId}`; // SPRINT-36: provide a stable target for conversation-list updates
} // SPRINT-36: complete shared personal-room helper

export interface ConversationUpdatedPayload {
  // SPRINT-36: define the user-scoped conversation-list event contract
  conversationId: string; // SPRINT-36: identify the row that changed
  messagePreview: string; // SPRINT-36: provide the latest-message summary
  unreadCount: number; // SPRINT-36: provide the recipient's current unread count
  updatedAt: string; // SPRINT-36: provide the ordering timestamp
} // SPRINT-36: complete conversation update payload

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: SOCKET_CORS_ORIGINS.length > 0 ? SOCKET_CORS_ORIGINS : true,
    credentials: true,
  },
})
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MessagingGateway.name);
  private readonly userSockets = new Map<string, Set<string>>();
  private readonly socketUsers = new Map<string, string>();
  private readonly typingThrottle = new Map<string, number>(); // SPRINT-36: throttle ephemeral typing-start events per socket and conversation
  private sessionMiddleware!: (
    req: any,
    res: any,
    next: (err?: any) => void,
  ) => void;

  constructor(
    private readonly messagingService: MessagingService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    const redisClient = this.redisService.getClient();
    const options = getSessionOptions(redisClient);
    this.sessionMiddleware = session(options);
    server.use((socket: any, next: (err?: Error) => void) => {
      this.sessionMiddleware(socket.request, {} as any, next); // SPRINT-36: restore normal session middleware after diagnostic completion
    });
  }

  async handleConnection(socket: any) {
    const req = socket.request as { session?: { userId?: string } };
    const userId = req.session?.userId;
    if (!userId) {
      this.logger.warn(
        // SPRINT-36: permanently surface handshake authentication failures
        `[Socket Auth] failed socket=${socket.id} reason=missing-session-user`, // SPRINT-36: record a safe reason without cookie contents
      ); // SPRINT-36: complete permanent authentication-failure log
      socket.disconnect();
      return;
    }
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    const wasEmpty = set.size === 0;
    set.add(socket.id);
    this.socketUsers.set(socket.id, userId);
    socket.userId = userId;
    socket.once('disconnect', (reason: string) => {
      // SPRINT-36: retain the transport-provided disconnect reason for permanent diagnostics
      this.logger.log(
        // SPRINT-36: permanently expose disconnection reason
        `[Socket Auth] disconnected userId=${userId} socket=${socket.id} reason=${reason}`, // SPRINT-36: record safe user/socket context
      ); // SPRINT-36: complete permanent disconnection log
    }); // SPRINT-36: finish disconnect-reason listener
    await socket.join(userRoomName(userId)); // SPRINT-36: join the personal room immediately after identity assignment
    const memberships = await this.prisma.conversationMember.findMany({
      // SPRINT-36: make room membership automatic on every connection and reconnection
      where: { userId, status: { not: 'BLOCKED' } }, // SPRINT-36: include accepted and visible pending conversations while excluding blocked rooms
      select: { conversationId: true }, // SPRINT-36: load only room identifiers
    }); // SPRINT-36: complete automatic membership lookup
    await Promise.all(
      // SPRINT-36: join all conversation rooms before authentication completion is logged
      memberships.map(
        (
          membership, // SPRINT-36: map each membership to one room join
        ) => socket.join(conversationRoomName(membership.conversationId)), // SPRINT-36: use the shared room helper
      ), // SPRINT-36: complete automatic room join mapping
    ); // SPRINT-36: wait until every room is active

    if (wasEmpty) {
      const partnerIds =
        await this.messagingService.getConversationPartnerIds(userId);
      for (const pid of partnerIds) {
        const sockets = this.getUserSockets(pid);
        for (const sid of sockets) {
          this.server.to(sid).emit('user_online', { userId });
        }
      }
    }
    this.logger.log(
      // SPRINT-36: permanently confirm resolved identity, transport, and room count
      `[Socket Auth] authenticated userId=${userId} socket=${socket.id} transport=${socket.conn?.transport?.name ?? 'unknown'} conversationRooms=${memberships.length}`, // SPRINT-36: provide future one-line handshake evidence
    ); // SPRINT-36: complete permanent authentication-success log
  }

  handleDisconnect(socket: any) {
    const userId = socket.userId ?? this.socketUsers.get(socket.id);
    if (!userId) return;
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        this.userSockets.delete(userId);
        void this.messagingService
          .getConversationPartnerIds(userId)
          .then((partnerIds) => {
            for (const pid of partnerIds) {
              const sockets = this.getUserSockets(pid);
              for (const sid of sockets) {
                this.server.to(sid).emit('user_offline', { userId });
              }
            }
          });
      }
    }
    this.socketUsers.delete(socket.id);
    const typingPrefix = `${socket.id}:`; // SPRINT-36: identify this socket's ephemeral typing throttle entries
    for (const key of this.typingThrottle.keys()) {
      // SPRINT-36: prevent disconnected socket throttle state from leaking
      if (key.startsWith(typingPrefix)) this.typingThrottle.delete(key); // SPRINT-36: remove only entries owned by this socket
    } // SPRINT-36: complete typing throttle cleanup
  }

  isUserOnline(userId: string): boolean {
    const set = this.userSockets.get(userId);
    return !!set && set.size > 0;
  }

  getUserSockets(userId: string): Set<string> {
    return this.userSockets.get(userId) ?? new Set();
  }

  /** Namespaced gateway: `server` is a Namespace; `sockets` is the connected-socket map (Socket.IO v4). */
  private getSocketById(socketId: string) {
    return (this.server as unknown as Namespace).sockets.get(socketId);
  }

  emitNewMessage(conversationId: string, message: MessageResponse): void {
    this.server
      .to(conversationRoomName(conversationId)) // SPRINT-36: use the shared conversation-room helper for delivery
      .emit('new_message', { conversationId, message });
  }

  emitConversationUpdated(
    // SPRINT-36: update a recipient's conversation list independently of open-thread rooms
    userId: string, // SPRINT-36: identify the recipient's personal room
    payload: ConversationUpdatedPayload, // SPRINT-36: carry row ordering, preview, and unread state
  ): void {
    // SPRINT-36: complete user-scoped emission signature
    this.server // SPRINT-36: target the namespace broadcaster
      .to(userRoomName(userId)) // SPRINT-36: use the shared personal-room helper
      .emit('conversation_updated', payload); // SPRINT-36: emit the documented list-level event
  } // SPRINT-36: complete conversation-list emission

  async joinConversation(
    socketId: string,
    conversationId: string,
    userId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const member = await this.messagingService.findMemberByConversationAndUser(
      conversationId,
      userId,
    );
    if (!member || member.status === 'BLOCKED') {
      return { ok: false, error: 'Not a member of this conversation' };
    }
    const socket = this.getSocketById(socketId);
    if (socket) {
      void socket.join(conversationRoomName(conversationId)); // SPRINT-36: retain explicit joins through the shared room helper
    }
    return { ok: true };
  }

  leaveConversation(socketId: string, conversationId: string): void {
    const socket = this.getSocketById(socketId);
    if (socket) {
      void socket.leave(conversationRoomName(conversationId)); // SPRINT-36: use the same helper at the leave site
    }
  }

  @SubscribeMessage('join_conversation')
  async onJoinConversation(socket: any, payload: { conversationId: string }) {
    const userId = socket.userId;
    if (!userId) return;
    const result = await this.joinConversation(
      socket.id,
      payload.conversationId,
      userId,
    );
    if (!result.ok) {
      socket.emit('error', {
        message: result.error ?? 'Not a member of this conversation',
      });
    }
  }

  @SubscribeMessage('leave_conversation')
  onLeaveConversation(socket: any, payload: { conversationId: string }) {
    this.leaveConversation(socket.id, payload.conversationId);
  }

  @SubscribeMessage('send_message')
  async onSendMessage(
    socket: any,
    payload: { conversationId: string; content: string; type?: string },
  ) {
    const userId = socket.userId;
    if (!userId) return;
    const { conversationId, content, type } = payload;
    if (
      !content ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      socket.emit('error', { message: 'Content is required' });
      return;
    }
    if (content.length > 5000) {
      socket.emit('error', { message: 'Content too long' });
      return;
    }
    const status = await this.messagingService.getMemberStatus(
      conversationId,
      userId,
    );
    if (status !== 'ACCEPTED') {
      socket.emit('error', {
        message:
          status === 'PENDING'
            ? 'Accept the conversation request before sending messages.'
            : 'Forbidden',
      });
      return;
    }
    try {
      await this.messagingService.sendMessage(userId, conversationId, {
        content: content.trim(),
        type: (type as any) === 'IMAGE' ? undefined : (type as any),
      });
      // Service already emits new_message via emitNewMessage
    } catch (err: any) {
      socket.emit('error', {
        message: err?.message ?? 'Failed to send message',
      });
    }
  }

  @SubscribeMessage('typing_start')
  async onTypingStart(socket: any, payload: { conversationId: string }) {
    const userId = socket.userId;
    if (!userId) return;
    const conversationId = payload?.conversationId; // SPRINT-36: normalize the untrusted typing target
    if (!conversationId || typeof conversationId !== 'string') return; // SPRINT-36: ignore malformed ephemeral events silently
    const member = await this.messagingService.findMemberByConversationAndUser(
      // SPRINT-36: prevent non-members from broadcasting typing state
      conversationId, // SPRINT-36: verify the requested conversation
      userId, // SPRINT-36: verify the authenticated socket user
    ); // SPRINT-36: complete membership lookup
    if (!member || member.status === 'BLOCKED') return; // SPRINT-36: silently ignore unauthorized typing attempts
    const throttleKey = `${socket.id}:${conversationId}`; // SPRINT-36: scope throttling to one socket and conversation
    const now = Date.now(); // SPRINT-36: compare typing-start processing times
    const lastProcessedAt = this.typingThrottle.get(throttleKey) ?? 0; // SPRINT-36: read prior ephemeral throttle state
    if (now - lastProcessedAt < 1000) return; // SPRINT-36: cap typing-start processing to once per second
    this.typingThrottle.set(throttleKey, now); // SPRINT-36: retain only the latest accepted start time
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, fullName: true }, // SPRINT-36: provide a useful display name to recipients
    });
    socket.to(conversationRoomName(conversationId)).emit('typing_indicator', {
      // SPRINT-36: exclude sender and use the shared room helper
      conversationId, // SPRINT-36: identify the conversation whose composer changed
      userId,
      displayName: user?.fullName || user?.username || '', // SPRINT-36: provide the typing user's display name
    });
  }

  @SubscribeMessage('typing_stop')
  async onTypingStop(socket: any, payload: { conversationId: string }) {
    // SPRINT-36: verify stop events with the same rules as start events
    const userId = socket.userId;
    if (!userId) return;
    const conversationId = payload?.conversationId; // SPRINT-36: normalize the untrusted typing target
    if (!conversationId || typeof conversationId !== 'string') return; // SPRINT-36: ignore malformed ephemeral events silently
    const member = await this.messagingService.findMemberByConversationAndUser(
      // SPRINT-36: prevent non-members from broadcasting stop state
      conversationId, // SPRINT-36: verify the requested conversation
      userId, // SPRINT-36: verify the authenticated socket user
    ); // SPRINT-36: complete membership lookup
    if (!member || member.status === 'BLOCKED') return; // SPRINT-36: silently ignore unauthorized stop events
    this.typingThrottle.delete(`${socket.id}:${conversationId}`); // SPRINT-36: allow a future start immediately after a real stop
    const user = await this.prisma.user.findUnique({
      // SPRINT-36: match the typing-start payload display contract
      where: { id: userId }, // SPRINT-36: load the authenticated typing user
      select: { username: true, fullName: true }, // SPRINT-36: select only display-name fields
    }); // SPRINT-36: complete typing-stop display lookup
    socket.to(conversationRoomName(conversationId)).emit('typing_stopped', {
      // SPRINT-36: exclude sender and use the shared room helper
      conversationId, // SPRINT-36: identify the conversation whose composer stopped
      userId,
      displayName: user?.fullName || user?.username || '', // SPRINT-36: keep start and stop payloads symmetric
    });
  }

  @SubscribeMessage('message_read')
  async onMessageRead(
    socket: any,
    payload: { conversationId: string; messageId: string },
  ) {
    const userId = socket.userId;
    if (!userId) return;
    const { conversationId, messageId } = payload;
    try {
      await this.messagingService.markAsRead(userId, conversationId);
      const now = new Date().toISOString();
      socket.to(conversationRoomName(conversationId)).emit('message_read', {
        // SPRINT-36: use the shared room helper for receipts
        conversationId,
        userId,
        messageId,
        readAt: now,
      });
    } catch {
      // ignore
    }
  }
}
