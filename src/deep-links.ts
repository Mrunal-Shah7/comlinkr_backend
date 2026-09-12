import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './modules/storage/storage.service';
import { resolveMediaUrl } from './common/utils/media-url';

/**
 * SPRINT-57: Universal Link / App Link support for the share button.
 *
 * One URL, two outcomes, decided by the OS:
 *   - app installed     -> iOS/Android intercept the link and none of this renders
 *   - app not installed -> the browser loads it and gets the page below
 *
 * The public URL is https://www.comlinkr.com/app/feed/<id>. Vercel *rewrites* (never
 * redirects) /app/* and /.well-known/* through to this service, so the address bar keeps
 * saying www.comlinkr.com while the rendering happens here.
 *
 * www is canonical: the apex 307-redirects everything, including /.well-known/*, and Apple
 * does not follow redirects when fetching the AASA file — so only www can ever host it.
 *
 * These handlers are registered as raw Express middleware *before* Nest routing so they
 * bypass the global `api` prefix, AuthGuard/OnboardingGuard, and — critically — the
 * TransformInterceptor, which would otherwise wrap the association files in a response
 * envelope and make them unparseable by Apple and Google.
 */

const APPLE_TEAM_ID = 'CZ93N4AV36';
const IOS_BUNDLE_ID = 'com.comlinkr.app';
const IOS_APP_STORE_ID = '6770242217';
const ANDROID_PACKAGE = 'com.comlinkr.app';
const ANDROID_SHA256 =
  'DB70005DD089C318281EF0293DAB4EBBB0D25039470FB8A297369A79FA7B94BF';

const APP_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`;
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** The canonical public origin. Must match the host declared in app.config.js. */
const PUBLIC_WEB_ORIGIN = 'https://www.comlinkr.com';

// The AASA `paths` entry and the Android intentFilters `pathPrefix` must both stay in step
// with this prefix; widening it here without widening those leaves links unclaimed.
const DEEP_LINK_PREFIX = '/app';

const OG_FALLBACK_IMAGE = `${PUBLIC_WEB_ORIGIN}${DEEP_LINK_PREFIX}/og-default.png`;

/**
 * SPRINT-58: custom-scheme fallback for the "Open in ComLinkr" button, used when the OS
 * did not intercept the Universal Link (Instagram/Facebook in-app browsers ignore them
 * entirely).
 *
 * The path must keep the `/app` prefix. The app has no `/feed/<id>` or `/housing/<id>`
 * route — `app/+native-intent.ts` only rewrites `/app/*` into the real tab route
 * (`/(tabs)/housing?openListing=<id>`), so `comlinkr://housing/<id>` opened the app onto
 * an unmatched route instead of the shared item.
 */
function schemeUrlFor(pathAndQuery: string): string {
  return `comlinkr:/${DEEP_LINK_PREFIX}${pathAndQuery}`;
}

const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`,
        paths: [`${DEEP_LINK_PREFIX}/*`],
      },
    ],
  },
};

const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: [ANDROID_SHA256],
    },
  },
];

/**
 * Escapes for both element text and double-quoted attribute values. Every value
 * interpolated below is user-generated, so nothing may skip this.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Collapses whitespace and trims to a length that survives preview cards intact. */
