/** Ported from mobile feed RSS helpers — server-side fetch avoids device CORS / blocks */

export interface RssNewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  category: string;
}

const STATE_NEWS_PHRASINGS = [
  // SPRINT-30
  '{state} news today',
  '{state} latest headlines',
  '{state} breaking news',
  '{state} top stories',
];

const LOCAL_NEWS_PHRASINGS = [
  '{city} news',
  '{city} latest news',
  '{city} today',
  '{city} headlines',
  '{city} breaking news',
];

const NATIONAL_NEWS_PHRASINGS = [
  '{country} news today',
  '{country} latest headlines',
  '{country} breaking news',
  '{country} top stories',
  '{country} news update',
];

const WORLD_NEWS_PHRASINGS = [
  'world news today',
  'global news headlines',
  'international news today',
  'world top stories',
];

const BUSINESS_PHRASINGS = [
  'business finance news',
  'economy markets today',
  'financial news update',
  'business headlines today',
];

const TECHNOLOGY_PHRASINGS = [
  'technology news today',
  'tech headlines',
  'latest tech news',
  'technology update today',
];

const HEALTH_PHRASINGS = [
  'health wellness news',
  'health news today',
  'medical news headlines',
  'health update today',
];

const SPORTS_PHRASINGS = [
  'sports news today',
  'sports headlines',
  'latest sports results',
  'sports update today',
];

const ENTERTAINMENT_PHRASINGS = [
  'entertainment news today',
  'celebrity news headlines',
  'entertainment update',
  'movies music news today',
];

export function getTimeBucket(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const minute = String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(
    2,
    '0',
  );
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function getRotationIndex(arrayLength: number): number {
  if (arrayLength <= 0) return 0;
  return Math.floor(Date.now() / 1000 / 900) % arrayLength;
}

function phraseAt(phrases: string[], index: number): string {
  if (phrases.length === 0) return '';
  const idx = ((index % phrases.length) + phrases.length) % phrases.length;
  return phrases[idx] ?? phrases[0] ?? '';
}

export function buildLocalNewsQuery(
  cityName: string,
  rotationIndex: number,
  timeBucket: string,
): string {
  const phrase = phraseAt(LOCAL_NEWS_PHRASINGS, rotationIndex).replace(
    '{city}',
    cityName,
  );
  return `${phrase} ${timeBucket}`;
}

export function buildNationalNewsQuery(
  countryName: string,
  rotationIndex: number,
  timeBucket: string,
): string {
  const phrase = phraseAt(NATIONAL_NEWS_PHRASINGS, rotationIndex).replace(
    '{country}',
    countryName,
  );
  return `${phrase} ${timeBucket}`;
}

// SPRINT-30: state-level RSS query for local news fallback
export function buildStateNewsQuery(
  stateName: string,
  rotationIndex: number,
  timeBucket: string,
): string {
  const phrase = phraseAt(STATE_NEWS_PHRASINGS, rotationIndex).replace(
    '{state}',
    stateName,
  );
  return `${phrase} ${timeBucket}`;
}

export async function fetchStateNews(
  state: string,
  timeBucket: string,
  rotationIndex: number,
  gl: string = 'US',
  hl: string = 'en-US',
): Promise<RssNewsArticle[]> {
  try {
    const query = buildStateNewsQuery(state, rotationIndex, timeBucket);
    return await fetchGoogleNewsRSS(query, gl, hl, 'local');
  } catch {
    return [];
  }
}

function hash32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function xmlTag(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return '';
  const end = xml.indexOf(close, start);
  if (end === -1) return '';
  return xml
    .slice(start + open.length, end)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .trim();
}

function xmlItems(xml: string): string[] {
  const items: string[] = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf('<item>', pos);
    if (start === -1) break;
    const end = xml.indexOf('</item>', start);
    if (end === -1) break;
    items.push(xml.slice(start, end + 7));
    pos = end + 7;
  }
  return items;
}

function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function stripHtml(html: string): string {
  if (!html) return '';
  let text = decodeEntities(html);
  text = text.replace(/<[^>]*>/g, '');
  text = decodeEntities(text);
  text = text.replace(/https?:\/\/\S+/g, '');
  text = text.replace(/\s*-\s*Google News\s*/gi, '');
  return text.replace(/\s{2,}/g, ' ').trim();
}

function isSameContent(a: string, b: string): boolean {
  if (!a || !b) return false;
  const cleanA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanA === cleanB) return true;
  if (cleanA.length > 10 && cleanB.length > 10) {
    if (
      cleanA.startsWith(cleanB.slice(0, 30)) ||
      cleanB.startsWith(cleanA.slice(0, 30))
    )
      return true;
  }
  return false;
}

