/**
 * SPRINT-56 Phase 6 — Sprint 53 chat moderation, realtime, bypass fix.
 */
import { randomUUID } from 'crypto';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AdminReportAction } from '../../src/modules/admin/dto/report-action.dto';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminCronService } from '../../src/modules/admin/admin.cron';
import { MessagingService } from '../../src/modules/messaging/messaging.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { appBaseUrl, appWsBase, createTestApp } from '../helpers/app';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';

function connectChat(wsBase: string, cookie: string): Promise<Socket> {
  // SPRINT-56:
  return new Promise((resolve, reject) => {
    const socket = io(`${wsBase}/chat`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
      transportOptions: {
        polling: { extraHeaders: { Cookie: cookie } },
        websocket: { extraHeaders: { Cookie: cookie } },
      },
      extraHeaders: { Cookie: cookie },
      forceNew: true,
      reconnection: false,
    }); // SPRINT-56:
    const t = setTimeout(() => {
      socket.close();
      reject(new Error('socket connect timeout'));
    }, 15000); // SPRINT-56:
    socket.on('connect', () => {
      setTimeout(() => {
        if (!socket.connected) {
          clearTimeout(t);
          reject(new Error('auth disconnect'));
          return;
        }
        clearTimeout(t);
        resolve(socket);
      }, 600); // SPRINT-56:
    }); // SPRINT-56:
    socket.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    }); // SPRINT-56:
  }); // SPRINT-56:
}