function toMetaDescription(content: string, max = 200): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatPostedAt(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

const PAGE_STYLES = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#111; --muted:#6b7280;
          --line:#e5e7eb; --brand:#0076EB; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --card:#161b22; --fg:#e6edf3; --muted:#9198a1; --line:#30363d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); padding:24px 16px;
         font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width:640px; margin:0 auto; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px;
          overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,.06); }
  .body { padding:24px; }
  .byline { display:flex; align-items:center; gap:10px; margin-bottom:16px; }
  .avatar { width:40px; height:40px; border-radius:50%; object-fit:cover; background:var(--line);
            flex:none; }
  .who { min-width:0; }
  .name { font-weight:650; font-size:15px; display:flex; align-items:center; gap:5px; }
  .tick { color:var(--brand); flex:none; }
  .meta { color:var(--muted); font-size:13px; }
  h1 { font-size:22px; line-height:1.3; margin:0 0 12px; }
  .content { white-space:pre-wrap; overflow-wrap:anywhere; margin:0 0 20px; }
  .hero { display:block; width:100%; height:auto; border-bottom:1px solid var(--line); }
  .tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:20px; }
  .tag { font-size:12px; color:var(--muted); border:1px solid var(--line);
         border-radius:999px; padding:3px 10px; }
  .cta { display:block; text-align:center; text-decoration:none; font-weight:650; font-size:15px;
         padding:14px 20px; border-radius:12px; background:var(--brand); color:#fff;
         margin-bottom:10px; }
  .cta.alt { background:transparent; color:var(--brand); border:1.5px solid var(--brand);
             font-size:14px; padding:11px 20px; }
  .stores { display:flex; gap:10px; }
  .stores .cta.alt { flex:1; margin-bottom:0; }
  .foot { text-align:center; color:var(--muted); font-size:13px; margin-top:20px; }
  .foot a { color:var(--muted); }
`;

function renderShell(opts: {
  title: string;
  description: string;
  image: string;
  canonical: string;
  schemeUrl: string;
  bodyHtml: string;
}): string {
  const { title, description, image, canonical, schemeUrl, bodyHtml } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · ComLinkr</title>
<meta name="description" content="${escapeHtml(description)}" />

<!-- Viewable by anyone with the link, but deliberately kept out of search results. -->
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${escapeHtml(canonical)}" />

<!-- Crawlers for WhatsApp, iMessage and Slack do not run JavaScript; these must be
     server-rendered or the shared link shows a blank preview card. -->
<meta property="og:site_name" content="ComLinkr" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />

<!-- Safari renders this as a native install banner. -->
<meta name="apple-itunes-app" content="app-id=${IOS_APP_STORE_ID}, app-argument=${escapeHtml(canonical)}" />
<style>${PAGE_STYLES}</style>
</head>
<body>
  <div class="wrap">
${bodyHtml}
    <p class="foot">Shared from <a href="${PUBLIC_WEB_ORIGIN}">ComLinkr</a></p>
  </div>
  <script>
    // For users who already have the app but arrived through a route the OS did not
    // intercept — Instagram/Facebook in-app browsers ignore Universal Links entirely.
    document.getElementById('open-app')?.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.href = ${JSON.stringify(schemeUrl)};
    });
  </script>
</body>
</html>`;
}

/**
 * SPRINT-58: `noun` keeps the copy honest for listings as well as posts, and the page now
 * carries the same "Open in ComLinkr" affordance as a found item — someone with the app
 * installed who lands here should still get into the app rather than a dead end.
 */
