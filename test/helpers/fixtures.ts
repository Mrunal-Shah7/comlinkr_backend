/**
 * SPRINT-56: shared Prisma client + truncate/seed fixtures for e2e suites.
 * Strategy: truncate-between-tests (Prisma interactive transactions do not
 * span Nest HTTP/socket work cleanly across Redis sessions).
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { createClient, type RedisClientType } from 'redis';
import * as cookieSignature from 'cookie-signature';
import { assertSafeTestDatabase } from '../setup/database-guard';

const PASSWORD = 'TestPass123!'; // SPRINT-56:
let passwordHash: string | null = null; // SPRINT-56:

export type SeededUser = {
  id: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN';
  cookie: string;
};

let prismaSingleton: PrismaClient | null = null; // SPRINT-56:
let redisSingleton: RedisClientType | null = null; // SPRINT-56:

export function getTestPrisma(): PrismaClient {
  // SPRINT-56:
  assertSafeTestDatabase(process.env.DATABASE_URL); // SPRINT-56:
  if (!prismaSingleton) {
    // SPRINT-56:
    prismaSingleton = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL!,
      }),
    }); // SPRINT-56:
  } // SPRINT-56:
  return prismaSingleton; // SPRINT-56:
}

export async function getTestRedis(): Promise<RedisClientType> {
  // SPRINT-56:
  if (!redisSingleton) {
    // SPRINT-56:
    redisSingleton = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    }); // SPRINT-56:
    await redisSingleton.connect(); // SPRINT-56:
  } // SPRINT-56:
  return redisSingleton; // SPRINT-56:
}

async function hashPassword(): Promise<string> {
  // SPRINT-56:
  if (!passwordHash) {
    // SPRINT-56:
    passwordHash = await bcrypt.hash(PASSWORD, 10); // SPRINT-56:
  } // SPRINT-56:
  return passwordHash; // SPRINT-56:
}

export async function writeSessionCookie(userId: string): Promise<string> {
  // SPRINT-56:
  const redis = await getTestRedis(); // SPRINT-56:
  const sid = randomUUID().replace(/-/g, ''); // SPRINT-56:
  const secret =
    process.env.SESSION_SECRET || 'change-me-in-production'; // SPRINT-56:
  const payload = {
    cookie: {
      originalMaxAge: 604800000,
      expires: new Date(Date.now() + 604800000).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    userId,
    provider: 'LOCAL',
  }; // SPRINT-56:
  await redis.set(`sess:${sid}`, JSON.stringify(payload), { EX: 3600 }); // SPRINT-56:
  const signed = 's:' + cookieSignature.sign(sid, secret); // SPRINT-56:
  return `comlinkr.sid=${encodeURIComponent(signed)}`; // SPRINT-56:
}

/** Tables truncated between tests — order does not matter with CASCADE. */
const TRUNCATE_TABLES = [
  // SPRINT-56:
  'AdminAuditLog',
  'PrivacyRequest',
  'WarningRecord',
  'BanRecord',
  'ListingReport',
  'ContentReport',
  'Message',
  'ConversationMember',
  'Conversation',
  'StoryComment',
  'StoryLike',
  'StorySave',
  'Story',
  'FeedLike',
  'FeedComment',
  'FeedSave',
  'FeedPostMedia',
  'FeedPost',
  'HousingInterest',
  'HousingSave',
  'HousingImage',
  'HousingListing',
  'CommunityUpvote',
  'CommunitySave',
  'CommunityAnswer',
  'CommunityQuestion',
  'EventSave',
  'EventAttendee',
  'EventImage',
  'EventReview',
  'Event',
  'RestaurantReview',
  'RestaurantReservation',
  'RestaurantFavorite',
  'RestaurantSave',
  'RestaurantImage',
  'Restaurant',
  'SharedSpaceSave',
  'SharedSpaceApplication',
  'SharedSpaceImage',
  'SharedSpace',
  'Notification',
  'NotificationPreference',
  'PrivacySettings',
  'BlockedUser',
  'PushToken',
  'PushDevice',
  'AuthProvider',
  'UserLocation',
  'RoommatePreferences',
  'UserBadge',
  'BadgeDocument',
  'BadgeApplication',
  'ChallengeParticipant',
  'Challenge',
  'AdminPollVote',
  'AdminPollOption',
  'AdminPoll',
  'SupportTicket',
  'BroadcastNotification',
  'NewsArticleLike',
  'NewsArticleComment',
  'NewsArticleSave',
  'RoommateSave',
  'User',
]; // SPRINT-56:

export async function resetDatabase(): Promise<void> {
  // SPRINT-56:
  assertSafeTestDatabase(process.env.DATABASE_URL); // SPRINT-56:
  const prisma = getTestPrisma(); // SPRINT-56:
  const quoted = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', '); // SPRINT-56:
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  ); // SPRINT-56:
}

export async function seedUser(opts?: {
  role?: 'USER' | 'ADMIN';
  label?: string;
}): Promise<SeededUser> {
  // SPRINT-56:
  const prisma = getTestPrisma(); // SPRINT-56:
  const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`; // SPRINT-56:
  const label = opts?.label ?? 'u'; // SPRINT-56:
  const role = opts?.role ?? 'USER'; // SPRINT-56:
  const id = randomUUID(); // SPRINT-56:
  const email = `s56-${label}-${stamp}@test.local`; // SPRINT-56:
  const username = `s56${label}${stamp}`.slice(0, 30); // SPRINT-56:
  const hash = await hashPassword(); // SPRINT-56:
  await prisma.user.create({
    data: {
      id,
      email,
      username,
      fullName: `S56 ${label}`,
      role,
      isActive: true,
      onboardingCompleted: true,
      agreementAcceptedAt: new Date(),
      authProviders: {
        create: { provider: 'LOCAL', passwordHash: hash },
      },
    },
  }); // SPRINT-56:
  const cookie = await writeSessionCookie(id); // SPRINT-56:
  return { id, email, username, role, cookie }; // SPRINT-56:
}

export async function seedAdmin(): Promise<SeededUser> {
  // SPRINT-56:
  return seedUser({ role: 'ADMIN', label: 'admin' }); // SPRINT-56:
}

export async function disconnectFixtures(): Promise<void> {
  // SPRINT-56:
  if (prismaSingleton) {
    // SPRINT-56:
    await prismaSingleton.$disconnect(); // SPRINT-56:
    prismaSingleton = null; // SPRINT-56:
  } // SPRINT-56:
  if (redisSingleton) {
    // SPRINT-56:
    await redisSingleton.quit(); // SPRINT-56:
    redisSingleton = null; // SPRINT-56:
  } // SPRINT-56:
}

export { PASSWORD }; // SPRINT-56:
