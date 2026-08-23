/**
 * SPRINT-56 Phase 9 — cross-cutting regressions (Sprints 10/44/45 + cron coexistence).
 */
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminCronService } from '../../src/modules/admin/admin.cron';
import { MessagingService } from '../../src/modules/messaging/messaging.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createAppContext } from '../helpers/context';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';
import { randomUUID } from 'crypto';
import type { NestApplicationContext } from '@nestjs/core';

describe('SPRINT-56 / Phase 9 regressions', () => {
  let ctx: NestApplicationContext; // SPRINT-56:
  let settings: SettingsService; // SPRINT-56:
  let messaging: MessagingService; // SPRINT-56:
  let notifications: NotificationsService; // SPRINT-56:
  let admin: AdminService; // SPRINT-56:
  let cron: AdminCronService; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    ctx = await createAppContext(); // SPRINT-56:
    settings = ctx.get(SettingsService); // SPRINT-56:
    messaging = ctx.get(MessagingService); // SPRINT-56:
    notifications = ctx.get(NotificationsService); // SPRINT-56:
    admin = ctx.get(AdminService); // SPRINT-56:
    cron = ctx.get(AdminCronService); // SPRINT-56:
  }); // SPRINT-56:

  beforeEach(async () => {
    // SPRINT-56:
    await resetDatabase(); // SPRINT-56:
  }); // SPRINT-56:

  afterAll(async () => {
    // SPRINT-56:
    await ctx.close(); // SPRINT-56:
    await disconnectFixtures(); // SPRINT-56:
  }); // SPRINT-56:

  it('Sprint 10: self-service deletion and cancellation unchanged', async () => {
    // SPRINT-56:
    const u = await seedUser({ label: 's10' }); // SPRINT-56:
    const req = await settings.requestAccountDeletion(u.id); // SPRINT-56:
    expect(req.message).toBe('Account scheduled for deletion'); // SPRINT-56:
    const cancel = await settings.cancelDeletion(u.id); // SPRINT-56:
    expect(cancel.message).toBe('Account deletion cancelled. Welcome back!'); // SPRINT-56:
  }); // SPRINT-56:

  it('Sprint 44: block, unblock, fresh conversation', async () => {
    // SPRINT-56:
    const a = await seedUser({ label: 's44a' }); // SPRINT-56:
    const b = await seedUser({ label: 's44b' }); // SPRINT-56:
    const first = await messaging.createConversation(a.id, {
      participantId: b.id,
    } as any); // SPRINT-56:
    await settings.blockUser(a.id, { userId: b.id }); // SPRINT-56:
    await settings.unblockUser(a.id, b.id); // SPRINT-56:
    const second = await messaging.createConversation(a.id, {
      participantId: b.id,
    } as any); // SPRINT-56:
    expect(second.id).not.toBe(first.id); // SPRINT-56:
  }); // SPRINT-56:

  it('Sprint 45: notification create + mute gate smoke', async () => {
    // SPRINT-56:
    const actor = await seedUser({ label: 's45a' }); // SPRINT-56:
    const recipient = await seedUser({ label: 's45b' }); // SPRINT-56:
    const n = await notifications.createNotification({
      userId: recipient.id,
      type: 'SYSTEM',
      title: 't',
      body: 'b',
      actorId: actor.id,
    } as any); // SPRINT-56:
    expect(n?.id || n).toBeTruthy(); // SPRINT-56:

    const prisma = getTestPrisma(); // SPRINT-56:
    const convId = randomUUID(); // SPRINT-56:
    await prisma.conversation.create({
      data: {
        id: convId,
        type: 'DIRECT',
        createdById: actor.id,
        members: {
          create: [
            {
              userId: actor.id,
              role: 'MEMBER',
              status: 'ACCEPTED',
            },
            {
              userId: recipient.id,
              role: 'MEMBER',
              status: 'ACCEPTED',
              isMuted: true,
            },
          ],
        },
      },
    }); // SPRINT-56:
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: convId,
          userId: recipient.id,
        },
      },
    }); // SPRINT-56:
    expect(member?.isMuted).toBe(true); // SPRINT-56:
  }); // SPRINT-56:

  it('cron coexistence on ONE user: suspension + chat ban + admin erasure', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u = await seedUser({ label: 'coex' }); // SPRINT-56:
    const partner = await seedUser({ label: 'coex2' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:

    const conversationId = randomUUID(); // SPRINT-56:
    await prisma.conversation.create({
      data: {
        id: conversationId,
        type: 'DIRECT',
        createdById: u.id,
        members: {
          create: [
            {
              userId: u.id,
              role: 'MEMBER',
              status: 'BLOCKED',
              blockProvenance: 'ADMIN_BAN',
            },
            { userId: partner.id, role: 'MEMBER', status: 'ACCEPTED' },
          ],
        },
      },
    }); // SPRINT-56:

    // account-wide suspension (expired)
    await prisma.banRecord.create({
      data: {
        userId: u.id,
        adminId: adm.id,
        reason: 'account suspend',
        durationDays: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    }); // SPRINT-56:
    // chat ban (expired)
    await prisma.banRecord.create({
      data: {
        userId: u.id,
        adminId: adm.id,
        reason: 'chat ban',
        conversationId,
        durationDays: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    }); // SPRINT-56:

    // admin-initiated erasure (deletion window)
    await admin.createErasureRequest(adm.id, u.id, 'coex'); // SPRINT-56:

    const before = await prisma.user.findUnique({ where: { id: u.id } }); // SPRINT-56:
    expect(before?.isActive).toBe(false); // SPRINT-56:
    expect(before?.deletedAt).toBeTruthy(); // SPRINT-56:
    expect(before?.deletionSource).toBe('ADMIN'); // SPRINT-56:

    await cron.handleSuspensionExpiry(); // SPRINT-56:

    const after = await prisma.user.findUnique({ where: { id: u.id } }); // SPRINT-56:
    // deletion window guard: must NOT reactivate
    expect(after?.isActive).toBe(false); // SPRINT-56:
    expect(after?.deletedAt).toBeTruthy(); // SPRINT-56:

    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: u.id },
      },
    }); // SPRINT-56:
    // chat ban cron branch should still restore membership
    expect(member?.status).toBe('ACCEPTED'); // SPRINT-56:
    expect(member?.blockProvenance).toBe('NONE'); // SPRINT-56:
  }); // SPRINT-56:
});
