import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateStoryDto } from './dto/create-story.dto';

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

  private buildFileUrl(mediaUrl: string): string {
    return mediaUrl;
  }

  private async getUserCity(userId: string): Promise<string | null> {
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return loc?.city ?? null;
  }

  private formatStory(story: any) {
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
      expiresAt: story.expiresAt,
      createdAt: story.createdAt,
      isExpired,
      author: {
        id: story.author.id,
        username: story.author.username,
        name: story.author.fullName,
        avatarUrl: story.author.avatarUrl
          ? this.buildFileUrl(story.author.avatarUrl)
          : null,
      },
    };
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
    return this.formatStory(created);
  }

  async getActiveStories(userId: string) {
    const userCity = await this.getUserCity(userId);
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
      orderBy: { createdAt: 'desc' },
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
    return stories.map((s) => this.formatStory(s));
  }

  async viewStory(userId: string, storyId: string) {
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
    return this.formatStory(story);
  }
}


