import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateFeedPostDto } from './dto/create-feed-post.dto';
import { UpdateFeedPostDto } from './dto/update-feed-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';
import { sanitizeInput } from '../../common/utils/sanitize';
import { NeighborhoodMood, Prisma } from '@prisma/client'; // SPRINT-37: type the constrained owner update payload
import { VoteNeighborhoodMoodDto } from './dto/vote-neighborhood-mood.dto';

const FEED_MEDIA_MAX_FILES = 6;
const FEED_MEDIA_MAX_SIZE = 5 * 1024 * 1024;
const FEED_MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NEIGHBORHOOD_MOODS: NeighborhoodMood[] = [
  NeighborhoodMood.GREAT,
  NeighborhoodMood.EXCITING,
  NeighborhoodMood.CHILL,
  NeighborhoodMood.MEH,
  NeighborhoodMood.NOISY,
];

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private buildFileUrl(imageUrl: string): string {
    return imageUrl;
  }

  private formatFeedPost(post: any, currentUserId: string) {
    const isLiked = (post.likes?.length ?? 0) > 0;
    const isSaved = (post.saves?.length ?? 0) > 0;

    return {
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category,
      tags: post.tags,
      location: post.location,
      sourceLabel: post.sourceLabel,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      savesCount: post.savesCount,
      isPublished: post.isPublished,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      editedAt: post.editedAt ? new Date(post.editedAt).toISOString() : null, // SPRINT-37: expose the explicit edit time consistently
      isEdited: post.editedAt != null, // SPRINT-37: spare clients from deriving edit state from nullable timestamps
      author: {
        id: post.author.id,
        username: post.author.username,
        name: post.author.fullName,
        avatarUrl: post.author.avatarUrl
          ? this.buildFileUrl(post.author.avatarUrl)
          : null,
      },
      media: (post.media ?? []).map((m: any) => ({
        id: m.id,
        url: this.buildFileUrl(m.imageUrl),
        order: m.order,
      })),
      isLiked,
      isSaved,
      isOwner: post.authorId === currentUserId,
    };
  }

  private async getUserCity(userId: string): Promise<string | null> {
    const location = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return location?.city ?? null;
  }

  private normalizeCity(city: string): { city: string; cityKey: string } {
    const trimmed = city.trim();
    return { city: trimmed, cityKey: trimmed.toLowerCase() };
  }

  private async resolveMoodCity(
    userId: string,
    cityOverride?: string,
  ): Promise<{ city: string; cityKey: string } | null> {
    const provided = cityOverride?.trim();
    const city = provided || (await this.getUserCity(userId))?.trim() || '';
    if (!city) return null;
    return this.normalizeCity(city);
  }

  private async buildNeighborhoodMoodSummary(
    userId: string,
    city: string,
    cityKey: string,
  ) {
    const [myVote, counts] = await this.prisma.$transaction([
      this.prisma.neighborhoodMoodVote.findUnique({
        where: { userId_cityKey: { userId, cityKey } },
        select: { mood: true },
      }),
      this.prisma.neighborhoodMoodVote.findMany({
        where: { cityKey },
        select: { mood: true },
      }),
    ]);

    const countByMood = new Map<NeighborhoodMood, number>();
    for (const row of counts) {
      const mood = row.mood;
      countByMood.set(mood, (countByMood.get(mood) ?? 0) + 1);
    }
    const totalVotes = Array.from(countByMood.values()).reduce(
      (a, b) => a + b,
      0,
    );

    return {
      city,
      totalVotes,
      myMood: myVote?.mood ?? null,
      moods: NEIGHBORHOOD_MOODS.map((mood) => {
        const count = countByMood.get(mood) ?? 0;
        return {
          mood,
          count,
          percentage:
            totalVotes > 0 ? Math.round((count * 100) / totalVotes) : 0,
        };
      }),
    };
  }

  async getNeighborhoodMood(userId: string, cityOverride?: string) {
    const cityData = await this.resolveMoodCity(userId, cityOverride);
    if (!cityData) {
      return {
        city: null,
        totalVotes: 0,
        myMood: null,
        moods: NEIGHBORHOOD_MOODS.map((mood) => ({
          mood,
          count: 0,
          percentage: 0,
        })),
      };
    }
    return this.buildNeighborhoodMoodSummary(
      userId,
      cityData.city,
      cityData.cityKey,
    );
  }

  async voteNeighborhoodMood(userId: string, dto: VoteNeighborhoodMoodDto) {
    const cityData = await this.resolveMoodCity(userId, dto.city);
    if (!cityData) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Set your location before voting mood',
      });
    }

    await this.prisma.neighborhoodMoodVote.upsert({
      where: { userId_cityKey: { userId, cityKey: cityData.cityKey } },
      create: {
        userId,
        city: cityData.city,
        cityKey: cityData.cityKey,
        mood: dto.mood,
      },
      update: {
        city: cityData.city,
        mood: dto.mood,
      },
    });

    return this.buildNeighborhoodMoodSummary(
      userId,
      cityData.city,
      cityData.cityKey,
    );
  }

  async getFeed(userId: string, query: FeedQueryDto) {
    const city = await this.getUserCity(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const cityTrimmed = city?.trim() ?? '';

    // City-scoped feed when we know the viewer's city; otherwise show all published
    // posts so News → Community is not empty (e.g. onboarding without UserLocation yet).
    // Also include authors with no UserLocation row so their posts are not invisible
    // to neighbors who do have a city set.
    const where: any = cityTrimmed
      ? {
          isPublished: true,
          OR: [
            { authorId: userId },
            {
              author: {
                OR: [
                  { location: { is: null } },
                  {
                    location: {
                      city: { equals: cityTrimmed, mode: 'insensitive' },
                    },
                  },
                ],
              },
            },
          ],
        }
      : { isPublished: true };

    if (query.category) {
      where.category = query.category;
    }

    const orderBy: any[] = [];
    const trending = query.trending === 'true';
    if (trending) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      where.createdAt = { gte: sevenDaysAgo };
      orderBy.push({ likesCount: 'desc' }, { commentsCount: 'desc' });
    } else {
      orderBy.push({ createdAt: 'desc' });
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feedPost.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: true,
          media: true,
          likes: {
            where: { userId },
            select: { id: true },
          },
          saves: {
            where: { userId },
            select: { id: true },
          },
        },
      }),
      this.prisma.feedPost.count({ where }),
    ]);

    const data = items.map((post) => this.formatFeedPost(post, userId));
    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async getFeedPostById(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      include: {
        author: true,
        media: true,
        likes: {
          where: { userId },
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    if (!post || (!post.isPublished && post.authorId !== userId)) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }

    return this.formatFeedPost(post, userId);
  }

  async createFeedPost(
    userId: string,
    dto: CreateFeedPostDto,
    files?: Express.Multer.File[],
  ) {
    if (files && files.length > FEED_MEDIA_MAX_FILES) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Maximum 6 media files allowed',
      });
    }

    const post = await this.prisma.feedPost.create({
      data: {
        authorId: userId,
        title: sanitizeInput(dto.title ?? ''),
        content: sanitizeInput(dto.content ?? ''),
        category: dto.category,
        tags: (dto.tags ?? []).map((t) => sanitizeInput(String(t))),
        location:
          dto.location != null ? sanitizeInput(String(dto.location)) : null,
        sourceLabel:
          dto.sourceLabel != null
            ? sanitizeInput(String(dto.sourceLabel))
            : null,
      },
    });

    if (files && files.length > 0) {
      const mediaCreates = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (file.size > FEED_MEDIA_MAX_SIZE) {
          throw new BadRequestException({
            code: 'FILE_TOO_LARGE',
            message: 'Media file must be under 5MB',
          });
        }
        if (!FEED_MEDIA_MIME_TYPES.includes(file.mimetype)) {
          throw new BadRequestException({
            code: 'FILE_INVALID_TYPE',
            message: 'Media file must be JPEG, PNG, or WebP',
          });
        }
        const extension = StorageService.extensionFromMime(file.mimetype);
        const imageUrl = await this.storageService.uploadPublicFile(
          file.buffer,
          file.mimetype,
          `feed/${post.id}`,
          randomUUID(),
          extension,
        );
        mediaCreates.push(
          this.prisma.feedPostMedia.create({
            data: {
              feedPostId: post.id,
              imageUrl,
              order: index,
            },
          }),
        );
      }
      if (mediaCreates.length > 0) {
        await this.prisma.$transaction(mediaCreates);
      }
    }

    const created = await this.prisma.feedPost.findUnique({
      where: { id: post.id },
      include: {
        author: true,
        media: true,
        likes: {
          where: { userId },
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    return this.formatFeedPost(created, userId);
  }

  async updateFeedPost(userId: string, postId: string, dto: UpdateFeedPostDto) {
    const existing = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, isPublished: true }, // SPRINT-37: load only identity, ownership, and publication state before any write
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }
    if (existing.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own posts',
      });
    }

    const hasChanges = Object.values(dto).some((value) => value !== undefined); // SPRINT-37: reject empty partial updates instead of hiding client defects
    if (!hasChanges) {
      // SPRINT-37: enforce at least one defined editable field
      throw new BadRequestException({
        // SPRINT-37: return the established structured API error
        code: 'BAD_REQUEST', // SPRINT-37: identify invalid input
        message: 'No changes were supplied', // SPRINT-37: state the empty-update condition precisely
      }); // SPRINT-37: complete empty-update rejection
    } // SPRINT-37: complete defined-field gate

    const data: Prisma.FeedPostUpdateInput = { editedAt: new Date() }; // SPRINT-37: mark every successful author edit
    if (dto.title !== undefined) data.title = sanitizeInput(String(dto.title));
    if (dto.content !== undefined)
      data.content = sanitizeInput(String(dto.content));
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.tags !== undefined)
      data.tags = dto.tags.map((t) => sanitizeInput(String(t)));
    if (dto.location !== undefined)
      data.location = sanitizeInput(String(dto.location));
    if (dto.sourceLabel !== undefined)
      data.sourceLabel = sanitizeInput(String(dto.sourceLabel));

    await this.prisma.feedPost.update({
      where: { id: postId },
      data,
    });

    return this.getFeedPostById(userId, postId);
  }

  async deleteFeedPost(userId: string, postId: string) {
    const existing = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      include: { media: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }
    if (existing.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only delete your own posts',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // delete related likes, comments, saves, media
      await tx.feedLike.deleteMany({ where: { feedPostId: postId } });
      await tx.feedComment.deleteMany({ where: { feedPostId: postId } });
      await tx.feedSave.deleteMany({ where: { feedPostId: postId } });
      await tx.feedPostMedia.deleteMany({ where: { feedPostId: postId } });
      await tx.feedPost.delete({ where: { id: postId } });
    });

    // optionally delete files for media (not strictly required for now)

    return { message: 'Post deleted' };
  }

  async toggleLike(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, likesCount: true },
    });
    if (!post) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }
    const authorBlockedLiker = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: { blockerId: post.authorId, blockedId: userId },
      },
    });
    if (authorBlockedLiker) {
      return { liked: false, likesCount: post.likesCount };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedLike.findUnique({
        where: { userId_feedPostId: { userId, feedPostId: postId } },
      });

      if (existing) {
        await tx.feedLike.delete({
          where: { id: existing.id },
        });
        const updated = await tx.feedPost.update({
          where: { id: postId },
          data: { likesCount: { decrement: 1 } },
          select: { likesCount: true },
        });
        return { liked: false, likesCount: updated.likesCount };
      } else {
        await tx.feedLike.create({
          data: { userId, feedPostId: postId },
        });
        const updated = await tx.feedPost.update({
          where: { id: postId },
          data: { likesCount: { increment: 1 } },
          select: { likesCount: true },
        });
        return { liked: true, likesCount: updated.likesCount };
      }
    });

    if (result.liked) {
      const [post, liker] = await Promise.all([
        this.prisma.feedPost.findUnique({
          where: { id: postId },
          select: { authorId: true, title: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        }),
      ]);
      if (post && post.authorId !== userId && liker) {
        void this.notificationsService.createNotification({
          userId: post.authorId,
          type: 'LIKE',
          title: 'New like on your post',
          body: `${liker.username} liked your post "${post.title ?? 'Post'}"`,
          referenceType: 'FEED_POST',
          referenceId: postId,
          actorId: userId,
        });
      }
    }
    return result;
  }

  async addComment(userId: string, postId: string, dto: CreateCommentDto) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true },
    });
    if (!post) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }
    const authorBlockedCommenter = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: { blockerId: post.authorId, blockedId: userId },
      },
    });
    if (authorBlockedCommenter) {
      throw new ForbiddenException('You cannot comment on this post.');
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feedComment.create({
        data: {
          userId,
          feedPostId: postId,
          content: sanitizeInput(dto.content ?? ''),
        },
        include: {
          user: true,
        },
      });
      await tx.feedPost.update({
        where: { id: postId },
        data: { commentsCount: { increment: 1 } },
      });
      return created;
    });

    const feedPost = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { authorId: true, title: true },
    });
    if (feedPost && feedPost.authorId !== userId) {
      void this.notificationsService.createNotification({
        userId: feedPost.authorId,
        type: 'COMMENT',
        title: 'New comment on your post',
        body: `${comment.user.username} commented on your post "${feedPost.title ?? 'Post'}"`,
        referenceType: 'FEED_POST',
        referenceId: postId,
        actorId: userId,
      });
    }

    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        id: comment.user.id,
        username: comment.user.username,
        name: comment.user.fullName,
        avatarUrl: comment.user.avatarUrl
          ? this.buildFileUrl(comment.user.avatarUrl)
          : null,
      },
    };
  }

  async getComments(postId: string, query: PaginationDto) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feedComment.findMany({
        where: { feedPostId: postId },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: true },
      }),
      this.prisma.feedComment.count({
        where: { feedPostId: postId },
      }),
    ]);

    const data = items.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        id: comment.user.id,
        username: comment.user.username,
        name: comment.user.fullName,
        avatarUrl: comment.user.avatarUrl
          ? this.buildFileUrl(comment.user.avatarUrl)
          : null,
      },
    }));

    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async toggleSave(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Post not found',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedSave.findUnique({
        where: { userId_feedPostId: { userId, feedPostId: postId } },
      });

      if (existing) {
        await tx.feedSave.delete({
          where: { id: existing.id },
        });
        const updated = await tx.feedPost.update({
          where: { id: postId },
          data: { savesCount: { decrement: 1 } },
          select: { savesCount: true },
        });
        return { saved: false, savesCount: updated.savesCount };
      } else {
        await tx.feedSave.create({
          data: { userId, feedPostId: postId },
        });
        const updated = await tx.feedPost.update({
          where: { id: postId },
          data: { savesCount: { increment: 1 } },
          select: { savesCount: true },
        });
        return { saved: true, savesCount: updated.savesCount };
      }
    });

    return result;
  }

  async getSavedPosts(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [saves, total] = await this.prisma.$transaction([
      this.prisma.feedSave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          feedPost: {
            include: {
              author: true,
              media: true,
              likes: {
                where: { userId },
                select: { id: true },
              },
              saves: {
                where: { userId },
                select: { id: true },
              },
            },
          },
        },
      }),
      this.prisma.feedSave.count({ where: { userId } }),
    ]);

    const data = saves.map((s) =>
      this.formatFeedPost(s.feedPost as any, userId),
    );

    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  }
}
