import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, createPaginationMeta } from '../../common/dto/pagination.dto';

type UnifiedPost = {
  id: string;
  type: 'NEWS' | 'EVENT' | 'STORY' | 'CHALLENGE';
  title: string;
  category: string;
  status: string | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
};

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPosts(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [feedPosts, events, stories, challenges] = await Promise.all([
      this.prisma.feedPost.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          category: true,
          createdAt: true,
          likesCount: true,
          commentsCount: true,
        },
      }),
      this.prisma.event.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          category: true,
          date: true,
          createdAt: true,
          venue: true,
          attendeeCount: true,
        },
      }),
      this.prisma.story.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          category: true,
          createdAt: true,
          expiresAt: true,
          viewsCount: true,
        },
      }),
      this.prisma.challenge.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          createdAt: true,
          participantCount: true,
          startsAt: true,
          endsAt: true,
        },
      }),
    ]);

    const now = new Date();
    const newsItems: UnifiedPost[] = feedPosts.map((p) => ({
      id: p.id,
      type: 'NEWS',
      title: p.title,
      category: p.category,
      status: null,
      createdAt: p.createdAt,
      metadata: {
        likesCount: p.likesCount,
        commentsCount: p.commentsCount,
      },
    }));
    const eventItems: UnifiedPost[] = events.map((e) => ({
      id: e.id,
      type: 'EVENT',
      title: e.title,
      category: e.category,
      status: null,
      createdAt: e.createdAt,
      metadata: {
        date: e.date,
        venue: e.venue,
        attendeeCount: e.attendeeCount,
      },
    }));
    const storyItems: UnifiedPost[] = stories.map((s) => ({
      id: s.id,
      type: 'STORY',
      title: s.title,
      category: s.category,
      status: null,
      createdAt: s.createdAt,
      metadata: {
        expiresAt: s.expiresAt,
        viewsCount: s.viewsCount,
        isExpired: s.expiresAt < now,
      },
    }));
    const challengeItems: UnifiedPost[] = challenges.map((c) => ({
      id: c.id,
      type: 'CHALLENGE',
      title: c.title,
      category: c.type,
      status: c.status,
      createdAt: c.createdAt,
      metadata: {
        participantCount: c.participantCount,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      },
    }));

    const all: UnifiedPost[] = [
      ...newsItems,
      ...eventItems,
      ...storyItems,
      ...challengeItems,
    ];
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = all.length;
    const data = all.slice((page - 1) * limit, page * limit);
    return { data, meta: createPaginationMeta(page, limit, total) };
  }
}
