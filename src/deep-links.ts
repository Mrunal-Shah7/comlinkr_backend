import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * SPRINT-57: Universal Link / App Link support for the share button.
 *
 * These handlers are registered as raw Express middleware *before* Nest routing so they
 * bypass the global `api` prefix, AuthGuard/OnboardingGuard, and — critically — the
 * TransformInterceptor, which would otherwise wrap the association files in a response
 * envelope and make them unparseable by Apple and Google.
 *
 * Apple does not follow redirects when fetching the AASA file, so this must answer 200
 * directly at https://api.comlinkr.com/.well-known/apple-app-site-association with a
 * JSON content type (the path deliberately has no file extension).
 */

const APPLE_TEAM_ID = 'CZ93N4AV36';
const IOS_BUNDLE_ID = 'com.comlinkr.app';
const ANDROID_PACKAGE = 'com.comlinkr.app';
const ANDROID_SHA256 =
  'DB70005DD089C318281EF0293DAB4EBBB0D25039470FB8A297369A79FA7B94BF';

const APP_STORE_URL = 'https://apps.apple.com/app/id6770242217';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

// The AASA `paths` entry and the Android intentFilters `pathPrefix` must both stay in step
// with this prefix; widening it here without widening those leaves links unclaimed.
const DEEP_LINK_PREFIX = '/app';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fallback page for viewers without the app installed. When the app *is* installed the OS
 * intercepts the URL and this HTML is never rendered.
 */
function renderLandingPage(title: string, schemeUrl: string): string {
  const safeTitle = escapeHtml(title);
  const safeScheme = escapeHtml(schemeUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} · ComLinkr</title>
<meta property="og:title" content="${safeTitle}" />
<meta property="og:site_name" content="ComLinkr" />
<meta property="og:type" content="website" />
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#f6f7f9; color:#111; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#0d1117; color:#e6edf3; } .card { background:#161b22; } }
  .card { background:#fff; border-radius:16px; padding:32px; max-width:420px; width:100%; text-align:center;
          box-shadow:0 8px 32px rgba(0,0,0,.08); }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 24px; opacity:.7; font-size:14px; }
  a.btn { display:block; padding:13px 20px; border-radius:11px; text-decoration:none; font-weight:600;
          background:#0076EB; color:#fff; margin-bottom:10px; }
  a.btn.secondary { background:transparent; color:#0076EB; border:1.5px solid #0076EB; }
</style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>Open this in the ComLinkr app to see the full post.</p>
    <a class="btn" href="${safeScheme}">Open in ComLinkr</a>
    <a class="btn secondary" href="${APP_STORE_URL}">Get it on the App Store</a>
    <a class="btn secondary" href="${PLAY_STORE_URL}">Get it on Google Play</a>
  </div>
  <script>
    // Try the custom scheme once for users who already have the app but arrived by a route
    // the OS did not intercept (in-app browsers, desktop-to-mobile hand-off).
    setTimeout(function () { window.location.href = ${JSON.stringify(schemeUrl)}; }, 250);
  </script>
</body>
</html>`;
}

export function registerDeepLinkRoutes(app: INestApplication): void {
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

  app.use(`${DEEP_LINK_PREFIX}/feed/:postId`, (req: Request, res: Response) => {
    const postId = String(
      (req.params as Record<string, string>).postId ?? '',
    ).slice(0, 64);
    res
      .status(200)
      .type('text/html')
      .send(
        renderLandingPage(
          'Shared post',
          `comlinkr://feed/${encodeURIComponent(postId)}`,
        ),
      );
  });

  app.use(DEEP_LINK_PREFIX, (_req: Request, res: Response) => {
    res
      .status(200)
      .type('text/html')
      .send(renderLandingPage('ComLinkr', 'comlinkr://'));
  });
}
