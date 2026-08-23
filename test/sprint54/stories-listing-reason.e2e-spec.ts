/**
 * SPRINT-56 Phase 7 — Sprint 54 stories admin + listing moderation reason.
 */
import { AdminService } from '../../src/modules/admin/admin.service';
import { HousingService } from '../../src/modules/housing/housing.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { createAppContext } from '../helpers/context';
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
  seedUser,
} from '../helpers/fixtures';
import type { NestApplicationContext } from '@nestjs/core';

describe('SPRINT-56 / Sprint 54', () => {
  let ctx: NestApplicationContext; // SPRINT-56:
  let admin: AdminService; // SPRINT-56:
  let housing: HousingService; // SPRINT-56:
  let storage: StorageService; // SPRINT-56:

  beforeAll(async () => {
    // SPRINT-56:
    ctx = await createAppContext(); // SPRINT-56:
    admin = ctx.get(AdminService); // SPRINT-56:
    housing = ctx.get(HousingService); // SPRINT-56:
    storage = ctx.get(StorageService); // SPRINT-56:
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

  it('GET /admin/stories paginates with author info', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const author = await seedUser({ label: 'st' }); // SPRINT-56:
    await getTestPrisma().story.create({
      data: {
        authorId: author.id,
        title: 's',
        mediaType: 'PHOTO',
        category: 'EVENTS',
        mediaUrl: 'image:private:s56-story',
        expiresAt: new Date(Date.now() + 86400000),
      },
    }); // SPRINT-56:
    const list = await admin.getAdminStories(adm.id, { page: 1, pageSize: 20 }); // SPRINT-56:
    expect(list.data.length).toBeGreaterThanOrEqual(1); // SPRINT-56:
    expect(list.meta.page).toBe(1); // SPRINT-56:
    expect(list.data[0].author).toMatchObject({
      id: author.id,
      username: author.username,
    }); // SPRINT-56:
  }); // SPRINT-56:

  it('DELETE /admin/stories/:id cascades comments/likes and calls file cleanup', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const author = await seedUser({ label: 'sd' }); // SPRINT-56:
    const other = await seedUser({ label: 'so' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const mediaUrl = `image:private:s56-del-${Date.now()}`; // SPRINT-56:
    const story = await prisma.story.create({
      data: {
        authorId: author.id,
        title: 'del',
        mediaType: 'PHOTO',
        category: 'EVENTS',
        mediaUrl,
        expiresAt: new Date(Date.now() + 86400000),
        comments: {
          create: { authorId: other.id, content: 'c' },
        },
        likes: { create: { userId: other.id } },
      },
    }); // SPRINT-56:

    let deletedKey: string | null = null; // SPRINT-56:
    const orig = storage.deleteFile.bind(storage); // SPRINT-56:
    storage.deleteFile = async (key: string) => {
      deletedKey = key;
      return orig(key);
    }; // SPRINT-56:

    await admin.adminDeleteStory(adm.id, story.id); // SPRINT-56:
    expect(await prisma.story.findUnique({ where: { id: story.id } })).toBeNull(); // SPRINT-56:
    expect(await prisma.storyComment.count({ where: { storyId: story.id } })).toBe(
      0,
    ); // SPRINT-56:
    expect(await prisma.storyLike.count({ where: { storyId: story.id } })).toBe(0); // SPRINT-56:
    expect(deletedKey).toBe(mediaUrl); // SPRINT-56:
    storage.deleteFile = orig; // SPRINT-56:
  }); // SPRINT-56:

  it('listing moderation reason persists on reject, clears on approve, owner-only', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const owner = await seedUser({ label: 'lo' }); // SPRINT-56:
    const viewer = await seedUser({ label: 'lv' }); // SPRINT-56:
    const listing = await getTestPrisma().housingListing.create({
      data: {
        ownerId: owner.id,
        title: 'reason listing',
        description: 'd',
        propertyType: 'APARTMENT',
        price: 500,
        bedrooms: 1,
        bathrooms: 1,
        address: '1 St',
        city: 'City',
        country: 'US',
        status: 'AVAILABLE',
      },
    }); // SPRINT-56:

    await admin.moderateListing(
      adm.id,
      listing.id,
      'reject',
      'Incomplete photos',
    ); // SPRINT-56:
    const rejected = await getTestPrisma().housingListing.findUnique({
      where: { id: listing.id },
    }); // SPRINT-56:
    expect(rejected?.moderationReason).toBe('Incomplete photos'); // SPRINT-56:

    const ownerView = await housing.getListingById(owner.id, listing.id); // SPRINT-56:
    const viewerView = await housing.getListingById(viewer.id, listing.id); // SPRINT-56:
    expect(ownerView.moderationReason).toBe('Incomplete photos'); // SPRINT-56:
    expect(
      Object.prototype.hasOwnProperty.call(viewerView, 'moderationReason'),
    ).toBe(false); // SPRINT-56:

    await admin.moderateListing(adm.id, listing.id, 'approve'); // SPRINT-56:
    const approved = await getTestPrisma().housingListing.findUnique({
      where: { id: listing.id },
    }); // SPRINT-56:
    expect(approved?.moderationReason).toBeNull(); // SPRINT-56:
    const ownerAfter = await housing.getListingById(owner.id, listing.id); // SPRINT-56:
    expect(ownerAfter.moderationReason).toBeNull(); // SPRINT-56:
  }); // SPRINT-56:

  it('feed and restaurant moderation ignore optional DTO reason', async () => {
    // SPRINT-56:
    const adm = await seedAdmin(); // SPRINT-56:
    const author = await seedUser({ label: 'fr' }); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    const post = await prisma.feedPost.create({
      data: {
        authorId: author.id,
        title: 'f',
        content: 'c',
        category: 'COMMUNITY',
        tags: [],
        isPublished: true,
      },
    }); // SPRINT-56:
    const rest = await prisma.restaurant.create({
      data: {
        ownerId: author.id,
        name: 'R',
        cuisine: 'Other',
        address: 'a',
        city: 'c',
        country: 'US',
        priceRange: 'MODERATE',
        isVerified: false,
      },
    }); // SPRINT-56:

    await admin.moderateFeedPost(adm.id, post.id, 'reject'); // SPRINT-56:
    expect(
      (await prisma.feedPost.findUnique({ where: { id: post.id } }))?.isPublished,
    ).toBe(false); // SPRINT-56:
    await admin.moderateFeedPost(adm.id, post.id, 'approve'); // SPRINT-56:
    expect(
      (await prisma.feedPost.findUnique({ where: { id: post.id } }))?.isPublished,
    ).toBe(true); // SPRINT-56:

    await admin.moderateRestaurant(adm.id, rest.id, 'reject'); // SPRINT-56:
    await admin.moderateRestaurant(adm.id, rest.id, 'approve'); // SPRINT-56:
    expect(
      (await prisma.restaurant.findUnique({ where: { id: rest.id } }))
        ?.isVerified,
    ).toBe(true); // SPRINT-56:
  }); // SPRINT-56:
});
