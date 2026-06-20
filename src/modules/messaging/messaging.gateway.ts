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
      this.sessionMiddleware(socket.request, {} as any, next);
    });
  }

  async handleConnection(socket: any) {
    const req = socket.request as { session?: { userId?: string } };
    const userId = req.session?.userId;
    if (!userId) {
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
    this.logger.log(`User ${userId} connected (socket: ${socket.id})`);
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
    this.logger.log(`User ${userId} disconnected`);
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
      .to(conversationId)
      .emit('new_message', { conversationId, message });
  }

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
      void socket.join(conversationId);
    }
    return { ok: true };
  }

  leaveConversation(socketId: string, conversationId: string): void {
    const socket = this.getSocketById(socketId);
    if (socket) {
      void socket.leave(conversationId);
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    socket.to(payload.conversationId).emit('typing_indicator', {
      conversationId: payload.conversationId,
      userId,
      username: user?.username ?? '',
    });
  }

  @SubscribeMessage('typing_stop')
  onTypingStop(socket: any, payload: { conversationId: string }) {
    const userId = socket.userId;
    if (!userId) return;
    socket.to(payload.conversationId).emit('typing_stop', {
      conversationId: payload.conversationId,
      userId,
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
      socket.to(conversationId).emit('message_read', {
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