function parseGoogleNewsDescription(descHtml: string, title: string): string {
  if (!descHtml) return '';
  const decoded = decodeEntities(descHtml);
  const snippets: string[] = [];
  const anchorRegex = /<a[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(decoded)) !== null) {
    const anchorText = match[1].trim();
    if (anchorText.length > 15 && !isSameContent(anchorText, title)) {
      snippets.push(anchorText);
    }
  }
  if (snippets.length > 0) {
    const unique = [...new Set(snippets)].slice(0, 3);
    return 'Related: ' + unique.join(' · ');
  }
  const plain = stripHtml(descHtml);
  if (plain.length < 20 || isSameContent(plain, title)) return '';
  return plain;
}

function firstImgSrcFromHtml(html: string): string | null {
  if (!html) return null;
  const decoded = decodeEntities(html);
  const m = decoded.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (m && !m[1].includes('news.google.com')) return m[1];
  const m2 = decoded.match(/<img[^>]+src=(https?:\/\/[^\s>]+)/i);
  if (m2 && !m2[1].includes('news.google.com'))
    return m2[1].replace(/["']/g, '');
  return null;
}

function extractImage(itemXml: string): string | null {
  const mediaMatch = itemXml.match(
    /url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp|svg)[^"]*)"/i,
  );
  if (mediaMatch && !mediaMatch[1].includes('news.google.com'))
    return mediaMatch[1];
  const mediaMatch2 = itemXml.match(
    /<media:content[^>]+url="(https?:\/\/[^"]+)"/i,
  );
  if (mediaMatch2 && !mediaMatch2[1].includes('news.google.com'))
    return mediaMatch2[1];
  const thumbMatch = itemXml.match(
    /<media:thumbnail[^>]+url="(https?:\/\/[^"]+)"/i,
  );
  if (thumbMatch && !thumbMatch[1].includes('news.google.com'))
    return thumbMatch[1];
  const encMatch = itemXml.match(/<enclosure[^>]+url="(https?:\/\/[^"]+)"/i);
  if (encMatch && !encMatch[1].includes('news.google.com')) return encMatch[1];
  const contentEncoded = xmlTag(itemXml, 'content:encoded');
  const fromEncoded = firstImgSrcFromHtml(contentEncoded);
  if (fromEncoded) return fromEncoded;
  const descRaw = xmlTag(itemXml, 'description');
  if (descRaw) {
    const fromDesc = firstImgSrcFromHtml(descRaw);
    if (fromDesc) return fromDesc;
  }
  return null;
}

function extractRichDescription(itemXml: string, title: string): string {
  const rawDesc = xmlTag(itemXml, 'description');
  const contentEncoded = xmlTag(itemXml, 'content:encoded');
  if (contentEncoded.length > 40) {
    const cleaned = stripHtml(contentEncoded);
    if (cleaned.length > 30 && !isSameContent(cleaned, title)) return cleaned;
  }
  if (rawDesc.length > 10) {
    const parsed = parseGoogleNewsDescription(rawDesc, title);
    if (parsed.length > 15) return parsed;
  }
  return '';
}

export async function fetchGoogleNewsRSS(
  query: string,
  gl: string = 'US',
  hl: string = 'en-US',
  category: string = 'all',
): Promise<RssNewsArticle[]> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split('-')[0]}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'application/rss+xml,application/xml,text/xml,*/*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return [];
    const xml = await resp.text();
    if (!xml.includes('<item>') && !xml.includes('<entry>')) return [];
    const items = xmlItems(xml);
    const qKey = hash32(query + gl).slice(0, 8);
    return items.slice(0, 12).map((item, i) => {
      const rawTitle = stripHtml(xmlTag(item, 'title'));
      const cleanTitle = rawTitle.split(' - ')[0]?.trim() || rawTitle;
      const link = xmlTag(item, 'link');
      const pubDate = xmlTag(item, 'pubDate');
      const source =
        xmlTag(item, 'source') || rawTitle.split(' - ').pop() || 'News';
      const image = extractImage(item);
      const richDesc = extractRichDescription(item, cleanTitle);
      const desc = richDesc.length > 10 ? richDesc : '';
      const id = `g-${qKey}-${i}-${hash32(link + cleanTitle)}`;
      return {
        id,
        title: cleanTitle,
        description: desc.length > 300 ? desc.slice(0, 300) + '…' : desc,
        url: link,
        image,
        source: source.trim(),
        publishedAt: pubDate || new Date().toISOString(),
        category,
      };
    });
  } catch {
    return [];
  }
}

