import { Injectable } from '@nestjs/common';
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
}