function renderNotFound(
  canonical: string,
  noun = 'post',
  schemeUrl = 'comlinkr://',
): string {
  return renderShell({
    title: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} not available`,
    description: `This ${noun} may have been removed or is no longer public.`,
    image: OG_FALLBACK_IMAGE,
    canonical,
    schemeUrl,
    bodyHtml: `    <div class="card"><div class="body">
      <h1>This ${escapeHtml(noun)} isn't available</h1>
      <p class="content">It may have been removed, or it isn't public any more.</p>
      <a class="cta" id="open-app" href="${escapeHtml(schemeUrl)}">Open in ComLinkr</a>
      <div class="stores">
        <a class="cta alt" href="${APP_STORE_URL}">App Store</a>
        <a class="cta alt" href="${PLAY_STORE_URL}">Google Play</a>
      </div>
    </div></div>`,
  });
}

type PostForPage = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: Date;
  author: {
    fullName: string;
    username: string;
    avatarUrl: string | null;
    userBadges: { badgeType: string }[];
  };
  media: { imageUrl: string }[];
};

function renderPostPage(post: PostForPage, publicBaseUrl: string): string {
  const canonical = `${PUBLIC_WEB_ORIGIN}${DEEP_LINK_PREFIX}/feed?openPost=${encodeURIComponent(post.id)}`;
  const schemeUrl = schemeUrlFor(
    `/feed?openPost=${encodeURIComponent(post.id)}`,
  );
  const heroUrl = post.media.length
    ? resolveMediaUrl(post.media[0].imageUrl, publicBaseUrl)
    : null;
  const avatarUrl = resolveMediaUrl(post.author.avatarUrl, publicBaseUrl);
  const isVerified = post.author.userBadges.length > 0;
  const authorName = post.author.fullName || post.author.username;

  const hero = heroUrl
    ? `      <img class="hero" src="${escapeHtml(heroUrl)}" alt="" />\n`
    : '';
  const avatar = avatarUrl
    ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<div class="avatar"></div>`;
  const tick = isVerified
    ? `<svg class="tick" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-label="Verified"><path d="M12 2l2.4 1.8 3-.3 1 2.8 2.6 1.5-1 2.9 1 2.9-2.6 1.5-1 2.8-3-.3L12 22l-2.4-1.8-3 .3-1-2.8L3 16.2l1-2.9-1-2.9 2.6-1.5 1-2.8 3 .3L12 2zm-1.2 13.4l5.3-5.3-1.4-1.4-3.9 3.9-1.8-1.8L7.6 12l3.2 3.4z"/></svg>`
    : '';
  const tags = post.tags.length
    ? `      <div class="tags">${post.tags
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join('')}</div>\n`
    : '';

  const bodyHtml = `    <div class="card">
${hero}      <div class="body">
        <div class="byline">
          ${avatar}
          <div class="who">
            <div class="name">${escapeHtml(authorName)}${tick}</div>
            <div class="meta">@${escapeHtml(post.author.username)} · ${formatPostedAt(post.createdAt)}</div>
          </div>
        </div>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="content">${escapeHtml(post.content)}</p>
${tags}        <a class="cta" id="open-app" href="${escapeHtml(schemeUrl)}">Open in ComLinkr</a>
        <div class="stores">
          <a class="cta alt" href="${APP_STORE_URL}">App Store</a>
          <a class="cta alt" href="${PLAY_STORE_URL}">Google Play</a>
        </div>
      </div>
    </div>`;

  return renderShell({
    title: post.title,
    description: toMetaDescription(post.content),
    image: heroUrl ?? OG_FALLBACK_IMAGE,
    canonical,
    schemeUrl,
    bodyHtml,
  });
}

// SPRINT-58: housing listings are shared as /app/housing/<id> (see mobile
// src/utils/shareLinks.ts) but had no handler, so every shared listing fell through to
// the generic ComLinkr card with no title, image or link preview.
type ListingForPage = {
  id: string;
  title: string;
  description: string;
  price: unknown;
  currency: string;
  bedrooms: number;
  bathrooms: number;
  neighborhood: string | null;
  city: string;
  country: string;
  images: { imageUrl: string }[];
};

/** Formats the price without assuming the currency has a symbol we know. */
function formatPrice(price: unknown, currency: string): string {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Intl throws on a currency code it does not recognise.
    return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
  }
}

