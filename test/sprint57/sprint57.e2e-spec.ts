/**
 * SPRINT-57 — feed verification badges, badge review queue filtering,
 * trending pagination, and report-count aggregates.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { appBaseUrl, createTestApp } from '../helpers/app';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
  type SeededUser,
} from '../helpers/fixtures';

describe('SPRINT-57', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await createTestApp();
    base = appBaseUrl(app);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await disconnectFixtures();
  });

  async function grantBadge(userId: string, badgeType: 'LANDLORD' | 'AGENCY') {
    const prisma = getTestPrisma();
    const application = await prisma.badgeApplication.create({
      data: {
        userId,
        badgeType,
        status: 'APPROVED',
        fullLegalName: 'Test Legal Name',
        businessPhone: '+10000000000',
      },
    });
    await prisma.userBadge.create({
      data: { userId, badgeType, applicationId: application.id },
    });
    return application;
  }

  async function createPost(author: SeededUser, title: string) {
    const prisma = getTestPrisma();
    return prisma.feedPost.create({
      data: {
        authorId: author.id,
        title,
        content: 'body',
        category: 'COMMUNITY',
        isPublished: true,
      },
    });
  }

  // -- #1 author.verified ----------------------------------------------------
  it('reports author.verified consistently across every feed route', async () => {
    const badged = await seedUser({ label: 'badged' });
    const plain = await seedUser({ label: 'plain' });
    await grantBadge(badged.id, 'LANDLORD');

    const badgedPost = await createPost(badged, 'badged post');
    const plainPost = await createPost(plain, 'plain post');

    const list = await request(base)
      .get('/feed')
      .set('Cookie', plain.cookie)
      .expect(200);
    const rows: any[] = list.body.data;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(badgedPost.id).author.verified).toBe(true);
    expect(byId.get(badgedPost.id).author.badges).toEqual(['LANDLORD']);
    expect(byId.get(plainPost.id).author.verified).toBe(false);
    expect(byId.get(plainPost.id).author.badges).toEqual([]);

    const detail = await request(base)
      .get('/feed/' + badgedPost.id)
      .set('Cookie', plain.cookie)
      .expect(200);
    expect(detail.body.data.author.verified).toBe(true);

    // The saved list is the fourth include site, and the easiest one to miss.
    await request(base)
      .post('/feed/' + badgedPost.id + '/save')
      .set('Cookie', plain.cookie)
      .expect(201);
    const saved = await request(base)
      .get('/feed/saved')
      .set('Cookie', plain.cookie)
      .expect(200);
    expect(saved.body.data[0].author.verified).toBe(true);
  });

  // -- view counting ---------------------------------------------------------
  it('counts a viewer once and never counts the author', async () => {
    const author = await seedUser({ label: 'author' });
    const viewer = await seedUser({ label: 'viewer' });
    const post = await createPost(author, 'viewed post');

    const first = await request(base)
      .post('/feed/' + post.id + '/view')
      .set('Cookie', viewer.cookie)
      .expect(201);
    expect(first.body.data).toEqual({ viewsCount: 1, counted: true });

    const second = await request(base)
      .post('/feed/' + post.id + '/view')
      .set('Cookie', viewer.cookie)
      .expect(201);
    expect(second.body.data).toEqual({ viewsCount: 1, counted: false });

    const own = await request(base)
      .post('/feed/' + post.id + '/view')
      .set('Cookie', author.cookie)
      .expect(201);
    expect(own.body.data.counted).toBe(false);
    expect(own.body.data.viewsCount).toBe(1);
  });

  // -- #2 badge queue status filter + search ---------------------------------
  it('defaults to the pending queue and opens up history via status/search', async () => {
    const admin = await seedAdmin();
    const pendingUser = await seedUser({ label: 'pending' });
    const approvedUser = await seedUser({ label: 'approved' });
    const prisma = getTestPrisma();

    await prisma.badgeApplication.create({
      data: {
        userId: pendingUser.id,
        badgeType: 'LANDLORD',
        status: 'PENDING',
        fullLegalName: 'Amelia Pending',
        businessPhone: '+10000000001',
      },
    });
    await prisma.badgeApplication.create({
      data: {
        userId: approvedUser.id,
        badgeType: 'AGENCY',
        status: 'APPROVED',
        fullLegalName: 'Bruno Approved',
        businessPhone: '+10000000002',
      },
    });

    const def = await request(base)
      .get('/admin/badges/applications')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(def.body.data).toHaveLength(1);
    expect(def.body.data[0].status).toBe('PENDING');

    const approved = await request(base)
      .get('/admin/badges/applications?status=APPROVED')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(approved.body.data).toHaveLength(1);
    expect(approved.body.data[0].fullLegalName).toBe('Bruno Approved');

    const all = await request(base)
      .get('/admin/badges/applications?status=ALL')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(all.body.meta.total).toBe(2);

    const search = await request(base)
      .get('/admin/badges/applications?status=ALL&search=bruno')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].fullLegalName).toBe('Bruno Approved');

    const byUsername = await request(base)
      .get(
        '/admin/badges/applications?status=ALL&search=' + approvedUser.username,
      )
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(byUsername.body.data).toHaveLength(1);

    await request(base)
      .get('/admin/badges/applications?status=BOGUS')
      .set('Cookie', admin.cookie)
      .expect(400);
  });

  // -- #5 trending pagination + #6a report counts ----------------------------
  it('paginates trending and reports real ListingReport counts', async () => {
    const admin = await seedAdmin();
    const author = await seedUser({ label: 'author' });
    const reporter = await seedUser({ label: 'reporter' });
    const prisma = getTestPrisma();

    const posts = [];
    for (let i = 0; i < 3; i++) {
      posts.push(await createPost(author, 'trending ' + i));
    }
    await prisma.feedPost.update({
      where: { id: posts[0].id },
      data: { viewsCount: 99 },
    });
    await prisma.listingReport.createMany({
      data: [
        {
          reporterId: reporter.id,
          targetType: 'COMMUNITY_POST',
          targetId: posts[0].id,
          reason: 'spam',
        },
        {
          reporterId: author.id,
          targetType: 'COMMUNITY_POST',
          targetId: posts[0].id,
          reason: 'spam again',
        },
      ],
    });

    const page1 = await request(base)
      .get('/admin/feed/trending?page=1&pageSize=2')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(Array.isArray(page1.body.data)).toBe(true);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toMatchObject({
      page: 1,
      total: 3,
      totalPages: 2,
    });
    expect(page1.body.data[0].id).toBe(posts[0].id);
    expect(page1.body.data[0].reportCount).toBe(2);
    expect(page1.body.data[1].reportCount).toBe(0);

    const page2 = await request(base)
      .get('/admin/feed/trending?page=2&pageSize=2')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);

    const feed = await request(base)
      .get('/admin/feed')
      .set('Cookie', admin.cookie)
      .expect(200);
    const reported = feed.body.data.find((p: any) => p.id === posts[0].id);
    expect(reported.reportCount).toBe(2);
  });

  // -- roommate aggregates ---------------------------------------------------
  it('returns real age, mutual-match and report counts for roommates', async () => {
    const admin = await seedAdmin();
    const a = await seedUser({ label: 'rma' });
    const b = await seedUser({ label: 'rmb' });
    const c = await seedUser({ label: 'rmc' });
    const prisma = getTestPrisma();

    await prisma.user.update({
      where: { id: a.id },
      data: { dateOfBirth: new Date('1995-06-15T00:00:00.000Z') },
    });
    await grantBadge(a.id, 'AGENCY');
    for (const u of [a, b, c]) {
      await prisma.roommatePreferences.create({
        data: { userId: u.id, isLooking: true },
      });
    }

    // a <-> b is mutual; a -> c is one-way and must not count.
    await prisma.roommateSave.createMany({
      data: [
        { userId: a.id, savedUserId: b.id },
        { userId: b.id, savedUserId: a.id },
        { userId: a.id, savedUserId: c.id },
      ],
    });
    await prisma.listingReport.create({
      data: {
        reporterId: c.id,
        targetType: 'COMMUNITY_MEMBER',
        targetId: a.id,
        reason: 'rude',
      },
    });

    const res = await request(base)
      .get('/admin/roommates')
      .set('Cookie', admin.cookie)
      .expect(200);
    const rowA = res.body.data.find((r: any) => r.userId === a.id);
    const rowC = res.body.data.find((r: any) => r.userId === c.id);

    const now = new Date();
    const hadBirthday =
      now.getUTCMonth() > 5 ||
      (now.getUTCMonth() === 5 && now.getUTCDate() >= 15);
    const expectedAge = now.getUTCFullYear() - 1995 - (hadBirthday ? 0 : 1);

    expect(rowA.age).toBe(expectedAge);
    expect(rowA.matchCount).toBe(1);
    expect(rowA.reportCount).toBe(1);
    expect(rowA.verified).toBe(true);

    expect(rowC.age).toBeNull();
    expect(rowC.matchCount).toBe(0);
    expect(rowC.reportCount).toBe(0);
    expect(rowC.verified).toBe(false);
  });
});