/** Decode a Google News redirect URL to the real article URL (same logic as mobile feed; Node Buffer instead of atob). */
export function decodeGoogleNewsUrl(googleUrl: string): string | null {
  try {
    const match = googleUrl.match(/\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('binary');
    const httpsIdx = decoded.indexOf('https://');
    if (httpsIdx !== -1) {
      // Strip control characters after the decoded URL prefix.
      // eslint-disable-next-line no-control-regex
      return decoded.slice(httpsIdx).replace(/[\x00-\x1F\x7F].*/s, '');
    }
    return null;
  } catch {
    return null;
  }
}

const OG_META_PATTERNS: RegExp[] = [
  /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
  /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
  /<meta\s+[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i,
  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image:src["']/i,
];

function extractOgImageFromHtml(html: string): string | null {
  const slice = html.length > 80_000 ? html.slice(0, 80_000) : html;
  for (const re of OG_META_PATTERNS) {
    const m = slice.match(re);
    const url = m?.[1]?.trim();
    if (url && url.startsWith('https://')) return url;
  }
  return null;
}

/** Best-effort fetch of og:image / twitter:image from an article page. Never throws. */
export async function fetchOgImage(articleUrl: string): Promise<string | null> {
  try {
    let target = articleUrl;
    if (articleUrl.includes('news.google.com')) {
      const decoded = decodeGoogleNewsUrl(articleUrl);
      if (!decoded) return null;
      target = decoded;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(target, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const text = await resp.text();
    return extractOgImageFromHtml(text);
  } catch {
    return null;
  }
}

/**
 * Fills `image` for up to the first 30 articles that had `image: null`, in parallel.
 * Preserves order and leaves other articles unchanged.
 */
export async function enrichArticlesWithImages(
  articles: RssNewsArticle[],
): Promise<RssNewsArticle[]> {
  const out = articles.map((a) => ({ ...a }));
  const nullIndices: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (!out[i].image) nullIndices.push(i);
  }
  const batch = nullIndices.slice(0, 30);
  const settled = await Promise.allSettled(
    batch.map((idx) => fetchOgImage(out[idx].url)),
  );
  settled.forEach((r, j) => {
    if (r.status === 'fulfilled' && r.value) {
      const idx = batch[j];
      out[idx] = { ...out[idx], image: r.value };
    }
  });
  return out;
}

export async function fetchAllNewsBuckets(
  cityName: string,
  countryName: string,
  gl: string,
  hl: string,
  rotationSeed?: number,
): Promise<{
  local: RssNewsArticle[];
  national: RssNewsArticle[];
  world: RssNewsArticle[];
  topics: Record<string, RssNewsArticle[]>;
}> {
  const timeBucket = getTimeBucket();
  const rotationIndex = rotationSeed ?? getRotationIndex(60);
  const localQuery = buildLocalNewsQuery(cityName, rotationIndex, timeBucket);
  const nationalQuery = buildNationalNewsQuery(
    countryName,
    rotationIndex,
    timeBucket,
  );
  const worldQuery = `${phraseAt(WORLD_NEWS_PHRASINGS, rotationIndex)} ${timeBucket}`;
  const businessQuery = `${phraseAt(BUSINESS_PHRASINGS, rotationIndex)} ${timeBucket}`;
  const technologyQuery = `${phraseAt(TECHNOLOGY_PHRASINGS, rotationIndex)} ${timeBucket}`;
  const healthQuery = `${phraseAt(HEALTH_PHRASINGS, rotationIndex)} ${timeBucket}`;
  const sportsQuery = `${phraseAt(SPORTS_PHRASINGS, rotationIndex)} ${timeBucket}`;
  const entertainmentQuery = `${phraseAt(ENTERTAINMENT_PHRASINGS, rotationIndex)} ${timeBucket}`;

  const [local, national, world, biz, tech, health, sports, entertainment] =
    await Promise.all([
      fetchGoogleNewsRSS(localQuery, gl, hl, 'local'),
      fetchGoogleNewsRSS(nationalQuery, gl, hl, 'nation'),
      fetchGoogleNewsRSS(worldQuery, gl, hl, 'world'),
      fetchGoogleNewsRSS(businessQuery, gl, hl, 'business'),
      fetchGoogleNewsRSS(technologyQuery, gl, hl, 'technology'),
      fetchGoogleNewsRSS(healthQuery, gl, hl, 'health'),
      fetchGoogleNewsRSS(sportsQuery, gl, hl, 'sports'),
      fetchGoogleNewsRSS(entertainmentQuery, gl, hl, 'entertainment'),
    ]);

  return {
    local,
    national,
    world,
    topics: {
      business: biz,
      technology: tech,
      health: health,
      sports: sports,
      entertainment: entertainment,
    },
  };
}
