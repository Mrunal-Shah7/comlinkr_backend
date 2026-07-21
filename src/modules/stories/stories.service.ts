import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { AddStoryCommentDto } from './dto/add-story-comment.dto';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';

const STORY_MEDIA_MAX_SIZE = 50 * 1024 * 1024;
const STORY_EXPIRY_HOURS = 24;
const STORY_MEDIA_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
];

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  private buildFileUrl(stored: string | null | undefined): string | null {
    if (!stored) return null;
    if (stored.startsWith('http')) return stored;
    return this.storageService.resolvePublicUrl(stored);
  }

  /** @param isSaved — from batch `StorySave` lookup (never infer from `story.saves` here). */
  private formatStory(story: any, isSaved: boolean) {
    const now = new Date();
    const isExpired = story.expiresAt < now;
    return {
      id: story.id,
      title: story.title,
      mediaType: story.mediaType,
      category: story.category,
      details: story.details,
      hashtags: story.hashtags ?? [],
      durationSeconds: story.durationSeconds,
      location: story.location,
      mediaUrl: story.mediaUrl,
      viewsCount: story.viewsCount,
      commentCount: story.commentCount ?? 0,
      likeCount: story.likeCount ?? 0,
      expiresAt: story.expiresAt,
      createdAt: story.createdAt,
      isExpired,
      author: {
        id: story.author.id,
        username: story.author.username,
        name: story.author.fullName,
        avatarUrl: this.buildFileUrl(story.author.avatarUrl),
      },
      isSaved,
    };
  }

  private async fetchSavedStoryIdSet(
    userId: string | undefined,
    storyIds: string[],
  ): Promise<Set<string>> {
    if (!userId || storyIds.length === 0) return new Set();
    const rows = await this.prisma.storySave.findMany({
      where: { userId, storyId: { in: storyIds } },
      select: { storyId: true },
    });
    return new Set(rows.map((r) => r.storyId));
  }

  async createStory(
    userId: string,
    dto: CreateStoryDto,
    file?: Express.Multer.File,
  ) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + STORY_EXPIRY_HOURS);

    let mediaUrl: string | undefined;
    if (file) {
      if (file.size > STORY_MEDIA_MAX_SIZE) {
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: 'Story media must be under 50MB',
        });
      }
      if (!STORY_MEDIA_MIME.includes(file.mimetype)) {
        throw new BadRequestException({
          code: 'FILE_INVALID_TYPE',
          message: 'Story media must be JPEG, PNG, WebP, MP4, or WebM',
        });
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      mediaUrl = await this.storageService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `stories/${userId}`,
        randomUUID(),
        extension,
      );
    }

    const created = await this.prisma.story.create({
      data: {
        authorId: userId,
        title: dto.title,
        mediaType: dto.mediaType,
        category: dto.category,
        details: dto.details,
        hashtags: dto.hashtags ?? [],
        durationSeconds: dto.durationSeconds,
        location: dto.location,
        mediaUrl: mediaUrl ?? '',
        expiresAt,
        viewsCount: 0,
        commentCount: 0,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return this.formatStory(created, false);
  }

  async getActiveStories(userId?: string, cityOverride?: string) {
    const userCity = cityOverride?.trim() || (await this.getUserCity(userId));
    const now = new Date();
    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: { gt: now },
        ...(userCity && {
          author: {
            location: {
              city: { equals: userCity, mode: 'insensitive' },
            },
          },
        }),
      },
      orderBy: [{ authorId: 'asc' }, { createdAt: 'asc' }],
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const mine = stories.filter((s) => s.authorId === userId);
    const other = stories.filter((s) => s.authorId !== userId);
    const ordered = [...mine, ...other];

    const savedSet = await this.fetchSavedStoryIdSet(
      userId,
      ordered.map((s) => s.id),
    );
    return ordered.map((s) => this.formatStory(s, savedSet.has(s.id)));
  }

  async getMyStories(userId: string) {
    const now = new Date();
    const stories = await this.prisma.story.findMany({
      where: {
        authorId: userId,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    const savedSet = await this.fetchSavedStoryIdSet(
      userId,
      stories.map((s) => s.id),
    );
    return stories.map((s) => this.formatStory(s, savedSet.has(s.id)));
  }

  private async getUserCity(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return loc?.city ?? null;
  }

  async viewStory(userId: string | undefined, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    if (!story) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Story not found',
      });
    }
    if (story.expiresAt < new Date()) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'This story has expired.',
      });
    }
    this.prisma.story
      .update({
        where: { id: storyId },
        data: { viewsCount: { increment: 1 } },
      })
      .catch(() => {});

    const save = userId
      ? await this.prisma.storySave.findUnique({
          where: {
            userId_storyId: { userId, storyId },
          },
          select: { id: true },
        })
      : null;
    return this.formatStory(story, !!save);
  }

  async toggleStorySave(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Story not found',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.storySave.findUnique({
        where: {
          userId_storyId: { userId, storyId },
        },
      });
      if (existing) {
        await tx.storySave.delete({ where: { id: existing.id } });
        return { saved: false, isSaved: false };
      }
      await tx.storySave.create({
        data: { userId, storyId },
      });
      return { saved: true, isSaved: true };
    });
  }

  async getSavedStories(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.storySave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          story: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  fullName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.storySave.count({ where: { userId } }),
    ]);
    const data = rows.map((row) => ({
      ...this.formatStory(row.story, true),
      savedAt: row.createdAt.toISOString(),
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  private formatStoryComment(comment: {
    id: string;
    storyId: string;
    content: string;
    createdAt: Date;
    author: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
    };
  }) {
    return {
      id: comment.id,
      storyId: comment.storyId,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        id: comment.author.id,
        username: comment.author.username,
        name: comment.author.fullName,
        avatarUrl: this.buildFileUrl(comment.author.avatarUrl),
      },
    };
  }

  async addStoryComment(
    userId: string,
    storyId: string,
    dto: AddStoryCommentDto,
  ) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, expiresAt: true },
    });
    if (!story || story.expiresAt < new Date()) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'This story has expired or does not exist.',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.storyComment.create({
        data: {
          storyId,
          authorId: userId,
          content: dto.content,
        },
      });
      await tx.story.update({
        where: { id: storyId },
        data: { commentCount: { increment: 1 } },
      });
      return tx.storyComment.findUnique({
        where: { id: row.id },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });
    });

    if (!created?.author) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Comment not found',
      });
    }
    return this.formatStoryComment(created);
  }

  async getStoryComments(storyId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Story not found',
      });
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.storyComment.findMany({
        where: { storyId },
        orderBy: { createdAt: 'asc' },
        skip,
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
        },
      }),
      this.prisma.storyComment.count({ where: { storyId } }),
    ]);

    const data = rows.map((r) => this.formatStoryComment(r));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async deleteStoryComment(userId: string, storyId: string, commentId: string) {
    const comment = await this.prisma.storyComment.findUnique({
      where: { id: commentId },
      include: {
        story: { select: { id: true, authorId: true, commentCount: true } },
      },
    });
    if (!comment || comment.storyId !== storyId) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Comment not found',
      });
    }
    const isAuthor = comment.authorId === userId;
    const isStoryOwner = comment.story.authorId === userId;
    if (!isAuthor && !isStoryOwner) {
      throw new ForbiddenException('You cannot delete this comment.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.storyComment.delete({ where: { id: commentId } });
      if (comment.story.commentCount > 0) {
        await tx.story.update({
          where: { id: storyId },
          data: { commentCount: { decrement: 1 } },
        });
      }
    });

    return { deleted: true as const };
  }

  async toggleStoryLike(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, expiresAt: true, likeCount: true },
    });
    if (!story || story.expiresAt < new Date()) {
      throw new NotFoundException('This story has expired or does not exist.');
    }

    const existing = await this.prisma.storyLike.findUnique({
      where: { userId_storyId: { userId, storyId } },
      select: { id: true },
    });

    if (existing) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.storyLike.delete({ where: { id: existing.id } });
        if (story.likeCount > 0) {
          return tx.story.update({
            where: { id: storyId },
            data: { likeCount: { decrement: 1 } },
            select: { likeCount: true },
          });
        }
        return tx.story.findUniqueOrThrow({
          where: { id: storyId },
          select: { likeCount: true },
        });
      });
      return { liked: false as const, likeCount: updated.likeCount };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.storyLike.create({ data: { storyId, userId } });
      return tx.story.update({
        where: { id: storyId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
    });
    return { liked: true as const, likeCount: updated.likeCount };
  }

  async getStoryLikeStatus(userId: string | undefined, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, likeCount: true },
    });
    if (!story) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Story not found',
      });
    }
    const likedByMe = userId
      ? await this.prisma.storyLike.findUnique({
          where: { userId_storyId: { userId, storyId } },
          select: { id: true },
        })
      : null;
    return { likeCount: story.likeCount, likedByMe: !!likedByMe };
  }

  /** Author-only: remove story and media before expiry (DB cascade drops comments & saves). */
  async deleteStory(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, authorId: true, mediaUrl: true },
    });
    if (!story) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Story not found',
      });
    }
    if (story.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own stories.');
    }

    await this.prisma.story.delete({ where: { id: storyId } });

    if (story.mediaUrl) {
      try {
        await this.storageService.deleteFile(story.mediaUrl);
      } catch {
        // ignore S3 cleanup failures
      }
    }

    return { deleted: true as const };
  }
}
