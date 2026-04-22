import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, createPaginationMeta } from '../../common/dto/pagination.dto';
import { StorageService } from '../storage/storage.service';
import { AddNewsCommentDto } from './dto/add-news-comment.dto';
import { COUNTRY_NEWS_MAP } from './news.constants';
import {
  fetchAllNewsBuckets,
  fetchGoogleNewsRSS,
  type RssNewsArticle,
} from './google-news-rss.util';

export interface NewsExplorePayload {
  data: RssNewsArticle[];
  cachedAt: string;
  total: number;
}

@Injectable()
export class NewsService {
  private readonly cache = new Map<string, { ts: number; payload: NewsExplorePayload }>();
  private readonly ttlMs = 5 * 60 * 1000;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getExploreFeed(city: string, country: string): Promise<NewsExplorePayload> {
    const c = (city || 'Los Angeles').trim();
    const co = (country || 'United States').trim();
    const cacheKey = `${c.toLowerCase()}|${co.toLowerCase()}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < this.ttlMs) {
      return hit.payload;
    }

    const geo = COUNTRY_NEWS_MAP[co] || { gl: 'US', hl: 'en-US', flag: '🇺🇸' };

    const [data, cityNews, countryNews] = await Promise.all([
      fetchAllNewsBuckets(c, co, geo.gl, geo.hl),
      fetchGoogleNewsRSS(`${c} local news today`, geo.gl, geo.hl, 'mycity'),
      fetchGoogleNewsRSS(`${co} latest news headlines`, geo.gl, geo.hl, 'mycountry'),
    ]);

    const all = [
      ...data.local,
      ...data.national,
      ...data.world,
      ...Object.values(data.topics).flat(),
      ...cityNews,
      ...countryNews,
    ];

    const seen = new Set<string>();
    const unique = all.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const cachedAt = new Date().toISOString();
    const payload: NewsExplorePayload = {
      data: unique,
      cachedAt,
      total: unique.length,
    };
    this.cache.set(cacheKey, { ts: Date.now(), payload });
    return payload;
  }

  async getArticleStats(userId: string, articleId: string) {
    const [likeCount, commentCount, likedByMe] = await Promise.all([
      this.prisma.newsArticleLike.count({ where: { articleId } }),
      this.prisma.newsArticleComment.count({ where: { articleId } }),
      this.prisma.newsArticleLike.findUnique({
        where: { userId_articleId: { userId, articleId } },
      }),
    ]);

    return {
      likeCount,
      commentCount,
      likedByMe: !!likedByMe,
    };
  }

  async toggleArticleLike(userId: string, articleId: string) {
    const existing = await this.prisma.newsArticleLike.findUnique({
      where: { userId_articleId: { userId, articleId } },
    });

    if (existing) {
      await this.prisma.newsArticleLike.delete({ where: { id: existing.id } });
      return {
        liked: false,
        likeCount: await this.getArticleLikeCount(articleId),
      };
    }

    await this.prisma.newsArticleLike.create({
      data: { userId, articleId },
    });
    return {
      liked: true,
      likeCount: await this.getArticleLikeCount(articleId),
    };
  }

  async addArticleComment(userId: string, articleId: string, dto: AddNewsCommentDto) {
    const comment = await this.prisma.newsArticleComment.create({
      data: {
        userId,
        articleId,
        content: dto.content,
      },
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

    return this.formatComment(comment);
  }

  async getArticleComments(userId: string, articleId: string, query: PaginationDto) {
    void userId;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.newsArticleComment.findMany({
        where: { articleId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
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
      }),
      this.prisma.newsArticleComment.count({ where: { articleId } }),
    ]);

    return {
      data: rows.map((row) => this.formatComment(row)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private async getArticleLikeCount(articleId: string): Promise<number> {
    return this.prisma.newsArticleLike.count({ where: { articleId } });
  }

  private formatComment(comment: {
    id: string;
    articleId: string;
    content: string;
    createdAt: Date;
    user: { id: string; username: string; fullName: string; avatarUrl: string | null };
  }) {
    return {
      id: comment.id,
      articleId: comment.articleId,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        id: comment.user.id,
        username: comment.user.username,
        name: comment.user.fullName,
        avatarUrl: comment.user.avatarUrl ? this.storageService.resolvePublicUrl(comment.user.avatarUrl) : null,
      },
    };
  }
}
