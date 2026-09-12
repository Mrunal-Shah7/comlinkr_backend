import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';
import { StorageService } from '../storage/storage.service';
import { AddNewsCommentDto } from './dto/add-news-comment.dto';
import { SaveNewsArticleDto } from './dto/save-news-article.dto'; // SPRINT-30
import { COUNTRY_NEWS_MAP } from './news.constants';
import {
  buildLocalNewsQuery,
  buildNationalNewsQuery,
  fetchAllNewsBuckets,
  fetchGoogleNewsRSS,
  fetchStateNews, // SPRINT-30
  getRotationIndex,
  getTimeBucket,
  enrichArticlesWithImages,
  type RssNewsArticle,
} from './google-news-rss.util';
import { resolveMediaUrl } from '../../common/utils/media-url'; // SPRINT-46: the one shared media URL resolver

interface CacheEntry {
  ts: number;
  phase: 'primary' | 'full';
  cachedAt: string;
  data: RssNewsArticle[];
}

/** SPRINT-58: what a feed build returns, so callers never re-read the shared cache. */
interface BuiltFeed {
  data: RssNewsArticle[];
  cachedAt: string;
}

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
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000;
  private readonly primaryTtlMs = 3 * 60 * 1000;
  /**
   * SPRINT-58: an empty result is almost always a transient upstream failure — Google
   * rate-limiting the RSS endpoint, or a timeout. Caching that for the full TTL blanks
   * the feed for every user of the location until it expires, so empties are held only
   * briefly. Short enough to recover quickly, long enough that a failing upstream is not
   * hammered once per request.
   */
  private readonly emptyTtlMs = 30 * 1000;
  /**
   * SPRINT-58: single-flight guard. A cold cache key used to let every concurrent
   * request fan out its own ~11 Google News RSS fetches; now the first caller does the
   * work and the rest await the same promise.
   */
  private readonly inflight = new Map<string, Promise<BuiltFeed>>();
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
    state?: string, // SPRINT-30
  ): Promise<NewsExplorePayload> {
    const c = (city || 'Los Angeles').trim();
    const co = (country || 'United States').trim();
    this.trackActiveLocation(c, co);
    const cacheKey = this.fullCacheKey(c, co, state); // SPRINT-30
    const hit = this.cache.get(cacheKey);
    if (!force && this.isFresh(hit, this.ttlMs)) {
      return this.toPagedPayload(
        hit.data,
        hit.cachedAt,
        'full',
        page,
        pageSize,
      );
    }

    // SPRINT-58: concurrent misses on one key now share a single upstream fan-out.
    const built = await this.singleFlight(cacheKey, () =>
      this.buildFullFeed(c, co, state, force, cacheKey),
    );
    return this.toPagedPayload(
      built.data,
      built.cachedAt,
      'full',
      page,
      pageSize,
    );
  }

  async getExploreFeedPrimary(
    city: string,
    country: string,
    page = 1,
    pageSize = 20,
    force = false,
    state?: string, // SPRINT-30
  ): Promise<NewsExplorePayload> {
    const c = (city || 'Los Angeles').trim();
    const co = (country || 'United States').trim();
    this.trackActiveLocation(c, co);
    const cacheKey = `primary:${this.fullCacheKey(c, co, state)}`; // SPRINT-30
    const hit = this.cache.get(cacheKey);
    if (!force && this.isFresh(hit, this.primaryTtlMs)) {
      return this.toPagedPayload(
        hit.data,
        hit.cachedAt,
        'primary',
        page,
        pageSize,
      );
    }

    // SPRINT-58: when the full feed is already warm — the cron keeps it warm for every
    // active location — first paint costs no upstream fetch at all. The full feed is a
    // superset of primary and is ordered local-first, so its head is the same mix.
    // Only a non-empty full feed stands in for primary; falling back to an empty one
    // would hand the user a blank feed when primary's own fetch might still succeed.
    const fullHit = this.cache.get(this.fullCacheKey(c, co, state));
    if (
      !force &&
      this.isFresh(fullHit, this.ttlMs) &&
      fullHit.data.length > 0
    ) {
      return this.toPagedPayload(
        fullHit.data,
        fullHit.cachedAt,
        'primary',
        page,
        pageSize,
      );
    }

    const built = await this.singleFlight(cacheKey, () =>
      this.buildPrimaryFeed(c, co, state, force, cacheKey),
    );
    return this.toPagedPayload(
      built.data,
      built.cachedAt,
      'primary',
      page,
      pageSize,
    );
  }

  /**
   * SPRINT-58: de-duplicates concurrent cache misses. Without this, one cold key served
   * to N simultaneous users triggered N x ~11 outbound Google News RSS requests — the
   * fan-out that saturated the server and pushed first paint past 20s.
   */
  private async singleFlight(
    key: string,
    build: () => Promise<BuiltFeed>,
  ): Promise<BuiltFeed> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = build().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * SPRINT-58: a cache entry is fresh within its TTL, except an empty one, which expires
   * on the much shorter empty TTL.
   */
  private isFresh(
    entry: CacheEntry | undefined,
    ttlMs: number,
  ): entry is CacheEntry {
    if (!entry) return false;
    const ttl = entry.data.length > 0 ? ttlMs : this.emptyTtlMs;
    return Date.now() - entry.ts < ttl;
  }

  private fullCacheKey(city: string, country: string, state?: string): string {
    return `${city.toLowerCase()}|${country.toLowerCase()}|${(state ?? '').toLowerCase()}`;
  }

  private async buildFullFeed(
    c: string,
    co: string,
    state: string | undefined,
    force: boolean,
    cacheKey: string,
  ): Promise<BuiltFeed> {
    const geo = this.resolveGeoCountry(co);
    const timeBucket = getTimeBucket();
    // When force refresh is requested, rotate queries much faster so repeated pulls
    // within the same 15-minute bucket still vary the Google RSS URL.
    const rotationIndex = force
      ? Math.floor(Date.now() / 1000 / 10)
      : getRotationIndex(60);
    const localQuery = buildLocalNewsQuery(c, rotationIndex, timeBucket);
    const nationalQuery = buildNationalNewsQuery(co, rotationIndex, timeBucket);

    const [data, cityNews, countryNews] = await Promise.all([
      fetchAllNewsBuckets(c, co, geo.gl, geo.hl, rotationIndex),
      fetchGoogleNewsRSS(localQuery, geo.gl, geo.hl, 'mycity'),
      fetchGoogleNewsRSS(nationalQuery, geo.gl, geo.hl, 'mycountry'),
    ]);

    // SPRINT-30: state fallback for sparse local news
    let localBucket = [...data.local, ...cityNews];
    const localSeen = new Set<string>();
    localBucket = localBucket.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (localSeen.has(key)) return false;
      localSeen.add(key);
      return true;
    });
    localBucket = await this.supplementLocalArticles(
      localBucket,
      state,
      timeBucket,
      rotationIndex,
      geo.gl,
      geo.hl,
      localSeen,
    );

    const all = [
      ...localBucket,
      ...data.national,
      ...data.world,
      ...Object.values(data.topics).flat(),
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
    this.cache.set(cacheKey, {
      ts: Date.now(),
      phase: 'full',
      cachedAt,
      data: unique,
    });

    void enrichArticlesWithImages(unique)
      .then((enriched) => {
        const current = this.cache.get(cacheKey);
        if (
          !current ||
          current.cachedAt !== cachedAt ||
          current.phase !== 'full'
        )
          return;
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

    return { data: unique, cachedAt };
  }

  private async buildPrimaryFeed(
    c: string,
    co: string,
    state: string | undefined,
    force: boolean,
    cacheKey: string,
  ): Promise<BuiltFeed> {
    const geo = this.resolveGeoCountry(co);
    const timeBucket = getTimeBucket();
    const rotationIndex = force
      ? Math.floor(Date.now() / 1000 / 10)
      : getRotationIndex(60);
    const localQuery = buildLocalNewsQuery(c, rotationIndex, timeBucket);
    const nationalQuery = buildNationalNewsQuery(co, rotationIndex, timeBucket);

    const [cityNews, countryNews] = await Promise.all([
      fetchGoogleNewsRSS(localQuery, geo.gl, geo.hl, 'mycity'),
      fetchGoogleNewsRSS(nationalQuery, geo.gl, geo.hl, 'mycountry'),
    ]);

    const seen = new Set<string>();
    let localArticles = cityNews.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // SPRINT-30: state fallback for sparse local news
    localArticles = await this.supplementLocalArticles(
      localArticles,
      state,
      timeBucket,
      rotationIndex,
      geo.gl,
      geo.hl,
      seen,
    );

    const all = [...localArticles, ...countryNews];
    const unique = all.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const cachedAt = new Date().toISOString();
    this.cache.set(cacheKey, {
      ts: Date.now(),
      phase: 'primary',
      cachedAt,
      data: unique,
    });
    return { data: unique, cachedAt };
  }

  getActiveLocations(): string[] {
    return [...this.activeLocations];
  }

  async getArticleStats(userId: string | undefined, articleId: string) {
    const [likeCount, commentCount, likedByMe, savedByMe] = await Promise.all([
      this.prisma.newsArticleLike.count({ where: { articleId } }),
      this.prisma.newsArticleComment.count({ where: { articleId } }),
      userId
        ? this.prisma.newsArticleLike.findUnique({
            where: { userId_articleId: { userId, articleId } },
          })
        : Promise.resolve(null),
      userId
        ? this.prisma.newsArticleSave.findUnique({
            // SPRINT-30
            where: { userId_articleId: { userId, articleId } },
          })
        : Promise.resolve(null),
    ]);

    return {
      likeCount,
      commentCount,
      likedByMe: !!likedByMe,
      savedByMe: !!savedByMe, // SPRINT-30
    };
  }

  /**
   * SPRINT-58: stats for a whole page of articles in four queries.
   *
   * The feed used to call getArticleStats once per visible card — 20 requests x 4
   * queries per news load, and it re-ran on every article-list update. Batching keeps
   * the query count flat no matter how many cards are on screen.
   */
  async getArticleStatsBatch(userId: string | undefined, articleIds: string[]) {
    const ids = [...new Set(articleIds.filter(Boolean))].slice(0, 100);
    if (ids.length === 0) return { data: {} };

    const [likeGroups, commentGroups, myLikes, mySaves] = await Promise.all([
      this.prisma.newsArticleLike.groupBy({
        by: ['articleId'],
        where: { articleId: { in: ids } },
        _count: { articleId: true },
      }),
      this.prisma.newsArticleComment.groupBy({
        by: ['articleId'],
        where: { articleId: { in: ids } },
        _count: { articleId: true },
      }),
      userId
        ? this.prisma.newsArticleLike.findMany({
            where: { userId, articleId: { in: ids } },
            select: { articleId: true },
          })
        : Promise.resolve([]),
      userId
        ? this.prisma.newsArticleSave.findMany({
            where: { userId, articleId: { in: ids } },
            select: { articleId: true },
          })
        : Promise.resolve([]),
    ]);

    const likeCounts = new Map(
      likeGroups.map((g) => [g.articleId, g._count.articleId]),
    );
    const commentCounts = new Map(
      commentGroups.map((g) => [g.articleId, g._count.articleId]),
    );
    const likedIds = new Set(myLikes.map((r) => r.articleId));
    const savedIds = new Set(mySaves.map((r) => r.articleId));

    // Every requested id gets an entry, so the client can cache "no stats yet" too and
    // never re-request the same article.
    const data: Record<
      string,
      {
        likeCount: number;
        commentCount: number;
        likedByMe: boolean;
        savedByMe: boolean;
      }
    > = {};
    for (const id of ids) {
      data[id] = {
        likeCount: likeCounts.get(id) ?? 0,
        commentCount: commentCounts.get(id) ?? 0,
        likedByMe: likedIds.has(id),
        savedByMe: savedIds.has(id),
      };
    }
    return { data };
  }

  // SPRINT-30: toggle saved live news article
  async toggleArticleSave(
    userId: string,
    articleId: string,
    dto: SaveNewsArticleDto,
  ) {
    const existing = await this.prisma.newsArticleSave.findUnique({
      where: { userId_articleId: { userId, articleId } },
    });

    if (existing) {
      await this.prisma.newsArticleSave.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    await this.prisma.newsArticleSave.create({
      data: {
        userId,
        articleId,
        title: dto.title,
        url: dto.url,
        imageUrl: dto.imageUrl ?? null,
        source: dto.source ?? null,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
      },
    });
    return { saved: true };
  }

  // SPRINT-30: paginated saved news articles for current user
  async getSavedArticles(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.newsArticleSave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.newsArticleSave.count({ where: { userId } }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        articleId: row.articleId,
        title: row.title,
        url: row.url,
        imageUrl: row.imageUrl,
        source: row.source,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        savedAt: row.createdAt.toISOString(),
      })),
      meta: createPaginationMeta(page, limit, total),
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

  async addArticleComment(
    userId: string,
    articleId: string,
    dto: AddNewsCommentDto,
  ) {
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

  async getArticleComments(
    userId: string,
    articleId: string,
    query: PaginationDto,
  ) {
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

  // SPRINT-30: supplement city local articles with state-level RSS when count < 5
  private async supplementLocalArticles(
    cityArticles: RssNewsArticle[],
    state: string | undefined,
    timeBucket: string,
    rotationIndex: number,
    gl: string,
    hl: string,
    seenTitles: Set<string>,
  ): Promise<RssNewsArticle[]> {
    const st = (state ?? '').trim();
    if (cityArticles.length >= 5 || !st) return cityArticles;

    const stateArticles = await fetchStateNews(
      st,
      timeBucket,
      rotationIndex,
      gl,
      hl,
    );
    const additions: RssNewsArticle[] = [];
    for (const a of stateArticles) {
      if (additions.length >= 15) break;
      const key = a.title.toLowerCase().slice(0, 40);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      additions.push({ ...a, category: 'local' }); // SPRINT-30: treat as local bucket
    }
    return [...cityArticles, ...additions];
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
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0
        ? Math.min(100, Math.floor(pageSize))
        : 20;
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
    user: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
    };
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
        avatarUrl: resolveMediaUrl(
          comment.user.avatarUrl,
          this.storageService.getPublicBaseUrl(),
        ), // SPRINT-46: use the shared resolver rather than the storage helper's empty-string contract
      },
    };
  }
}
