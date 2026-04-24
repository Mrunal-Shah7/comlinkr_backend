import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, createPaginationMeta } from '../../common/dto/pagination.dto';
import { StorageService } from '../storage/storage.service';
import { AddNewsCommentDto } from './dto/add-news-comment.dto';
import { COUNTRY_NEWS_MAP } from './news.constants';
import {
  fetchAllNewsBuckets,
  fetchGoogleNewsRSS,
  enrichArticlesWithImages,
  type RssNewsArticle,
} from './google-news-rss.util';

export interface NewsExplorePayload {
  data: RssNewsArticle[];
  cachedAt: string;
  total: number;
  phase: 'primary' | 'full';
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private readonly cache = new Map<
    string,
    { ts: number; phase: 'primary' | 'full'; cachedAt: string; data: RssNewsArticle[] }
  >();
  private readonly ttlMs = 5 * 60 * 1000;
  private readonly primaryTtlMs = 3 * 60 * 1000;
  private readonly activeLocations: string[] = [];
  private readonly activeLocationsSet = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getExploreFeed(
    city: string,
    country: string,
    page = 1,
    pageSize = 20,
    force = false,
  ): Promise<NewsExplorePayload> {
    const c = (city || 'Los Angeles').trim();
    const co = (country || 'United States').trim();
    this.trackActiveLocation(c, co);
    const cacheKey = `${c.toLowerCase()}|${co.toLowerCase()}`;
    const hit = this.cache.get(cacheKey);
    if (!force && hit && Date.now() - hit.ts < this.ttlMs) {
      return this.toPagedPayload(hit.data, hit.cachedAt, 'full', page, pageSize);
    }

    const geo = this.resolveGeoCountry(co);

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
    this.cache.set(cacheKey, { ts: Date.now(), phase: 'full', cachedAt, data: unique });

    void enrichArticlesWithImages(unique)
      .then((enriched) => {
        const current = this.cache.get(cacheKey);
        if (!current || current.cachedAt !== cachedAt || current.phase !== 'full') return;
        this.cache.set(cacheKey, {
          ts: Date.now(),
          phase: 'full',
          cachedAt,
          data: enriched,
        });
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `News image enrichment failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return this.toPagedPayload(unique, cachedAt, 'full', page, pageSize);
  }

  async getExploreFeedPrimary(
    city: string,
    country: string,
    page = 1,
    pageSize = 20,
    force = false,
  ): Promise<NewsExplorePayload> {
    const c = (city || 'Los Angeles').trim();
    const co = (country || 'United States').trim();
    this.trackActiveLocation(c, co);
    const geo = this.resolveGeoCountry(co);
    const cacheKey = `primary:${c.toLowerCase()}|${co.toLowerCase()}`;
    const hit = this.cache.get(cacheKey);
    if (!force && hit && Date.now() - hit.ts < this.primaryTtlMs) {
      return this.toPagedPayload(hit.data, hit.cachedAt, 'primary', page, pageSize);
    }

    const [cityNews, countryNews] = await Promise.all([
      fetchGoogleNewsRSS(`${c} local news today`, geo.gl, geo.hl, 'mycity'),
      fetchGoogleNewsRSS(`${co} latest news headlines`, geo.gl, geo.hl, 'mycountry'),
    ]);

    const all = [...cityNews, ...countryNews];
    const seen = new Set<string>();
    const unique = all.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const cachedAt = new Date().toISOString();
    this.cache.set(cacheKey, { ts: Date.now(), phase: 'primary', cachedAt, data: unique });
    return this.toPagedPayload(unique, cachedAt, 'primary', page, pageSize);
  }

  getActiveLocations(): string[] {
    return [...this.activeLocations];
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

  private trackActiveLocation(city: string, country: string) {
    if (!city || !country) return;
    const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
    if (this.activeLocationsSet.has(key)) return;
    if (this.activeLocations.length >= 50) {
      const removed = this.activeLocations.shift();
      if (removed) this.activeLocationsSet.delete(removed);
    }
    this.activeLocations.push(key);
    this.activeLocationsSet.add(key);
  }

  private resolveGeoCountry(country: string) {
    if (COUNTRY_NEWS_MAP[country]) return COUNTRY_NEWS_MAP[country];
    const matchedKey = Object.keys(COUNTRY_NEWS_MAP).find(
      (key) => key.toLowerCase() === country.toLowerCase(),
    );
    if (matchedKey) return COUNTRY_NEWS_MAP[matchedKey];
    return { gl: 'US', hl: 'en-US', flag: '🇺🇸' };
  }

  private toPagedPayload(
    data: RssNewsArticle[],
    cachedAt: string,
    phase: 'primary' | 'full',
    page: number,
    pageSize: number,
  ): NewsExplorePayload {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(100, Math.floor(pageSize)) : 20;
    const start = (safePage - 1) * safePageSize;
    const paged = data.slice(start, start + safePageSize);
    return {
      data: paged,
      cachedAt,
      total: data.length,
      phase,
      page: safePage,
      pageSize: safePageSize,
      hasMore: start + paged.length < data.length,
    };
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
