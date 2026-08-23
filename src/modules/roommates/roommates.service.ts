import {
  BadRequestException,
  ForbiddenException, // SPRINT-53
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationContextType,
  ConversationType,
  MessageType,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service'; // SPRINT-46: source of the configured public delivery base
import { resolveMediaUrl } from '../../common/utils/media-url'; // SPRINT-46: the one shared media URL resolver
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { RoommatesQueryDto } from './dto/roommates-query.dto';
import type { CreateRoommateListingDto } from './dto/create-roommate-listing.dto';
import type { PatchRoommateListingDto } from './dto/patch-roommate-listing.dto';

const VIBE_POINTS_PER = 8;
const MAX_VIBES = 12;
const MAX_VIBE_SCORE = MAX_VIBES * VIBE_POINTS_PER; // 96

const INTEREST_POINTS_PER = 10;
const MAX_INTERESTS = 8;
const MAX_INTEREST_SCORE = MAX_INTERESTS * INTEREST_POINTS_PER; // 80

const COMMUNITY_POINTS_PER = 5;
const MAX_COMMUNITY_CAP = 50;

const LOCATION_SAME_CITY = 15;
const LOCATION_SAME_STATE = 10;
const LOCATION_SAME_COUNTRY = 5;
const LOCATION_DIFFERENT = 0;

const LIFESTYLE_SLEEP = 20;
const LIFESTYLE_CLEANLINESS = 20;
const LIFESTYLE_NOISE = 20;
const LIFESTYLE_PET = 15;
const LIFESTYLE_SMOKING = 15;
const LIFESTYLE_GUESTS = 10;
const LIFESTYLE_MAX = 100;

type UserWithRelations = {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  vibes: Array<{ id: string; slug: string; name: string; emoji: string }>; // SPRINT-28: slug for card response
  interests: Array<{ id: string; name: string; icon: string }>;
  communities: Array<{ id: string; slug: string; name: string; emoji: string }>; // SPRINT-28: slug for card response
  location: { city: string; state: string; country: string } | null;
  roommatePreferences: {
    budgetMin: number | null;
    budgetMax: number | null;
    moveInDate: Date | null;
    sleepSchedule: string | null;
    cleanliness: string | null;
    noiseTolerance: string | null;
    petFriendly: boolean;
    smokingAllowed: boolean;
    guestsFrequency: string | null;
    workFromHome: boolean;
    aboutMe: string | null;
  } | null;
  userBadges: Array<{ badgeType: string }>;
};

export type RoommateConnectionStatus =
  | null
  | 'pending_sent'
  | 'pending_received'
  | 'accepted';

@Injectable()
export class RoommatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService, // SPRINT-46: supply the configured public delivery base to the shared resolver
  ) {}

  // SPRINT-46: route every roommate media value through the shared resolver instead of returning it raw
  private buildFileUrl(url: string | null | undefined): string | null {
    return resolveMediaUrl(url, this.storageService.getPublicBaseUrl()); // SPRINT-46: absolute secure URL, or explicit null
  }

  /** Same 1:1 direct-thread predicate as MessagingService.buildDirectPairWhere (no cross-import). */
  private resolvePairConnectionStatus(
    currentUserId: string,
    members: Array<{ userId: string; status: string }>,
    conversationId: string,
  ): { status: RoommateConnectionStatus; conversationId: string | null } {
    if (members.length !== 2) {
      return { status: null, conversationId: null };
    }
    const me = members.find((m) => m.userId === currentUserId);
    const them = members.find((m) => m.userId !== currentUserId);
    if (!me || !them) {
      return { status: null, conversationId: null };
    }
    if (me.status === 'BLOCKED') {
      return { status: null, conversationId: null };
    }
    if (me.status === 'ACCEPTED' && them.status === 'ACCEPTED') {
      return { status: 'accepted', conversationId };
    }
    if (me.status === 'ACCEPTED' && them.status === 'PENDING') {
      return { status: 'pending_sent', conversationId };
    }
    if (me.status === 'PENDING') {
      return { status: 'pending_received', conversationId };
    }
    return { status: null, conversationId: null };
  }

  /**
   * One query: all DIRECT conversations involving the current user and any target in the slice.
   * First match per target wins (conversations ordered by createdAt desc).
   */
  private async batchConnectionStatuses(
    currentUserId: string,
    targetUserIds: string[],
  ): Promise<
    Map<
      string,
      { status: RoommateConnectionStatus; conversationId: string | null }
    >
  > {
    const map = new Map<
      string,
      { status: RoommateConnectionStatus; conversationId: string | null }
    >();
    for (const id of targetUserIds) {
      map.set(id, { status: null, conversationId: null });
    }
    if (targetUserIds.length === 0) {
      return map;
    }
    const targetSet = new Set(targetUserIds);
    const conversations = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        AND: [
          { members: { some: { userId: currentUserId } } },
          { members: { some: { userId: { in: targetUserIds } } } },
        ],
      },
      include: {
        members: { select: { userId: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const assigned = new Set<string>();
    for (const c of conversations) {
      if (c.members.length !== 2) continue;
      const otherId = c.members.find((m) => m.userId !== currentUserId)?.userId;
      if (!otherId || !targetSet.has(otherId) || assigned.has(otherId))
        continue;
      const resolved = this.resolvePairConnectionStatus(
        currentUserId,
        c.members,
        c.id,
      );
      map.set(otherId, resolved);
      assigned.add(otherId);
    }
    return map;
  }

  private async getConnectionStatus(
    currentUserId: string,
    targetUserId: string,
  ): Promise<{
    status: RoommateConnectionStatus;
    conversationId: string | null;
  }> {
    const batch = await this.batchConnectionStatuses(currentUserId, [
      targetUserId,
    ]);
    return batch.get(targetUserId) ?? { status: null, conversationId: null };
  }

  private async findDirectConversationBetween(
    userIdA: string,
    userIdB: string,
  ) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        AND: [
          { members: { some: { userId: userIdA } } },
          { members: { some: { userId: userIdB } } },
        ],
      },
      include: {
        members: { select: { id: true, userId: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return conversations.find((c) => c.members.length === 2) ?? null;
  }

  private computeCompatibilityScore(
    currentUser: UserWithRelations,
    targetUser: UserWithRelations,
  ): number {
    // Step 1 — Vibe (30%)
    const vibeIdsA = new Set(currentUser.vibes.map((v) => v.id));
    const sharedVibes = targetUser.vibes.filter((v) =>
      vibeIdsA.has(v.id),
    ).length;
    const rawVibeScore = sharedVibes * VIBE_POINTS_PER;
    const normalizedVibeScore = (rawVibeScore / MAX_VIBE_SCORE) * 100;
    const vibeContrib = normalizedVibeScore * 0.3;

    // Step 2 — Interest (20%)
    const interestIdsA = new Set(currentUser.interests.map((i) => i.id));
    const sharedInterests = targetUser.interests.filter((i) =>
      interestIdsA.has(i.id),
    ).length;
    const rawInterestScore = sharedInterests * INTEREST_POINTS_PER;
    const normalizedInterestScore =
      (rawInterestScore / MAX_INTEREST_SCORE) * 100;
    const interestContrib = normalizedInterestScore * 0.2;

    // Step 3 — Community (25%)
    const communityIdsA = new Set(currentUser.communities.map((c) => c.id));
    const sharedCommunities = targetUser.communities.filter((c) =>
      communityIdsA.has(c.id),
    ).length;
    const rawCommunityScore = sharedCommunities * COMMUNITY_POINTS_PER;
    const maxCommunityScore =
      Math.max(currentUser.communities.length, targetUser.communities.length) *
      COMMUNITY_POINTS_PER;
    const cappedMax = Math.min(
      Math.max(maxCommunityScore, 1),
      MAX_COMMUNITY_CAP,
    );
    const normalizedCommunityScore = Math.min(
      (rawCommunityScore / cappedMax) * 100,
      100,
    );
    const communityContrib = normalizedCommunityScore * 0.25;

    // Step 4 — Location (15%)
    const locA = currentUser.location;
    const locB = targetUser.location;
    let locationPoints = LOCATION_DIFFERENT;
    if (locA && locB) {
      if (locA.city === locB.city) locationPoints = LOCATION_SAME_CITY;
      else if (locA.state === locB.state) locationPoints = LOCATION_SAME_STATE;
      else if (locA.country === locB.country)
        locationPoints = LOCATION_SAME_COUNTRY;
    }
    const normalizedLocationScore = (locationPoints / 15) * 100;
    const locationContrib = normalizedLocationScore * 0.15;

    // Step 5 — Lifestyle (10%)
    const prefsA = currentUser.roommatePreferences;
    const prefsB = targetUser.roommatePreferences;
    let lifestyleScore = 50;
    if (prefsA && prefsB) {
      let total = 0;
      if (prefsA.sleepSchedule != null && prefsB.sleepSchedule != null) {
        total +=
          prefsA.sleepSchedule === prefsB.sleepSchedule ? LIFESTYLE_SLEEP : 0;
      }
      if (prefsA.cleanliness != null && prefsB.cleanliness != null) {
        total +=
          prefsA.cleanliness === prefsB.cleanliness ? LIFESTYLE_CLEANLINESS : 0;
      }
      if (prefsA.noiseTolerance != null && prefsB.noiseTolerance != null) {
        total +=
          prefsA.noiseTolerance === prefsB.noiseTolerance ? LIFESTYLE_NOISE : 0;
      }
      total += prefsA.petFriendly === prefsB.petFriendly ? LIFESTYLE_PET : 0;
      total +=
        prefsA.smokingAllowed === prefsB.smokingAllowed ? LIFESTYLE_SMOKING : 0;
      if (prefsA.guestsFrequency != null && prefsB.guestsFrequency != null) {
        total +=
          prefsA.guestsFrequency === prefsB.guestsFrequency
            ? LIFESTYLE_GUESTS
            : 0;
      }
      lifestyleScore = total;
    }
    const lifestyleContrib = (lifestyleScore / LIFESTYLE_MAX) * 100 * 0.1;

    let score =
      vibeContrib +
      interestContrib +
      communityContrib +
      locationContrib +
      lifestyleContrib;
    score = Math.round(score);
    return Math.max(0, Math.min(100, score));
  }

  private getLocationMatch(
    currentUser: UserWithRelations,
    targetUser: UserWithRelations,
  ): 'same_city' | 'same_state' | 'same_country' | 'different' {
    const locA = currentUser.location;
    const locB = targetUser.location;
    if (!locA || !locB) return 'different';
    if (locA.city === locB.city) return 'same_city';
    if (locA.state === locB.state) return 'same_state';
    if (locA.country === locB.country) return 'same_country';
    return 'different';
  }

  private computeLifestyleScore(
    currentUser: UserWithRelations,
    targetUser: UserWithRelations,
  ): number {
    const prefsA = currentUser.roommatePreferences;
    const prefsB = targetUser.roommatePreferences;
    if (!prefsA || !prefsB) return 50;
    let total = 0;
    if (prefsA.sleepSchedule != null && prefsB.sleepSchedule != null)
      total +=
        prefsA.sleepSchedule === prefsB.sleepSchedule ? LIFESTYLE_SLEEP : 0;
    if (prefsA.cleanliness != null && prefsB.cleanliness != null)
      total +=
        prefsA.cleanliness === prefsB.cleanliness ? LIFESTYLE_CLEANLINESS : 0;
    if (prefsA.noiseTolerance != null && prefsB.noiseTolerance != null)
      total +=
        prefsA.noiseTolerance === prefsB.noiseTolerance ? LIFESTYLE_NOISE : 0;
    total += prefsA.petFriendly === prefsB.petFriendly ? LIFESTYLE_PET : 0;
    total +=
      prefsA.smokingAllowed === prefsB.smokingAllowed ? LIFESTYLE_SMOKING : 0;
    if (prefsA.guestsFrequency != null && prefsB.guestsFrequency != null)
      total +=
        prefsA.guestsFrequency === prefsB.guestsFrequency
          ? LIFESTYLE_GUESTS
          : 0;
    return total;
  }

  private formatRoommateCard(
    user: UserWithRelations,
    currentUser: UserWithRelations,
    compatibilityScore: number,
    isSaved: boolean,
    connectionStatus: RoommateConnectionStatus,
    conversationId: string | null,
  ) {
    const vibeIdsA = new Set(currentUser.vibes.map((v) => v.id));
    const interestIdsA = new Set(currentUser.interests.map((i) => i.id));
    const communityIdsA = new Set(currentUser.communities.map((c) => c.id));
    const inCommon = {
      vibes: user.vibes
        .filter((v) => vibeIdsA.has(v.id))
        .map((v) => ({ name: v.name, emoji: v.emoji })),
      interests: user.interests
        .filter((i) => interestIdsA.has(i.id))
        .map((i) => ({ name: i.name, icon: i.icon })),
      communities: user.communities
        .filter((c) => communityIdsA.has(c.id))
        .map((c) => ({ name: c.name, emoji: c.emoji })),
    };
    const prefs = user.roommatePreferences;
    return {
      id: user.id,
      username: user.username,
      name: user.fullName,
      avatarUrl: user.avatarUrl ? this.buildFileUrl(user.avatarUrl) : null,
      bio: user.bio,
      city: user.location?.city ?? null,
      compatibilityScore,
      vibes: (user.vibes ?? []).map((v) => ({
        slug: v.slug,
        name: v.name,
        emoji: v.emoji,
      })), // SPRINT-28
      communities: (user.communities ?? []).map((c) => ({
        slug: c.slug,
        name: c.name,
        emoji: c.emoji,
      })), // SPRINT-28
      preferences: prefs
        ? {
            budgetMin: prefs.budgetMin,
            budgetMax: prefs.budgetMax,
            moveInDate: prefs.moveInDate,
            sleepSchedule: prefs.sleepSchedule,
            cleanliness: prefs.cleanliness,
            noiseTolerance: prefs.noiseTolerance,
            petFriendly: prefs.petFriendly,
            smokingAllowed: prefs.smokingAllowed,
            guestsFrequency: prefs.guestsFrequency,
            workFromHome: prefs.workFromHome,
            aboutMe: prefs.aboutMe,
          }
        : null,
      badges: user.userBadges.map((b) => ({ badgeType: b.badgeType })),
      inCommon,
      isVerified: (user.userBadges?.length ?? 0) > 0,
      isSaved,
      connectionStatus,
      conversationId,
    };
  }

  async searchRoommates(userId: string, query: RoommatesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = query.sort ?? 'best_match';

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vibes: { select: { id: true, slug: true, name: true, emoji: true } }, // SPRINT-28: slug
        interests: { select: { id: true, name: true, icon: true } },
        communities: {
          select: { id: true, slug: true, name: true, emoji: true },
        }, // SPRINT-28: slug
        location: { select: { city: true, state: true, country: true } },
        roommatePreferences: true,
        userBadges: { select: { badgeType: true } },
      },
    });
    if (!currentUser) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const cityValue = query.city ?? currentUser.location?.city ?? undefined;
    const where: any = {
      id: { not: userId },
      isActive: true,
      onboardingCompleted: true,
      roommatePreferences: {
        isLooking: true,
        ...(query.minBudget != null && {
          budgetMax: { gte: query.minBudget },
        }),
        ...(query.maxBudget != null && {
          budgetMin: { lte: query.maxBudget },
        }),
      },
    };
    if (cityValue) {
      where.location = { city: cityValue };
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        vibes: { select: { id: true, slug: true, name: true, emoji: true } }, // SPRINT-28: slug
        interests: { select: { id: true, name: true, icon: true } },
        communities: {
          select: { id: true, slug: true, name: true, emoji: true },
        }, // SPRINT-28: slug
        location: { select: { city: true, state: true, country: true } },
        roommatePreferences: true,
        userBadges: { select: { badgeType: true } },
      },
    });

    const withScores = users.map((u) => ({
      user: u,
      score: this.computeCompatibilityScore(
        currentUser as UserWithRelations,
        u as UserWithRelations,
      ),
    }));

    if (sort === 'best_match') {
      withScores.sort((a, b) => b.score - a.score);
    } else if (sort === 'budget') {
      withScores.sort((a, b) => {
        const minA = a.user.roommatePreferences?.budgetMin ?? 0;
        const minB = b.user.roommatePreferences?.budgetMin ?? 0;
        return minA - minB;
      });
    } else if (sort === 'move_in_soon') {
      withScores.sort((a, b) => {
        const dA =
          a.user.roommatePreferences?.moveInDate?.getTime() ??
          Number.MAX_SAFE_INTEGER;
        const dB =
          b.user.roommatePreferences?.moveInDate?.getTime() ??
          Number.MAX_SAFE_INTEGER;
        return dA - dB;
      });
    } else {
      // verified: verified first, then by score
      withScores.sort((a, b) => {
        const verifiedA = (a.user.userBadges?.length ?? 0) > 0 ? 1 : 0;
        const verifiedB = (b.user.userBadges?.length ?? 0) > 0 ? 1 : 0;
        if (verifiedB !== verifiedA) return verifiedB - verifiedA;
        return b.score - a.score;
      });
    }

    const total = withScores.length;
    const slice = withScores.slice((page - 1) * limit, page * limit);
    const targetIds = slice.map(({ user }) => user.id);
    const [savedRows, connMap] = await Promise.all([
      targetIds.length === 0
        ? Promise.resolve([] as { savedUserId: string }[])
        : this.prisma.roommateSave.findMany({
            where: { userId, savedUserId: { in: targetIds } },
            select: { savedUserId: true },
          }),
      this.batchConnectionStatuses(userId, targetIds),
    ]);
    const savedSet = new Set(savedRows.map((r) => r.savedUserId));
    const data = slice.map(({ user, score }) => {
      const conn = connMap.get(user.id) ?? {
        status: null as RoommateConnectionStatus,
        conversationId: null,
      };
      return this.formatRoommateCard(
        user,
        currentUser,
        score,
        savedSet.has(user.id),
        conn.status,
        conn.conversationId,
      );
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getRoommateProfile(userId: string, roommateId: string) {
    const [blocked, target] = await Promise.all([
      this.prisma.blockedUser.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: roommateId },
            { blockerId: roommateId, blockedId: userId },
          ],
        },
      }),
      this.prisma.user.findUnique({
        where: { id: roommateId },
        include: {
          vibes: { select: { id: true, slug: true, name: true, emoji: true } }, // SPRINT-28: slug
          interests: { select: { id: true, name: true, icon: true } },
          communities: {
            select: { id: true, slug: true, name: true, emoji: true },
          }, // SPRINT-28: slug
          location: { select: { city: true, state: true, country: true } },
          roommatePreferences: true,
          userBadges: { select: { badgeType: true } },
        },
      }),
    ]);
    if (blocked || !target || !target.isActive) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Roommate not found',
      });
    }
    const prefs = target.roommatePreferences;
    if (!prefs || prefs.isLooking !== true) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Roommate not found',
      });
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vibes: { select: { id: true, slug: true, name: true, emoji: true } }, // SPRINT-28: slug
        interests: { select: { id: true, name: true, icon: true } },
        communities: {
          select: { id: true, slug: true, name: true, emoji: true },
        }, // SPRINT-28: slug
        location: { select: { city: true, state: true, country: true } },
        roommatePreferences: true,
        userBadges: { select: { badgeType: true } },
      },
    });
    if (!currentUser) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const cu = currentUser as UserWithRelations;
    const tu = target as UserWithRelations;
    const compatibilityScore = this.computeCompatibilityScore(cu, tu);
    const [saveRow, conn] = await Promise.all([
      this.prisma.roommateSave.findUnique({
        where: {
          userId_savedUserId: { userId, savedUserId: roommateId },
        },
        select: { id: true },
      }),
      this.getConnectionStatus(userId, roommateId),
    ]);
    const card = this.formatRoommateCard(
      tu,
      cu,
      compatibilityScore,
      !!saveRow,
      conn.status,
      conn.conversationId,
    );
    return {
      ...card,
      compatibilityBreakdown: {
        sharedVibesCount: card.inCommon.vibes.length,
        sharedInterestsCount: card.inCommon.interests.length,
        sharedCommunitiesCount: card.inCommon.communities.length,
        locationMatch: this.getLocationMatch(cu, tu),
        lifestyleScore: this.computeLifestyleScore(cu, tu),
      },
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const prefs = await this.prisma.roommatePreferences.upsert({
      where: { userId },
      create: {
        userId,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        moveInDate: dto.moveInDate ? new Date(dto.moveInDate) : undefined,
        sleepSchedule: dto.sleepSchedule,
        cleanliness: dto.cleanliness,
        noiseTolerance: dto.noiseTolerance,
        petFriendly: dto.petFriendly ?? false,
        smokingAllowed: dto.smokingAllowed ?? false,
        guestsFrequency: dto.guestsFrequency,
        workFromHome: dto.workFromHome ?? false,
        aboutMe: dto.aboutMe,
        isLooking: dto.isLooking ?? false,
      },
      update: {
        ...(dto.budgetMin !== undefined && { budgetMin: dto.budgetMin }),
        ...(dto.budgetMax !== undefined && { budgetMax: dto.budgetMax }),
        ...(dto.moveInDate !== undefined && {
          moveInDate: dto.moveInDate ? new Date(dto.moveInDate) : null,
        }),
        ...(dto.sleepSchedule !== undefined && {
          sleepSchedule: dto.sleepSchedule,
        }),
        ...(dto.cleanliness !== undefined && { cleanliness: dto.cleanliness }),
        ...(dto.noiseTolerance !== undefined && {
          noiseTolerance: dto.noiseTolerance,
        }),
        ...(dto.petFriendly !== undefined && { petFriendly: dto.petFriendly }),
        ...(dto.smokingAllowed !== undefined && {
          smokingAllowed: dto.smokingAllowed,
        }),
        ...(dto.guestsFrequency !== undefined && {
          guestsFrequency: dto.guestsFrequency,
        }),
        ...(dto.workFromHome !== undefined && {
          workFromHome: dto.workFromHome,
        }),
        ...(dto.aboutMe !== undefined && { aboutMe: dto.aboutMe }),
        ...(dto.isLooking !== undefined && { isLooking: dto.isLooking }),
      },
    });
    return prefs;
  }

  async sendConnectionRequest(userId: string, roommateId: string) {
    const [initiator, targetUser, blocked] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      }),
      this.prisma.user.findUnique({
        where: { id: roommateId },
        select: { id: true, isActive: true },
      }),
      this.prisma.blockedUser.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: roommateId },
            { blockerId: roommateId, blockedId: userId },
          ],
        },
      }),
    ]);
    if (!targetUser || !targetUser.isActive || blocked) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (!initiator) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }

    const memberIds = [userId, roommateId].sort();
    // SPRINT-44: previously scanned all DIRECT with no orderBy — arbitrary match; now most recently created for the pair
    const pairConversations = await this.prisma.conversation.findMany({
      // SPRINT-44
      where: {
        // SPRINT-44
        type: ConversationType.DIRECT, // SPRINT-44
        AND: [
          // SPRINT-44
          { members: { some: { userId } } }, // SPRINT-44
          { members: { some: { userId: roommateId } } }, // SPRINT-44
        ], // SPRINT-44
      }, // SPRINT-44
      include: {
        members: { select: { userId: true, status: true, blockProvenance: true } }, // SPRINT-53: need provenance to refuse ADMIN_BAN bypass
      }, // SPRINT-44
      orderBy: { createdAt: 'desc' }, // SPRINT-44: most recently created
    }); // SPRINT-44
    const existingConv =
      pairConversations.find((c) => {
        // SPRINT-44
        if (c.members.length !== 2) return false; // SPRINT-44
        const ids = c.members.map((m) => m.userId).sort(); // SPRINT-44
        if (ids[0] !== memberIds[0] || ids[1] !== memberIds[1]) return false; // SPRINT-44
        const mine = c.members.find((m) => m.userId === userId); // SPRINT-44
        // SPRINT-53: ADMIN_BAN must not be treated as a skippable retired row
        if (mine?.status === 'BLOCKED' && mine.blockProvenance === 'ADMIN_BAN') {
          return true; // SPRINT-53: keep this conversation — do not create a fresh one
        }
        // SPRINT-44: if initiator's row is BLOCKED (retired user-block), allow creating a fresh connection conversation
        return mine?.status !== 'BLOCKED'; // SPRINT-44
      }) ?? null; // SPRINT-44
    if (existingConv) {
      const mine = existingConv.members.find((m) => m.userId === userId); // SPRINT-53
      if (mine?.status === 'BLOCKED' && mine.blockProvenance === 'ADMIN_BAN') {
        // SPRINT-53: close the same fresh-conversation bypass on the roommate connect path
        throw new ForbiddenException(
          'You are banned from messaging this user in this conversation.',
        );
      }
      return {
        message: 'Conversation already exists',
        conversationId: existingConv.id,
      };
    }

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          type: ConversationType.DIRECT,
          contextType: ConversationContextType.GENERAL,
          createdById: userId,
        },
      });
      await tx.conversationMember.createMany({
        data: [
          {
            conversationId: conv.id,
            userId,
            role: 'MEMBER',
            status: 'ACCEPTED',
          },
          {
            conversationId: conv.id,
            userId: roommateId,
            role: 'MEMBER',
            status: 'PENDING',
          },
        ],
      });
      await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: userId,
          content: `${initiator.username} wants to connect as a potential roommate`,
          type: MessageType.SYSTEM,
        },
      });
      return conv;
    });
    await this.notificationsService.createNotification({
      userId: roommateId,
      type: NotificationType.MESSAGE,
      title: 'New connection request',
      body: `${initiator.username} wants to connect as a potential roommate`,
      referenceType: 'CONVERSATION',
      referenceId: conversation.id,
      actorId: userId,
    });
    return {
      message: 'Connection request sent',
      conversationId: conversation.id,
    };
  }

  async cancelConnectionRequest(
    // SPRINT-33: sender-side withdrawal endpoint for pending roommate requests
    userId: string, // SPRINT-33: authenticated sender attempting cancellation
    targetId: string, // SPRINT-33: recipient whose pending request should be withdrawn
  ): Promise<{ message: string }> {
    // SPRINT-33: API response contract
    const targetUser = await this.prisma.user.findUnique({
      // SPRINT-33: validate recipient existence first
      where: { id: targetId }, // SPRINT-33: lookup by target user id
      select: { id: true }, // SPRINT-33: minimal projection for existence check
    }); // SPRINT-33
    if (!targetUser) {
      // SPRINT-33: 404 when recipient does not exist
      throw new NotFoundException('User not found'); // SPRINT-33: explicit sprint-required error message
    } // SPRINT-33

    const connectionStatus = await this.getConnectionStatus(userId, targetId); // SPRINT-33: determine relationship from sender perspective
    if (connectionStatus.status !== 'pending_sent') {
      // SPRINT-33: only the original sender can cancel outgoing pending requests
      throw new BadRequestException('No outgoing connection request to cancel'); // SPRINT-33: sprint-required guard message
    } // SPRINT-33

    const conversationId = connectionStatus.conversationId; // SPRINT-33: conversation to reset/delete
    if (!conversationId) {
      // SPRINT-33: defensive guard for inconsistent state
      throw new BadRequestException('No outgoing connection request to cancel'); // SPRINT-33: consistent client-facing error
    } // SPRINT-33

    await this.prisma.$transaction(async (tx) => {
      // SPRINT-33: atomic cleanup for request withdrawal
      await tx.message.deleteMany({ where: { conversationId } }); // SPRINT-33: delete system + user messages first to satisfy FK ordering
      await tx.conversationMember.deleteMany({ where: { conversationId } }); // SPRINT-33: remove both member rows for the direct thread
      await tx.conversation.delete({ where: { id: conversationId } }); // SPRINT-33: remove conversation to reset state to null
    }); // SPRINT-33

    return { message: 'Connection request cancelled' }; // SPRINT-33: success payload
  } // SPRINT-33

  async acceptConnectionRequest(currentUserId: string, requesterId: string) {
    const conv = await this.findDirectConversationBetween(
      currentUserId,
      requesterId,
    );
    if (!conv) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    const myMember = conv.members.find((m) => m.userId === currentUserId);
    if (!myMember || myMember.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No pending connection request to accept',
      });
    }
    await this.prisma.conversationMember.update({
      where: { id: myMember.id },
      data: { status: 'ACCEPTED' },
    });
    await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: currentUserId,
        content: 'Connection accepted! You can now chat.',
        type: MessageType.SYSTEM,
      },
    });
    const me = await this.prisma.user.findUnique({
      where: { id: currentUserId },
      select: { username: true },
    });
    await this.notificationsService.createNotification({
      userId: requesterId,
      type: NotificationType.MESSAGE,
      title: 'Connection accepted',
      body: `${me?.username ?? 'Someone'} accepted your roommate connection request`,
      referenceType: 'CONVERSATION',
      referenceId: conv.id,
      actorId: currentUserId,
    });
    return { conversationId: conv.id, status: 'accepted' as const };
  }

  async declineConnectionRequest(currentUserId: string, requesterId: string) {
    const conv = await this.findDirectConversationBetween(
      currentUserId,
      requesterId,
    );
    if (!conv) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    const myMember = conv.members.find((m) => m.userId === currentUserId);
    if (!myMember || myMember.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No pending connection request to decline',
      });
    }
    await this.prisma.conversationMember.update({
      where: { id: myMember.id },
      data: { status: 'BLOCKED' },
    });
    return { status: 'declined' as const };
  }

  async getPreferences(userId: string) {
    const prefs = await this.prisma.roommatePreferences.findUnique({
      where: { userId },
    });
    if (!prefs) {
      return {
        petFriendly: false,
        smoking: false,
        workFromHome: false,
        lookingForRoommate: false,
      };
    }
    return {
      budgetMin: prefs.budgetMin ?? undefined,
      budgetMax: prefs.budgetMax ?? undefined,
      moveInDate: prefs.moveInDate?.toISOString().slice(0, 10),
      sleepSchedule: prefs.sleepSchedule ?? undefined,
      cleanliness: prefs.cleanliness ?? undefined,
      noiseLevel: prefs.noiseTolerance ?? undefined,
      petFriendly: prefs.petFriendly,
      smoking: prefs.smokingAllowed,
      guestPolicy: prefs.guestsFrequency ?? undefined,
      workFromHome: prefs.workFromHome,
      lookingForRoommate: prefs.isLooking,
      aboutMe: prefs.aboutMe ?? undefined,
    };
  }

  async getMatches(userId: string, query: RoommatesQueryDto) {
    return this.searchRoommates(userId, {
      ...query,
      sort: query.sort ?? 'best_match',
    });
  }

  private async syncListingLocation(
    userId: string,
    dto: { city?: string; stateProvince?: string; country?: string },
  ) {
    if (!dto.city && !dto.stateProvince && !dto.country) return;
    const existing = await this.prisma.userLocation.findUnique({
      where: { userId },
    });
    if (existing) {
      await this.prisma.userLocation.update({
        where: { userId },
        data: {
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.stateProvince !== undefined && { state: dto.stateProvince }),
          ...(dto.country !== undefined && { country: dto.country }),
        },
      });
      return;
    }
    if (dto.city) {
      await this.prisma.userLocation.create({
        data: {
          userId,
          city: dto.city,
          state: dto.stateProvince ?? '—',
          country: dto.country ?? 'United States',
          countryCode: 'US',
          dialCode: '+1',
        },
      });
    }
  }

  async getMyRoommateListing(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        location: true,
        roommatePreferences: true,
        userBadges: { select: { badgeType: true } },
      },
    });
    if (!user?.roommatePreferences?.isLooking) return null;
    const prefs = user.roommatePreferences;
    const about =
      prefs.aboutMe ?? (user.bio ? String(user.bio).slice(0, 500) : undefined);
    return {
      id: user.id,
      userId: user.id,
      name: user.fullName,
      username: user.username,
      avatarUrl: user.avatarUrl ? this.buildFileUrl(user.avatarUrl) : null,
      city: user.location?.city ?? '',
      stateProvince: user.location?.state,
      country: user.location?.country,
      budget: {
        min: prefs.budgetMin ?? 0,
        max: prefs.budgetMax ?? 0,
      },
      moveInDate: prefs.moveInDate?.toISOString().slice(0, 10) ?? '',
      preferences: await this.getPreferences(userId),
      interests: [] as string[],
      languages: [] as string[],
      verified: user.userBadges.length > 0,
      bio: about,
      createdAt: user.createdAt.toISOString(),
      updatedAt: prefs.id
        ? user.updatedAt.toISOString()
        : new Date().toISOString(),
    };
  }

  async upsertMyListing(userId: string, dto: CreateRoommateListingDto) {
    const aboutParts = [dto.occupation, dto.aboutMe].filter(Boolean);
    const aboutMe =
      aboutParts.length > 0 ? aboutParts.join(' · ') : dto.aboutMe;
    await this.updatePreferences(userId, {
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
      moveInDate: dto.moveInDate,
      sleepSchedule: dto.sleepSchedule,
      cleanliness: dto.cleanliness,
      noiseTolerance: dto.noiseTolerance,
      petFriendly: dto.petFriendly,
      smokingAllowed: dto.smokingAllowed,
      guestsFrequency: dto.guestsFrequency,
      workFromHome: dto.workFromHome,
      aboutMe,
      isLooking: true,
    });
    await this.syncListingLocation(userId, dto);
    const listing = await this.getMyRoommateListing(userId);
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Could not load listing',
      });
    }
    return listing;
  }

  async patchMyListing(userId: string, dto: PatchRoommateListingDto) {
    const aboutParts = [dto.occupation, dto.aboutMe].filter(Boolean);
    const aboutMeMerged =
      aboutParts.length > 0 ? aboutParts.join(' · ') : dto.aboutMe;
    const upd: UpdatePreferencesDto = {};
    if (dto.budgetMin !== undefined) upd.budgetMin = dto.budgetMin;
    if (dto.budgetMax !== undefined) upd.budgetMax = dto.budgetMax;
    if (dto.moveInDate !== undefined) upd.moveInDate = dto.moveInDate;
    if (dto.sleepSchedule !== undefined) upd.sleepSchedule = dto.sleepSchedule;
    if (dto.cleanliness !== undefined) upd.cleanliness = dto.cleanliness;
    if (dto.noiseTolerance !== undefined)
      upd.noiseTolerance = dto.noiseTolerance;
    if (dto.petFriendly !== undefined) upd.petFriendly = dto.petFriendly;
    if (dto.smokingAllowed !== undefined)
      upd.smokingAllowed = dto.smokingAllowed;
    if (dto.guestsFrequency !== undefined)
      upd.guestsFrequency = dto.guestsFrequency;
    if (dto.workFromHome !== undefined) upd.workFromHome = dto.workFromHome;
    if (aboutMeMerged !== undefined) upd.aboutMe = aboutMeMerged;
    if (dto.isLooking !== undefined) upd.isLooking = dto.isLooking;
    if (Object.keys(upd).length > 0) {
      await this.updatePreferences(userId, upd);
    }
    await this.syncListingLocation(userId, dto);
    return this.getMyRoommateListing(userId);
  }

  async deleteMyListing(userId: string) {
    await this.updatePreferences(userId, { isLooking: false });
    return { ok: true };
  }

  async toggleRoommateSave(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'You cannot save your own profile',
      });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roommatePreferences: true },
    });
    if (!target || !target.isActive) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    const prefs = target.roommatePreferences;
    if (!prefs || !prefs.isLooking) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This user is not an active roommate seeker',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.roommateSave.findUnique({
        where: {
          userId_savedUserId: {
            userId: currentUserId,
            savedUserId: targetUserId,
          },
        },
      });
      if (existing) {
        await tx.roommateSave.delete({ where: { id: existing.id } });
        return { saved: false };
      }
      await tx.roommateSave.create({
        data: { userId: currentUserId, savedUserId: targetUserId },
      });
      return { saved: true };
    });
  }

  async getSavedRoommates(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vibes: { select: { id: true, slug: true, name: true, emoji: true } }, // SPRINT-28: slug
        interests: { select: { id: true, name: true, icon: true } },
        communities: {
          select: { id: true, slug: true, name: true, emoji: true },
        }, // SPRINT-28: slug
        location: { select: { city: true, state: true, country: true } },
        roommatePreferences: true,
        userBadges: { select: { badgeType: true } },
      },
    });
    if (!currentUser) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.roommateSave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          savedUser: {
            include: {
              location: { select: { city: true, state: true, country: true } },
              roommatePreferences: true,
              vibes: {
                select: { id: true, slug: true, name: true, emoji: true },
              }, // SPRINT-28: slug
              interests: { select: { id: true, name: true, icon: true } },
              communities: {
                select: { id: true, slug: true, name: true, emoji: true },
              }, // SPRINT-28: slug
              userBadges: { select: { badgeType: true } },
            },
          },
        },
      }),
      this.prisma.roommateSave.count({ where: { userId } }),
    ]);
    const cu = currentUser as UserWithRelations;
    const savedTargetIds = rows.map((row) => row.savedUser.id);
    const connMap = await this.batchConnectionStatuses(userId, savedTargetIds);
    const data = rows.map((row) => {
      const u = row.savedUser as UserWithRelations;
      const score = this.computeCompatibilityScore(cu, u);
      const conn = connMap.get(u.id) ?? {
        status: null as RoommateConnectionStatus,
        conversationId: null,
      };
      return this.formatRoommateCard(
        u,
        cu,
        score,
        true,
        conn.status,
        conn.conversationId,
      );
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }
}