function renderListingPage(
  listing: ListingForPage,
  publicBaseUrl: string,
): string {
  const canonical = `${PUBLIC_WEB_ORIGIN}${DEEP_LINK_PREFIX}/housing/${encodeURIComponent(listing.id)}`;
  const schemeUrl = schemeUrlFor(`/housing/${encodeURIComponent(listing.id)}`);
  const heroUrl = listing.images.length
    ? resolveMediaUrl(listing.images[0].imageUrl, publicBaseUrl)
    : null;

  const price = formatPrice(listing.price, listing.currency);
  const where = [listing.neighborhood, listing.city, listing.country]
    .filter(Boolean)
    .join(', ');
  const facts = [
    price ? `${price}/mo` : '',
    `${listing.bedrooms} bed`,
    `${listing.bathrooms} bath`,
  ].filter(Boolean);

  const hero = heroUrl
    ? `      <img class="hero" src="${escapeHtml(heroUrl)}" alt="" />\n`
    : '';
  const chips = `      <div class="tags">${facts
    .map((f) => `<span class="tag">${escapeHtml(f)}</span>`)
    .join('')}</div>\n`;

  const bodyHtml = `    <div class="card">
${hero}      <div class="body">
        <h1>${escapeHtml(listing.title)}</h1>
        <div class="meta" style="margin-bottom:12px">${escapeHtml(where)}</div>
${chips}        <p class="content">${escapeHtml(listing.description)}</p>
        <a class="cta" id="open-app" href="${escapeHtml(schemeUrl)}">Open in ComLinkr</a>
        <div class="stores">
          <a class="cta alt" href="${APP_STORE_URL}">App Store</a>
          <a class="cta alt" href="${PLAY_STORE_URL}">Google Play</a>
        </div>
      </div>
    </div>`;

  const summary = [facts.join(' · '), where].filter(Boolean).join(' — ');

  return renderShell({
    title: listing.title,
    description: toMetaDescription(
      summary ? `${summary}. ${listing.description}` : listing.description,
    ),
    image: heroUrl ?? OG_FALLBACK_IMAGE,
    canonical,
    schemeUrl,
    bodyHtml,
  });
}

