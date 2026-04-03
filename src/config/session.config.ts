import session from 'express-session';
import type { RedisClientType } from 'redis';

/** Must match the Cookie header name used by express-session. */
export const SESSION_COOKIE_NAME = 'comlinkr.sid';

export function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'change-me-in-production';
}

// connect-redis only has a named export RedisStore (no default function at runtime)
const { RedisStore } = require('connect-redis') as {
  RedisStore: new (opts: { client: RedisClientType }) => session.Store;
};

export function getSessionOptions(redisClient: RedisClientType): session.SessionOptions {
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
