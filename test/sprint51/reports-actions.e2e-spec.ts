/**
 * SPRINT-56 Phase 4 — Sprint 51 report queue, actions, warnings/bans, suspension cron.
 */
import { randomUUID } from 'crypto';
import { AdminReportAction } from '../../src/modules/admin/dto/report-action.dto';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminCronService } from '../../src/modules/admin/admin.cron';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';
import { createAppContext } from '../helpers/context';
import type { NestApplicationContext } from '@nestjs/core';

describe('SPRINT-56 / Sprint 51', () => {
  let ctx: NestApplicationContext; // SPRINT-56:
  let admin: AdminService; // SPRINT-56:
  let cron: AdminCronService; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    ctx = await createAppContext(); // SPRINT-56:
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

  async function pendingReport(
    targetType: string,
    targetId: string,
    reporterId: string,
  ) {
    // SPRINT-56:
    return getTestPrisma().listingReport.create({
      data: {
        reporterId,
        targetType: targetType as any,
        targetId,
        reason: 's56',
        status: 'PENDING',
      },
    }); // SPRINT-56:
  }

  it('GET /admin/reports filters by targetType, targetId, reporterId and combined', async () => {
    // SPRINT-56:
    const a = await seedAdmin(); // SPRINT-56:
    const r1 = await seedUser({ label: 'r1' }); // SPRINT-56:
    const r2 = await seedUser({ label: 'r2' }); // SPRINT-56:
    const t1 = await seedUser({ label: 't1' }); // SPRINT-56:
    const t2 = await seedUser({ label: 't2' }); // SPRINT-56:
    await pendingReport('USER', t1.id, r1.id); // SPRINT-56:
    await pendingReport('USER', t2.id, r1.id); // SPRINT-56:
    await pendingReport('EVENT', randomUUID(), r2.id); // SPRINT-56:

    const byType = await admin.getUnifiedReports({ targetType: 'USER' as any }); // SPRINT-56:
    expect(byType.data.every((x: any) => x.targetType === 'USER')).toBe(true); // SPRINT-56:
    expect(byType.data.length).toBe(2); // SPRINT-56:

    const byTarget = await admin.getUnifiedReports({ targetId: t1.id }); // SPRINT-56:
    expect(byTarget.data).toHaveLength(1); // SPRINT-56:
    expect(byTarget.data[0].targetId).toBe(t1.id); // SPRINT-56:

    const byReporter = await admin.getUnifiedReports({ reporterId: r2.id }); // SPRINT-56:
    expect(byReporter.data).toHaveLength(1); // SPRINT-56:

    const combo = await admin.getUnifiedReports({
      targetType: 'USER' as any,
      targetId: t1.id,
      reporterId: r1.id,
    }); // SPRINT-56:
    expect(combo.data).toHaveLength(1); // SPRINT-56:
    expect(a.role).toBe('ADMIN'); // SPRINT-56:
  }); // SPRINT-56:

  it('submits reports for widened target types onto ListingReport', async () => {
    // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const reporter = await seedUser({ label: 'rep' }); // SPRINT-56:
    const target = await seedUser({ label: 'tgt' }); // SPRINT-56:
    const post = await prisma.feedPost.create({
      data: {
        authorId: target.id,
        title: 'p',
        content: 'c',
        category: 'COMMUNITY',
        tags: [],
      },
    }); // SPRINT-56:
    const q = await prisma.communityQuestion.create({
      data: {
        authorId: target.id,
        title: 'q',
        body: 'b',
        category: 'GENERAL',
        tags: [],
        city: 'Testville',
      },
    }); // SPRINT-56:
    const ans = await prisma.communityAnswer.create({
      data: { questionId: q.id, authorId: target.id, content: 'a' },
    }); // SPRINT-56:
    const event = await prisma.event.create({
      data: {
        authorId: target.id,
        title: 'e',
        description: 'd',
        category: 'SOCIAL',
        format: 'IN_PERSON',
        date: new Date(),
        startTime: '10:00',
        venue: 'v',
        city: 'c',
      },
    }); // SPRINT-56:
    const conv = await prisma.conversation.create({
      data: {
        type: 'DIRECT',
        createdById: reporter.id,
        members: {
          create: [
            { userId: reporter.id, role: 'MEMBER', status: 'ACCEPTED' },
            { userId: target.id, role: 'MEMBER', status: 'ACCEPTED' },
          ],
        },
        messages: {
          create: {
            senderId: target.id,
            content: 'hi',
            type: 'TEXT',
          },
        },
      },
      include: { messages: true },
    }); // SPRINT-56:

    const types = [
      ['USER', target.id],
      ['COMMUNITY_POST', post.id],
      ['COMMUNITY_MEMBER', target.id],
      ['COMMUNITY_QUESTION', q.id],
      ['COMMUNITY_ANSWER', ans.id],
      ['EVENT', event.id],
      ['CHAT_MESSAGE', conv.messages[0].id],
    ] as const; // SPRINT-56:

    for (const [targetType, targetId] of types) {
      // SPRINT-56:
      const row = await pendingReport(targetType, targetId, reporter.id); // SPRINT-56:
      expect(row.targetType).toBe(targetType); // SPRINT-56:
      expect(row.status).toBe('PENDING'); // SPRINT-56:
    } // SPRINT-56:
  }); // SPRINT-56:

  it('WARN writes WarningRecord and resolves; SUSPEND needs duration and deactivates', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const target = await seedUser({ label: 'warn' }); // SPRINT-56:
    const reporter = await seedUser({ label: 'wr' }); // SPRINT-56:
    const report = await pendingReport('USER', target.id, reporter.id); // SPRINT-56:

    await admin.actionReport(adm.id, report.id, {
      action: AdminReportAction.WARN,
      reason: 'be nice',
    }); // SPRINT-56:
    const warnings = await getTestPrisma().warningRecord.findMany({
      where: { userId: target.id },
    }); // SPRINT-56:
    expect(warnings).toHaveLength(1); // SPRINT-56:
    expect(warnings[0].reason).toBe('be nice'); // SPRINT-56:
    expect(
      (await getTestPrisma().listingReport.findUnique({ where: { id: report.id } }))
        ?.status,
    ).toBe('RESOLVED'); // SPRINT-56:

    const report2 = await pendingReport('USER', target.id, reporter.id); // SPRINT-56:
    await expect(
      admin.actionReport(adm.id, report2.id, {
        action: AdminReportAction.SUSPEND,
        reason: 'no duration',
      }),
    ).rejects.toThrow(); // SPRINT-56:

    await admin.actionReport(adm.id, report2.id, {
      action: AdminReportAction.SUSPEND,
      reason: 'temp',
      durationDays: 3,
    }); // SPRINT-56:
    const user = await getTestPrisma().user.findUnique({
      where: { id: target.id },
    }); // SPRINT-56:
    expect(user?.isActive).toBe(false); // SPRINT-56:
    const bans = await getTestPrisma().banRecord.findMany({
      where: { userId: target.id },
    }); // SPRINT-56:
    expect(bans).toHaveLength(1); // SPRINT-56:
    expect(bans[0].durationDays).toBe(3); // SPRINT-56:
    expect(bans[0].expiresAt).toBeTruthy(); // SPRINT-56:
  }); // SPRINT-56:

  it('REMOVE_CONTENT deletes community post without orphaning likes/comments/saves', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const author = await seedUser({ label: 'auth' }); // SPRINT-56:
    const other = await seedUser({ label: 'oth' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const post = await prisma.feedPost.create({
      data: {
        authorId: author.id,
        title: 't',
        content: 'c',
        category: 'COMMUNITY',
        tags: [],
        likes: { create: { userId: other.id } },
        comments: { create: { userId: other.id, content: 'x' } },
        saves: { create: { userId: other.id } },
      },
    }); // SPRINT-56:
    const report = await pendingReport('COMMUNITY_POST', post.id, other.id); // SPRINT-56:
    await admin.actionReport(adm.id, report.id, {
      action: AdminReportAction.REMOVE_CONTENT,
      reason: 'spam',
    }); // SPRINT-56:
    expect(await prisma.feedPost.findUnique({ where: { id: post.id } })).toBeNull(); // SPRINT-56:
    expect(await prisma.feedLike.count({ where: { feedPostId: post.id } })).toBe(0); // SPRINT-56:
    expect(await prisma.feedComment.count({ where: { feedPostId: post.id } })).toBe(0); // SPRINT-56:
    expect(await prisma.feedSave.count({ where: { feedPostId: post.id } })).toBe(0); // SPRINT-56:
  }); // SPRINT-56:

  it('rejects housing/restaurant via action endpoint; dedicated dismiss still works', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const owner = await seedUser({ label: 'own' }); // SPRINT-56:
    const reporter = await seedUser({ label: 'hr' }); // SPRINT-56:
    const listing = await getTestPrisma().housingListing.create({
      data: {
        ownerId: owner.id,
        title: 'l',
        description: 'd',
        propertyType: 'APARTMENT',
        price: 100,
        bedrooms: 1,
        bathrooms: 1,
        address: 'a',
        city: 'c',
        country: 'US',
      },
    }); // SPRINT-56:
    const report = await pendingReport('HOUSING', listing.id, reporter.id); // SPRINT-56:
    await expect(
      admin.actionReport(adm.id, report.id, {
        action: AdminReportAction.WARN,
        reason: 'x',
      }),
    ).rejects.toThrow(/Housing and restaurant/); // SPRINT-56:
    await admin.dismissReport(adm.id, report.id); // SPRINT-56:
    expect(
      (await getTestPrisma().listingReport.findUnique({ where: { id: report.id } }))
        ?.status,
    ).toBe('DISMISSED'); // SPRINT-56:
  }); // SPRINT-56:

  it('suspension cron restores expired ban but not a user in the deletion window', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u1 = await seedUser({ label: 'cron1' }); // SPRINT-56:
    const u2 = await seedUser({ label: 'cron2' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:

    await prisma.user.update({
      where: { id: u1.id },
      data: { isActive: false },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: u1.id,
        adminId: adm.id,
        reason: 'expired',
        durationDays: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    }); // SPRINT-56:

    const delAt = new Date();
    delAt.setDate(delAt.getDate() + 15); // SPRINT-56:
    await prisma.user.update({
      where: { id: u2.id },
      data: { isActive: false, deletedAt: delAt },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: u2.id,
        adminId: adm.id,
        reason: 'expired+delete',
        durationDays: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    }); // SPRINT-56:

    await cron.handleSuspensionExpiry(); // SPRINT-56:

    expect(
      (await prisma.user.findUnique({ where: { id: u1.id } }))?.isActive,
    ).toBe(true); // SPRINT-56:
    expect(
      (await prisma.user.findUnique({ where: { id: u2.id } }))?.isActive,
    ).toBe(false); // SPRINT-56:
    expect(
      (await prisma.banRecord.findFirst({ where: { userId: u2.id } }))?.liftedAt,
    ).toBeTruthy(); // SPRINT-56:
  }); // SPRINT-56:

  it('rejects invalid action/target pairs and leaves report PENDING', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const author = await seedUser({ label: 'inv' }); // SPRINT-56:
    const reporter = await seedUser({ label: 'ir' }); // SPRINT-56:
    const post = await getTestPrisma().feedPost.create({
      data: {
        authorId: author.id,
        title: 't',
        content: 'c',
        category: 'COMMUNITY',
        tags: [],
      },
    }); // SPRINT-56:
    const report = await pendingReport('COMMUNITY_POST', post.id, reporter.id); // SPRINT-56:
    await expect(
      admin.actionReport(adm.id, report.id, {
        action: AdminReportAction.WARN,
        reason: 'wrong',
      }),
    ).rejects.toThrow(); // SPRINT-56:
    expect(
      (await getTestPrisma().listingReport.findUnique({ where: { id: report.id } }))
        ?.status,
    ).toBe('PENDING'); // SPRINT-56:
  }); // SPRINT-56:
});
