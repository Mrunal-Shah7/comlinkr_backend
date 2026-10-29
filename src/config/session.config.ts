import session from 'express-session';
import type { RedisClientType } from 'redis';

/** Must match the Cookie header name used by express-session. */
export const SESSION_COOKIE_NAME = 'comlinkr.sid';

const DEV_FALLBACK_SECRET = 'dev-only-insecure-session-secret';
const MIN_PROD_SECRET_LENGTH = 32;

export function getSessionSecret(): string {
  const configured = (process.env.SESSION_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production') {
    if (
      configured.length < MIN_PROD_SECRET_LENGTH ||
      configured === 'change-me-in-production' ||
      configured === DEV_FALLBACK_SECRET
    ) {
      throw new Error(
        `SESSION_SECRET must be set to a strong value (>= ${MIN_PROD_SECRET_LENGTH} chars) in production`,
      );
    }
    return configured;
  }
  return configured || DEV_FALLBACK_SECRET;
}

// connect-redis only has a named export RedisStore (no default function at runtime)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RedisStore } = require('connect-redis') as {
  RedisStore: new (opts: { client: RedisClientType }) => session.Store;
};

export function getSessionOptions(
  redisClient: RedisClientType,
): session.SessionOptions {
  const store = new RedisStore({ client: redisClient });

  const isProduction = process.env.NODE_ENV === 'production';
  const secret = getSessionSecret();
  const maxAge = parseInt(process.env.SESSION_MAX_AGE || '604800000', 10);

  return {
    name: SESSION_COOKIE_NAME,
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge,
    },
  };
}
