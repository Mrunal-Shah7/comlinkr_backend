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
    if (cleanA.startsWith(cleanB.slice(0, 30)) || cleanB.startsWith(cleanA.slice(0, 30)))
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
  if (m2 && !m2[1].includes('news.google.com')) return m2[1].replace(/["']/g, '');
  return null;
}

function extractImage(itemXml: string): string | null {
  const mediaMatch = itemXml.match(
    /url="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp|svg)[^"]*)"/i,
  );
  if (mediaMatch && !mediaMatch[1].includes('news.google.com')) return mediaMatch[1];
  const mediaMatch2 = itemXml.match(/<media:content[^>]+url="(https?:\/\/[^"]+)"/i);
  if (mediaMatch2 && !mediaMatch2[1].includes('news.google.com'))
    return mediaMatch2[1];
  const thumbMatch = itemXml.match(/<media:thumbnail[^>]+url="(https?:\/\/[^"]+)"/i);
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
    const url = `https://news.google.com/rss/search?q=${ encoded }&hl=${ hl }&gl=${ gl }&ceid=${ gl }:${ hl.split('-')[0] }`;
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
        description:
          desc.length > 300 ? desc.slice(0, 300) + '…' : desc,
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

export async function fetchAllNewsBuckets(
  cityName: string,
  countryName: string,
  gl: string,
  hl: string,
): Promise<{
  local: RssNewsArticle[];
  national: RssNewsArticle[];
  world: RssNewsArticle[];
  topics: Record<string, RssNewsArticle[]>;
}> {
  const [local, national, world, biz, tech, health, sports, entertainment] =
    await Promise.all([
      fetchGoogleNewsRSS(`${cityName} news`, gl, hl, 'local'),
      fetchGoogleNewsRSS(`${countryName} news today`, gl, hl, 'nation'),
      fetchGoogleNewsRSS('world news today', gl, hl, 'world'),
      fetchGoogleNewsRSS('business finance', gl, hl, 'business'),
      fetchGoogleNewsRSS('technology', gl, hl, 'technology'),
      fetchGoogleNewsRSS('health wellness', gl, hl, 'health'),
      fetchGoogleNewsRSS('sports', gl, hl, 'sports'),
      fetchGoogleNewsRSS(
        'entertainment movies music',
        gl,
        hl,
        'entertainment',
      ),
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