describe('SPRINT-56 / Sprint 53', () => {
  let app: INestApplication; // SPRINT-56:
  let base: string; // SPRINT-56:
  let wsBase: string; // SPRINT-56:
  let adminSvc: AdminService; // SPRINT-56:
  let messaging: MessagingService; // SPRINT-56:
  let settings: SettingsService; // SPRINT-56:
  let cron: AdminCronService; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    app = await createTestApp(); // SPRINT-56:
    base = appBaseUrl(app); // SPRINT-56:
    wsBase = appWsBase(app); // SPRINT-56:
    adminSvc = app.get(AdminService); // SPRINT-56:
    messaging = app.get(MessagingService); // SPRINT-56:
    settings = app.get(SettingsService); // SPRINT-56:
    cron = app.get(AdminCronService); // SPRINT-56:
  }); // SPRINT-56:

  beforeEach(async () => {
    // SPRINT-56:
    await resetDatabase(); // SPRINT-56:
  }); // SPRINT-56:

  afterAll(async () => {
    // SPRINT-56:
    await app.close(); // SPRINT-56:
    await disconnectFixtures(); // SPRINT-56:
  }); // SPRINT-56:

  async function directConversation(aId: string, bId: string) {
    // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const conversationId = randomUUID(); // SPRINT-56:
    const messageId = randomUUID(); // SPRINT-56:
    await prisma.conversation.create({
      data: {
        id: conversationId,
        type: 'DIRECT',
        createdById: aId,
        members: {
          create: [
            { userId: aId, role: 'MEMBER', status: 'ACCEPTED' },
            { userId: bId, role: 'MEMBER', status: 'ACCEPTED' },
          ],
        },
        messages: {
          create: {
            id: messageId,
            senderId: aId,
            content: 'hello',
            type: 'TEXT',
          },
        },
      },
    }); // SPRINT-56:
    return { conversationId, messageId }; // SPRINT-56:
  }

  it('admin chat conversation and messages bypass membership', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const a = await seedUser({ label: 'ca' }); // SPRINT-56:
    const b = await seedUser({ label: 'cb' }); // SPRINT-56:
    const { conversationId, messageId } = await directConversation(a.id, b.id); // SPRINT-56:

    const conv = await adminSvc.getAdminChatConversation(
      adm.id,
      conversationId,
    ); // SPRINT-56:
    expect(conv.id).toBe(conversationId); // SPRINT-56:

    const msgs = await adminSvc.getAdminChatMessages(
      adm.id,
      conversationId,
      undefined,
      20,
    ); // SPRINT-56:
    expect(msgs.data.some((m: any) => m.id === messageId)).toBe(true); // SPRINT-56:
  }); // SPRINT-56:

  it('DELETE message and REMOVE_MESSAGE share one path; realtime delivery to passive socket', async () => {
    // SPRINT-56: REAL SOCKETS — not a stubbed gateway
    const adm = await seedAdmin(); // SPRINT-56:
    const a = await seedUser({ label: 'ra' }); // SPRINT-56:
    const b = await seedUser({ label: 'rb' }); // SPRINT-56:
    const { conversationId, messageId } = await directConversation(a.id, b.id); // SPRINT-56:

    const socketA = await connectChat(wsBase, a.cookie); // SPRINT-56:
    const socketB = await connectChat(wsBase, b.cookie); // SPRINT-56:
    socketA.emit('join_conversation', { conversationId }); // SPRINT-56:
    socketB.emit('join_conversation', { conversationId }); // SPRINT-56:
    await new Promise((r) => setTimeout(r, 400)); // SPRINT-56:

    const received: any[] = []; // SPRINT-56:
    const got = new Promise<any>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('passive never received message_removed')),
        20000,
      ); // SPRINT-56:
      socketB.on('message_removed', (payload) => {
        received.push(payload);
        clearTimeout(t);
        resolve(payload);
      }); // SPRINT-56:
    }); // SPRINT-56:

    await request(base)
      .delete(`/admin/chat/messages/${messageId}`)
      .set('Cookie', adm.cookie)
      .expect(200); // SPRINT-56:

    const payload = await got; // SPRINT-56:
    expect(payload).toEqual({ conversationId, messageId }); // SPRINT-56:
    expect(socketA.connected && socketB.connected).toBe(true); // SPRINT-56:
    socketA.close(); // SPRINT-56:
    socketB.close(); // SPRINT-56:

    // REMOVE_MESSAGE equivalence on a second message
    const prisma = getTestPrisma(); // SPRINT-56:
    const msg2 = await prisma.message.create({
      data: {
        conversationId,
        senderId: a.id,
        content: 'second',
        type: 'TEXT',
      },
    }); // SPRINT-56:
    const report = await prisma.listingReport.create({
      data: {
        reporterId: b.id,
        targetType: 'CHAT_MESSAGE',
        targetId: msg2.id,
        reason: 'rm',
        status: 'PENDING',
      },
    }); // SPRINT-56:
    await adminSvc.actionReport(adm.id, report.id, {
      action: AdminReportAction.REMOVE_MESSAGE,
    }); // SPRINT-56:
    expect(await prisma.message.findUnique({ where: { id: msg2.id } })).toBeNull(); // SPRINT-56:
    expect(
      (await prisma.listingReport.findUnique({ where: { id: report.id } }))
        ?.status,
    ).toBe('RESOLVED'); // SPRINT-56:
  }); // SPRINT-56:

  it('BAN_FROM_CHAT succeeds for DIRECT and rejects non-direct', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const a = await seedUser({ label: 'ba' }); // SPRINT-56:
    const b = await seedUser({ label: 'bb' }); // SPRINT-56:
    const { conversationId, messageId } = await directConversation(a.id, b.id); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const report = await prisma.listingReport.create({
      data: {
        reporterId: b.id,
        targetType: 'CHAT_MESSAGE',
        targetId: messageId,
        reason: 'ban',
        status: 'PENDING',
      },
    }); // SPRINT-56:
    await adminSvc.actionReport(adm.id, report.id, {
      action: AdminReportAction.BAN_FROM_CHAT,
      reason: 'abuse',
      durationDays: 7,
    }); // SPRINT-56:
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: a.id },
      },
    }); // SPRINT-56:
    expect(member?.status).toBe('BLOCKED'); // SPRINT-56:
    expect(member?.blockProvenance).toBe('ADMIN_BAN'); // SPRINT-56:

    const group = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        title: 'g',
        createdById: a.id,
        members: {
          create: [
            { userId: a.id, role: 'ADMIN', status: 'ACCEPTED' },
            { userId: b.id, role: 'MEMBER', status: 'ACCEPTED' },
          ],
        },
        messages: {
          create: { senderId: a.id, content: 'g', type: 'TEXT' },
        },
      },
      include: { messages: true },
    }); // SPRINT-56:
    const greport = await prisma.listingReport.create({
      data: {
        reporterId: b.id,
        targetType: 'CHAT_MESSAGE',
        targetId: group.messages[0].id,
        reason: 'g',
        status: 'PENDING',
      },
    }); // SPRINT-56:
    await expect(
      adminSvc.actionReport(adm.id, greport.id, {
        action: AdminReportAction.CHAT_BAN,
        reason: 'x',
        durationDays: 1,
      }),
    ).rejects.toThrow(); // SPRINT-56:
    expect(
      (await prisma.listingReport.findUnique({ where: { id: greport.id } }))
        ?.status,
    ).toBe('PENDING'); // SPRINT-56:
  }); // SPRINT-56:

  it('fresh-conversation bypass fix: ADMIN_BAN blocked; USER_BLOCK unblock still gets fresh conversation', async () => {
    // SPRINT-56: dedicated bypass-fix coverage
    const a = await seedUser({ label: 'bya' }); // SPRINT-56:
    const b = await seedUser({ label: 'byb' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:

    // Admin ban path
    const { conversationId } = await directConversation(a.id, b.id); // SPRINT-56:
    await prisma.conversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId: a.id },
      },
      data: { status: 'BLOCKED', blockProvenance: 'ADMIN_BAN' },
    }); // SPRINT-56:
    await expect(
      messaging.createConversation(a.id, { participantId: b.id } as any),
    ).rejects.toThrow(); // SPRINT-56:

    // User-block then unblock → fresh conversation (Sprint 44 unchanged)
    const c = await seedUser({ label: 'byc' }); // SPRINT-56:
    const d = await seedUser({ label: 'byd' }); // SPRINT-56:
    const first = await messaging.createConversation(c.id, {
      participantId: d.id,
    } as any); // SPRINT-56:
    await settings.blockUser(c.id, { userId: d.id } as any); // SPRINT-56:
    await settings.unblockUser(c.id, d.id); // SPRINT-56:
    const second = await messaging.createConversation(c.id, {
      participantId: d.id,
    } as any); // SPRINT-56:
    expect(second.id).not.toBe(first.id); // SPRINT-56:
  }); // SPRINT-56:

  it('chat-ban expiry cron restores member without touching isActive', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const a = await seedUser({ label: 'exa' }); // SPRINT-56:
    const b = await seedUser({ label: 'exb' }); // SPRINT-56:
    const { conversationId } = await directConversation(a.id, b.id); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    await prisma.conversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId: a.id },
      },
      data: { status: 'BLOCKED', blockProvenance: 'ADMIN_BAN' },
    }); // SPRINT-56:
    await prisma.user.update({
      where: { id: a.id },
      data: { isActive: false },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: a.id,
        adminId: adm.id,
        reason: 'chat',
        conversationId,
        durationDays: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    }); // SPRINT-56:

    await cron.handleSuspensionExpiry(); // SPRINT-56:

    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: a.id },
      },
    }); // SPRINT-56:
    expect(member?.status).toBe('ACCEPTED'); // SPRINT-56:
    expect(member?.blockProvenance).toBe('NONE'); // SPRINT-56:
    expect(
      (await prisma.user.findUnique({ where: { id: a.id } }))?.isActive,
    ).toBe(false); // SPRINT-56:
  }); // SPRINT-56:
});
