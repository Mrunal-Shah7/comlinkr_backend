/**
 * SPRINT-56 Phase 8 — Sprint 55 privacy export/erasure/self-cancel/audit catalogue.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AdminService } from '../../src/modules/admin/admin.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { appBaseUrl, createTestApp } from '../helpers/app';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';

/** Exact cascade table keys recorded in SPRINT-55-NOTES.md Phase 1.1 (export scope). */
const SPRINT55_EXPORT_KEYS = [
  // SPRINT-56:
  'AuthProvider',
  'UserLocation',
  'RoommatePreferences',
  'FeedPost',
  'FeedPostMedia',
  'FeedLike',
  'FeedComment',
  'FeedSave',
  'HousingListing',
  'HousingImage',
  'HousingInterest',
  'HousingSave',
  'SharedSpace',
  'SharedSpaceImage',
  'SharedSpaceApplication',
  'SharedSpaceSave',
  'Restaurant',
  'RestaurantImage',
  'RestaurantReview',
  'RestaurantReservation',
  'RestaurantFavorite',
  'RestaurantSave',
  'CommunityQuestion',
  'CommunityAnswer',
  'CommunityUpvote',
  'CommunitySave',
  'CommunityPollVote',
  'NeighborhoodMoodVote',
  'Conversation',
  'ConversationMember',
  'Message',
  'Event',
  'EventImage',
  'EventAttendee',
  'EventSave',
  'Story',
  'StoryComment',
  'StoryLike',
  'StorySave',
  'Challenge',
  'ChallengeParticipant',
  'BadgeApplication',
  'BadgeDocument',
  'UserBadge',
  'Notification',
  'NotificationPreference',
  'PrivacySettings',
  'BlockedUser',
  'RoommateSave',
  'PushToken',
  'PushDevice',
  'BroadcastNotification',
  'SupportTicket',
  'AdminPoll',
  'AdminPollOption',
  'AdminPollVote',
  'ContentReport',
  'ListingReport',
  'NewsArticleLike',
  'NewsArticleComment',
  'NewsArticleSave',
]; // SPRINT-56:

describe('SPRINT-56 / Sprint 55', () => {
  let app: INestApplication; // SPRINT-56:
  let base: string; // SPRINT-56:
  let admin: AdminService; // SPRINT-56:
  let settings: SettingsService; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    app = await createTestApp(); // SPRINT-56:
    base = appBaseUrl(app); // SPRINT-56:
    admin = app.get(AdminService); // SPRINT-56:
    settings = app.get(SettingsService); // SPRINT-56:
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

  it('data-export keys match SPRINT-55-NOTES list; EventReview absent; download admin-only', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const user = await seedUser({ label: 'ex' }); // SPRINT-56:
    const nonAdmin = await seedUser({ label: 'na' }); // SPRINT-56:

    const created = await admin.createDataExport(adm.id, user.id, 'test'); // SPRINT-56:
    const record = await getTestPrisma().privacyRequest.findUnique({
      where: { id: created.privacyRequestId },
    }); // SPRINT-56:
    const payload = record!.exportPayload as Record<string, unknown>; // SPRINT-56:
    const missing = SPRINT55_EXPORT_KEYS.filter((k) => !(k in payload)); // SPRINT-56:
    expect(missing).toEqual([]); // SPRINT-56:
    expect('EventReview' in payload).toBe(false); // SPRINT-56:

    await request(base)
      .get(`/admin/privacy-requests/${created.privacyRequestId}/export-download`)
      .set('Cookie', nonAdmin.cookie)
      .expect(403); // SPRINT-56:
    await request(base)
      .get(`/admin/privacy-requests/${created.privacyRequestId}/export-download`)
      .set('Cookie', adm.cookie)
      .expect(200); // SPRINT-56:
  }); // SPRINT-56:

  it('self-cancel gap: ADMIN refused; SELF unaffected (before/after)', async () => {
    // SPRINT-56: dedicated self-cancel-gap coverage
    const adm = await seedAdmin(); // SPRINT-56:
    const adminTarget = await seedUser({ label: 'sca' }); // SPRINT-56:
    const selfTarget = await seedUser({ label: 'scs' }); // SPRINT-56:

    await admin.createErasureRequest(adm.id, adminTarget.id, 'erase'); // SPRINT-56:
    await expect(settings.cancelDeletion(adminTarget.id)).rejects.toThrow(
      /administrator/i,
    ); // SPRINT-56:

    const before = await settings.requestAccountDeletion(selfTarget.id); // SPRINT-56:
    expect(before.message).toBe('Account scheduled for deletion'); // SPRINT-56:
    const mid = await getTestPrisma().user.findUnique({
      where: { id: selfTarget.id },
    }); // SPRINT-56:
    expect(mid?.deletionSource).toBe('SELF'); // SPRINT-56:
    const after = await settings.cancelDeletion(selfTarget.id); // SPRINT-56:
    expect(after.message).toBe('Account deletion cancelled. Welcome back!'); // SPRINT-56:
    const restored = await getTestPrisma().user.findUnique({
      where: { id: selfTarget.id },
    }); // SPRINT-56:
    expect(restored?.isActive).toBe(true); // SPRINT-56:
    expect(restored?.deletedAt).toBeNull(); // SPRINT-56:
    expect(restored?.deletionSource).toBe('NONE'); // SPRINT-56:
  }); // SPRINT-56:

  it('erasure request mirrors soft-delete + ADMIN tag; approve/reject gating', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u1 = await seedUser({ label: 'er1' }); // SPRINT-56:
    const u2 = await seedUser({ label: 'er2' }); // SPRINT-56:
    const exportUser = await seedUser({ label: 'erx' }); // SPRINT-56:

    const erase = await admin.createErasureRequest(adm.id, u1.id); // SPRINT-56:
    const state = await getTestPrisma().user.findUnique({ where: { id: u1.id } }); // SPRINT-56:
    expect(state?.isActive).toBe(false); // SPRINT-56:
    expect(state?.deletedAt).toBeTruthy(); // SPRINT-56:
    expect(state?.deletionSource).toBe('ADMIN'); // SPRINT-56:

    const beforeApprove = await getTestPrisma().user.findUnique({
      where: { id: u1.id },
    }); // SPRINT-56:
    // wrong — need pending on u2 for approve demo; use erase on u1 for reject restore
    await admin.rejectPrivacyRequest(adm.id, erase.privacyRequestId); // SPRINT-56:
    const restored = await getTestPrisma().user.findUnique({
      where: { id: u1.id },
    }); // SPRINT-56:
    expect(restored?.isActive).toBe(true); // SPRINT-56:
    expect(restored?.deletionSource).toBe('NONE'); // SPRINT-56:

    const erase2 = await admin.createErasureRequest(adm.id, u2.id); // SPRINT-56:
    const before = await getTestPrisma().user.findUnique({ where: { id: u2.id } }); // SPRINT-56:
    await admin.approvePrivacyRequest(adm.id, erase2.privacyRequestId); // SPRINT-56:
    const after = await getTestPrisma().user.findUnique({ where: { id: u2.id } }); // SPRINT-56:
    expect(after?.isActive).toBe(before?.isActive); // SPRINT-56:
    expect(String(after?.deletedAt)).toBe(String(before?.deletedAt)); // SPRINT-56:
    expect(after?.deletionSource).toBe('ADMIN'); // SPRINT-56:

    const exp = await admin.createDataExport(adm.id, exportUser.id); // SPRINT-56:
    await expect(
      admin.approvePrivacyRequest(adm.id, exp.privacyRequestId),
    ).rejects.toThrow(/erasure/i); // SPRINT-56:
    await expect(
      admin.rejectPrivacyRequest(adm.id, exp.privacyRequestId),
    ).rejects.toThrow(/erasure/i); // SPRINT-56:
    expect(beforeApprove?.deletionSource).toBe('ADMIN'); // SPRINT-56:
  }); // SPRINT-56:

  it('privacy-requests list retains snapshot after hard-delete', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u = await seedUser({ label: 'snap' }); // SPRINT-56:
    const erase = await admin.createErasureRequest(adm.id, u.id); // SPRINT-56:
    await getTestPrisma().user.update({
      where: { id: u.id },
      data: { deletedAt: new Date(Date.now() - 1000) },
    }); // SPRINT-56:
    await settings.performHardDelete(u.id); // SPRINT-56:
    const list = await admin.getPrivacyRequests(adm.id, {
      page: 1,
      pageSize: 50,
    }); // SPRINT-56:
    const row = list.data.find((r: any) => r.id === erase.privacyRequestId); // SPRINT-56:
    expect(row).toBeTruthy(); // SPRINT-56:
    expect(row.userId).toBeNull(); // SPRINT-56:
    expect(row.snapshotUsername).toBe(u.username); // SPRINT-56:
    expect(row.snapshotEmail).toBe(u.email); // SPRINT-56:
  }); // SPRINT-56:

  it('four privacy mutating routes write audit-log catalogue entries', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const u1 = await seedUser({ label: 'au1' }); // SPRINT-56:
    const u2 = await seedUser({ label: 'au2' }); // SPRINT-56:
    const u3 = await seedUser({ label: 'au3' }); // SPRINT-56:

    await request(base)
      .post(`/admin/users/${u1.id}/data-export`)
      .set('Cookie', adm.cookie)
      .send({ reason: 'audit-export' })
      .expect((res) => expect(res.status).toBeLessThan(400)); // SPRINT-56:

    const erase = await request(base)
      .post(`/admin/users/${u2.id}/erasure-request`)
      .set('Cookie', adm.cookie)
      .send({ reason: 'audit-erase' }); // SPRINT-56:
    expect(erase.status).toBeLessThan(400); // SPRINT-56:
    const eraseId =
      erase.body.data?.privacyRequestId || erase.body.privacyRequestId; // SPRINT-56:

    await request(base)
      .patch(`/admin/privacy-requests/${eraseId}/approve`)
      .set('Cookie', adm.cookie)
      .expect(200); // SPRINT-56:

    const erase2 = await request(base)
      .post(`/admin/users/${u3.id}/erasure-request`)
      .set('Cookie', adm.cookie)
      .send({ reason: 'audit-reject' }); // SPRINT-56:
    const erase2Id =
      erase2.body.data?.privacyRequestId || erase2.body.privacyRequestId; // SPRINT-56:
    await request(base)
      .patch(`/admin/privacy-requests/${erase2Id}/reject`)
      .set('Cookie', adm.cookie)
      .expect(200); // SPRINT-56:

    const logs = await getTestPrisma().adminAuditLog.findMany({
      where: { adminId: adm.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }); // SPRINT-56:
    const patterns = logs.map((l) => l.routePattern); // SPRINT-56:
    expect(patterns).toEqual(
      expect.arrayContaining([
        '/admin/users/:id/data-export',
        '/admin/users/:id/erasure-request',
        '/admin/privacy-requests/:id/approve',
        '/admin/privacy-requests/:id/reject',
      ]),
    ); // SPRINT-56:
  }); // SPRINT-56:
});
