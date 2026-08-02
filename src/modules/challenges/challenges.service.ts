import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChallengeDuration } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ChallengesQueryDto } from './dto/challenges-query.dto';
import { resolveMediaUrl } from '../../common/utils/media-url'; // SPRINT-46: the one shared media URL resolver
import { StorageService } from '../storage/storage.service'; // SPRINT-46: source of the configured public delivery base

const DURATION_DAYS: Record<ChallengeDuration, number> = {
  ONE_DAY: 1,
  THREE_DAYS: 3,
  ONE_WEEK: 7,
  TWO_WEEKS: 14,
  ONE_MONTH: 30,
};

@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService, // SPRINT-46: supply the configured public delivery base
  ) {}

  // SPRINT-46: route every media value through the shared resolver instead of returning it raw
  private buildFileUrl(url: string | null | undefined): string | null {
    return resolveMediaUrl(url, this.storageService.getPublicBaseUrl()); // SPRINT-46: absolute secure URL, or explicit null
  }

  private computeEndDate(startsAt: Date, duration: ChallengeDuration): Date {
    const days = DURATION_DAYS[duration] ?? 7;
    return new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private formatTimeLeft(endsAt: Date, status: string): string {
    const now = new Date();
    if (status === 'ENDED' || endsAt < now) return 'Ended';
    const ms = endsAt.getTime() - now.getTime();
    const minutes = Math.floor(ms / (60 * 1000));
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days > 0) return `${days}d left`;
    if (hours > 0) return `${hours}h left`;
    return `${minutes}m left`;
  }

  private async getUserCity(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return loc?.city ?? null;
  }

  private formatChallenge(challenge: any, currentUserId?: string) {
    const participantCount =
      challenge.participantCount ?? challenge._count?.participants ?? 0;
    const maxParticipants = challenge.maxParticipants;
    const isFull =
      maxParticipants != null && participantCount >= maxParticipants;
    const spotsLeft =
      maxParticipants != null
        ? Math.max(0, maxParticipants - participantCount)
        : null;
    const isJoined = currentUserId && (challenge.participants?.length ?? 0) > 0;
    const timeLeft = this.formatTimeLeft(challenge.endsAt, challenge.status);
    return {
      id: challenge.id,
      title: challenge.title,
      type: challenge.type,
      details: challenge.details,
      duration: challenge.duration,
      goalCondition: challenge.goalCondition,
      reward: challenge.reward,
      maxParticipants: challenge.maxParticipants,
      hashtags: challenge.hashtags ?? [],
      location: challenge.location,
      participantCount,
      status: challenge.status,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      createdAt: challenge.createdAt,
      author: {
        id: challenge.author.id,
        username: challenge.author.username,
        name: challenge.author.fullName,
        avatarUrl: challenge.author.avatarUrl
          ? this.buildFileUrl(challenge.author.avatarUrl)
          : null,
      },
      isJoined: !!isJoined,
      isFull,
      isOwner: currentUserId ? challenge.authorId === currentUserId : false,
      spotsLeft,
      timeLeft,
    };
  }

  async getChallenges(userId: string | undefined, query: ChallengesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? 'ACTIVE';
    let city: string | null = query.city ?? null;
    if (!city) city = await this.getUserCity(userId);

    const where: Prisma.ChallengeWhereInput = { status };
    if (query.type) where.type = query.type;
    if (city) {
      where.author = {
        location: {
          city: { contains: city, mode: 'insensitive' },
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.challenge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          participants: userId
            ? {
                where: { userId },
                select: { id: true },
              }
            : false,
        },
      }),
      this.prisma.challenge.count({ where }),
    ]);

    const data = items.map((c) => this.formatChallenge(c, userId));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getChallengeById(userId: string | undefined, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        participants: userId
          ? {
              where: { userId },
              select: { id: true },
            }
          : false,
      },
    });
    if (!challenge) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Challenge not found',
      });
    }
    const participants = await this.prisma.challengeParticipant.findMany({
      where: { challengeId },
      orderBy: { joinedAt: 'asc' },
      take: 10,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    const base = this.formatChallenge(challenge, userId);
    return {
      ...base,
      participants: participants.map((p: any) => ({
        id: p.user.id,
        username: p.user.username,
        name: p.user.fullName,
        avatarUrl: p.user.avatarUrl
          ? this.buildFileUrl(p.user.avatarUrl)
          : null,
        joinedAt: p.joinedAt,
      })),
      totalParticipants: challenge.participantCount,
    };
  }

  async createChallenge(userId: string, dto: CreateChallengeDto) {
    const startsAt = new Date();
    const endsAt = this.computeEndDate(startsAt, dto.duration);
    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.challenge.create({
        data: {
          authorId: userId,
          title: dto.title,
          type: dto.type,
          details: dto.details,
          duration: dto.duration,
          goalCondition: dto.goalCondition,
          reward: dto.reward,
          maxParticipants: dto.maxParticipants,
          hashtags: dto.hashtags ?? [],
          location: dto.location,
          status: 'ACTIVE',
          startsAt,
          endsAt,
          participantCount: 1,
        },
      });
      await tx.challengeParticipant.create({
        data: { challengeId: c.id, userId },
      });
      return c;
    });
    const withAuthor = await this.prisma.challenge.findUnique({
      where: { id: created.id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        participants: {
          where: { userId },
          select: { id: true },
        },
      },
    });
    return this.formatChallenge(withAuthor!, userId);
  }

  async joinChallenge(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        participants: { where: { userId }, select: { id: true } },
      },
    });
    if (!challenge) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Challenge not found',
      });
    }
    if (challenge.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This challenge has ended.',
      });
    }
    if (challenge.endsAt < new Date()) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This challenge has ended.',
      });
    }
    if (challenge.participants.length > 0) {
      return {
        joined: true,
        participantCount: challenge.participantCount,
      };
    }
    const maxParticipants = challenge.maxParticipants;
    if (
      maxParticipants != null &&
      challenge.participantCount >= maxParticipants
    ) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This challenge is full.',
      });
    }
    const newCount = await this.prisma.$transaction(async (tx) => {
      await tx.challengeParticipant.create({
        data: { challengeId, userId },
      });
      const updated = await tx.challenge.update({
        where: { id: challengeId },
        data: { participantCount: { increment: 1 } },
      });
      return updated.participantCount;
    });
    return { joined: true, participantCount: newCount };
  }
}
