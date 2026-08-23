/**
 * SPRINT-56 Phase 5 — Sprint 52 case files, audit log, cascade safety.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AdminService } from '../../src/modules/admin/admin.service';
import { appBaseUrl, createTestApp } from '../helpers/app';
import { createAppContext } from '../helpers/context';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';
import type { NestApplicationContext } from '@nestjs/core';

describe('SPRINT-56 / Sprint 52', () => {
  let ctx: NestApplicationContext; // SPRINT-56:
  let admin: AdminService; // SPRINT-56:
  let httpApp: INestApplication; // SPRINT-56:
  let base: string; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    ctx = await createAppContext(); // SPRINT-56:
    admin = ctx.get(AdminService); // SPRINT-56:
    httpApp = await createTestApp(); // SPRINT-56:
    base = appBaseUrl(httpApp); // SPRINT-56:
  }); // SPRINT-56:

  beforeEach(async () => {
    // SPRINT-56:
    await resetDatabase(); // SPRINT-56:
  }); // SPRINT-56:

  afterAll(async () => {
    // SPRINT-56:
    await httpApp.close(); // SPRINT-56:
    await ctx.close(); // SPRINT-56:
    await disconnectFixtures(); // SPRINT-56:
  }); // SPRINT-56:

  it('warnings and ban-history with active/expired/lifted and 404', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u = await seedUser({ label: 'case' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:

    await prisma.warningRecord.create({
      data: { userId: u.id, adminId: adm.id, reason: 'w1' },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: u.id,
        adminId: adm.id,
        reason: 'open',
        durationDays: null,
        expiresAt: null,
      },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: u.id,
        adminId: adm.id,
        reason: 'expired',
        durationDays: 1,
        expiresAt: new Date(Date.now() - 60_000),
      },
    }); // SPRINT-56:
    await prisma.banRecord.create({
      data: {
        userId: u.id,
        adminId: adm.id,
        reason: 'lifted',
        durationDays: 7,
        expiresAt: new Date(Date.now() + 86400000),
        liftedAt: new Date(),
        liftedByAdminId: adm.id,
      },
    }); // SPRINT-56:

    const warnings = await admin.getUserWarnings(adm.id, u.id); // SPRINT-56:
    expect(warnings.data).toHaveLength(1); // SPRINT-56:

    const bans = await admin.getUserBanHistory(adm.id, u.id); // SPRINT-56:
    const byReason = Object.fromEntries(
      bans.data.map((b: any) => [b.reason, b.isActive]),
    ); // SPRINT-56:
    expect(byReason.open).toBe(true); // SPRINT-56:
    expect(byReason.expired).toBe(false); // SPRINT-56:
    expect(byReason.lifted).toBe(false); // SPRINT-56:

    await expect(
      admin.getUserWarnings(adm.id, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/not found/i); // SPRINT-56:
  }); // SPRINT-56:

  it('GET /admin/audit-log paginates', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    for (let i = 0; i < 3; i++) {
      // SPRINT-56:
      await prisma.adminAuditLog.create({
        data: {
          adminId: adm.id,
          httpMethod: 'PATCH',
          routePattern: '/admin/settings',
          targetType: 'platform_settings',
        },
      }); // SPRINT-56:
    } // SPRINT-56:
    const page1 = await admin.getAuditLog(adm.id, 1, 2); // SPRINT-56:
    expect(page1.data).toHaveLength(2); // SPRINT-56:
    expect(page1.meta.total).toBe(3); // SPRINT-56:
    expect(page1.meta.page).toBe(1); // SPRINT-56:
  }); // SPRINT-56:

  it('audit interceptor logs successful mutations across modules and skips failures', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const user = await seedUser({ label: 'aud' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:

    const routes: Array<() => Promise<any>> = [
      () =>
        request(base)
          .post(`/admin/users/${user.id}/warn`)
          .set('Cookie', adm.cookie)
          .send({ message: 'audit-warn' }),
      () =>
        request(base)
          .patch('/admin/settings')
          .set('Cookie', adm.cookie)
          .send({ maintenanceMode: false }),
      () =>
        request(base)
          .post('/admin/notifications/broadcast')
          .set('Cookie', adm.cookie)
          .send({
            title: 't',
            body: 'b',
            audienceType: 'ALL',
          }),
      () =>
        request(base)
          .post(`/admin/users/${user.id}/data-export`)
          .set('Cookie', adm.cookie)
          .send({ reason: 'audit-export' }),
    ]; // SPRINT-56:

    for (const call of routes) {
      // SPRINT-56:
      const res = await call(); // SPRINT-56:
      expect(res.status).toBeLessThan(400); // SPRINT-56:
    } // SPRINT-56:

    // failed request — no new audit for invalid warn without body message if validation fails
    const before = await prisma.adminAuditLog.count(); // SPRINT-56:
    const fail = await request(base)
      .patch('/admin/listings/not-a-real-id/moderate')
      .set('Cookie', adm.cookie)
      .send({ action: 'approve' }); // SPRINT-56:
    expect(fail.status).toBeGreaterThanOrEqual(400); // SPRINT-56:
    const after = await prisma.adminAuditLog.count(); // SPRINT-56:
    expect(after).toBe(before); // SPRINT-56:

    const logs = await prisma.adminAuditLog.findMany({
      where: { adminId: adm.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }); // SPRINT-56:
    const patterns = logs.map((l) => l.routePattern); // SPRINT-56:
    expect(patterns).toEqual(
      expect.arrayContaining([
        '/admin/users/:id/warn',
        '/admin/settings',
        '/admin/notifications/broadcast',
        '/admin/users/:id/data-export',
      ]),
    ); // SPRINT-56:
    expect(
      logs.find((l) => l.routePattern.includes('warn'))?.reason,
    ).toBe('audit-warn'); // SPRINT-56:
  }); // SPRINT-56:

  it('community-post hard-delete cascade removes likes comments saves', async () => {
    // SPRINT-56:
    const author = await seedUser({ label: 'pauth' }); // SPRINT-56:
    const other = await seedUser({ label: 'poth' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const post = await prisma.feedPost.create({
      data: {
        authorId: author.id,
        title: 't',
        content: 'c',
        category: 'COMMUNITY',
        tags: [],
        likes: { create: { userId: other.id } },
        comments: { create: { userId: other.id, content: 'c' } },
        saves: { create: { userId: other.id } },
      },
    }); // SPRINT-56:
    await prisma.feedPost.delete({ where: { id: post.id } }); // SPRINT-56:
    expect(await prisma.feedLike.count({ where: { feedPostId: post.id } })).toBe(
      0,
    ); // SPRINT-56:
    expect(
      await prisma.feedComment.count({ where: { feedPostId: post.id } }),
    ).toBe(0); // SPRINT-56:
    expect(await prisma.feedSave.count({ where: { feedPostId: post.id } })).toBe(
      0,
    ); // SPRINT-56:
  }); // SPRINT-56:
});