export function registerDeepLinkRoutes(app: INestApplication): void {
  // Resolved once here rather than per request; the app is already initialised at the
  // point main.ts calls this, so container lookups are safe.
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);

  app.use(
    '/.well-known/apple-app-site-association',
    (_req: Request, res: Response) => {
      // No file extension means no automatic content type — set it explicitly.
      res
        .status(200)
        .type('application/json')
        .send(JSON.stringify(APPLE_APP_SITE_ASSOCIATION));
    },
  );

  app.use('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
    res.status(200).type('application/json').send(JSON.stringify(ASSET_LINKS));
  });

  // Fallback preview image for posts with no media. Lives under the deep-link prefix so
  // the same Vercel rewrite proxies it, keeping og:image on the canonical origin.
  app.use(
    `${DEEP_LINK_PREFIX}/og-default.png`,
    (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(join(__dirname, 'assets', 'og-default.png'));
    },
  );

  // Mounted on the tab rather than a :postId param, so both link shapes resolve here:
  //   /app/feed?openPost=<id>  — what src/utils/shareLinks.ts emits
  //   /app/feed/<id>           — the earlier path form, kept working
  app.use(
    `${DEEP_LINK_PREFIX}/feed`,
    (req: Request, res: Response, next: NextFunction) => {
      const fromQuery = req.query?.openPost;
      const fromPath = req.url.split('?')[0].split('/').filter(Boolean)[0];
      const postId = String(
        typeof fromQuery === 'string' && fromQuery
          ? fromQuery
          : fromPath
            ? decodeURIComponent(fromPath)
            : '',
      ).slice(0, 64);

      // Other content types share /app/feed too (openEvent, openStory). They have no web
      // page yet, so hand them to the generic handler rather than a misleading post 404.
      if (!postId) return next();

      const canonical = `${PUBLIC_WEB_ORIGIN}${DEEP_LINK_PREFIX}/feed?openPost=${encodeURIComponent(postId)}`;

      void (async () => {
        try {
          const post = await prisma.feedPost.findUnique({
            where: { id: postId },
            select: {
              id: true,
              title: true,
              content: true,
              tags: true,
              createdAt: true,
              isPublished: true,
              author: {
                select: {
                  fullName: true,
                  username: true,
                  avatarUrl: true,
                  userBadges: { select: { badgeType: true } },
                },
              },
              media: {
                select: { imageUrl: true },
                orderBy: { order: 'asc' },
                take: 1,
              },
            },
          });

          // Unpublished posts are private, exactly as GET /api/feed/:id treats them.
          if (!post || !post.isPublished) {
            res.status(404).type('text/html').send(renderNotFound(canonical));
            return;
          }

          res
            .status(200)
            .type('text/html')
            .setHeader('Cache-Control', 'public, max-age=300')
            .send(renderPostPage(post, storage.getPublicBaseUrl()));
        } catch {
          // A rendering or database failure must still return a usable page rather than
          // an unstyled stack trace, since this URL is public.
          res.status(404).type('text/html').send(renderNotFound(canonical));
        }
      })();
    },
  );

  // SPRINT-58: both shapes resolve here, matching the /app/feed handler above:
  //   /app/housing/<id>            — what src/utils/shareLinks.ts emits for listings
  //   /app/housing?openListing=<id> — the query form the other tabs use
  app.use(
    `${DEEP_LINK_PREFIX}/housing`,
    (req: Request, res: Response, next: NextFunction) => {
      const fromQuery = req.query?.openListing;
      const fromPath = req.url.split('?')[0].split('/').filter(Boolean)[0];
      const listingId = String(
        typeof fromQuery === 'string' && fromQuery
          ? fromQuery
          : fromPath
            ? decodeURIComponent(fromPath)
            : '',
      ).slice(0, 64);

      if (!listingId) return next();

      const canonical = `${PUBLIC_WEB_ORIGIN}${DEEP_LINK_PREFIX}/housing/${encodeURIComponent(listingId)}`;
      const schemeUrl = schemeUrlFor(
        `/housing/${encodeURIComponent(listingId)}`,
      );

      void (async () => {
        try {
          const listing = await prisma.housingListing.findUnique({
            where: { id: listingId },
            select: {
              id: true,
              title: true,
              description: true,
              price: true,
              currency: true,
              bedrooms: true,
              bathrooms: true,
              neighborhood: true,
              city: true,
              country: true,
              status: true,
              images: {
                select: { imageUrl: true },
                orderBy: { order: 'asc' },
                take: 1,
              },
            },
          });

          // UNLISTED is the owner-hidden state; RENTED listings stay viewable, the same
          // way they remain browsable in the app.
          if (!listing || listing.status === 'UNLISTED') {
            res
              .status(404)
              .type('text/html')
              .send(renderNotFound(canonical, 'listing', schemeUrl));
            return;
          }

          res
            .status(200)
            .type('text/html')
            .setHeader('Cache-Control', 'public, max-age=300')
            .send(renderListingPage(listing, storage.getPublicBaseUrl()));
        } catch {
          res
            .status(404)
            .type('text/html')
            .send(renderNotFound(canonical, 'listing', schemeUrl));
        }
      })();
    },
  );

  app.use(DEEP_LINK_PREFIX, (_req: Request, res: Response) => {
    res
      .status(200)
      .type('text/html')
      .send(
        renderShell({
          title: 'ComLinkr',
          description: 'Community-first housing and lifestyle discovery.',
          image: OG_FALLBACK_IMAGE,
          canonical: PUBLIC_WEB_ORIGIN,
          schemeUrl: 'comlinkr://',
          bodyHtml: `    <div class="card"><div class="body">
      <h1>ComLinkr</h1>
      <p class="content">Open this link in the ComLinkr app.</p>
      <a class="cta" id="open-app" href="comlinkr://">Open in ComLinkr</a>
      <div class="stores">
        <a class="cta alt" href="${APP_STORE_URL}">App Store</a>
        <a class="cta alt" href="${PLAY_STORE_URL}">Google Play</a>
      </div>
    </div></div>`,
        }),
      );
  });
}
