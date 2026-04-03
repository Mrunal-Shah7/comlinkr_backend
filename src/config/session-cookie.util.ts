import { getSessionSecret, SESSION_COOKIE_NAME } from './session.config';

// Transitive dep of express-session
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieSignature = require('cookie-signature') as {
  sign: (value: string, secret: string) => string;
};

/**
 * Value for the `Cookie` request header (e.g. for React Native clients that cannot use Set-Cookie).
 * Matches express-session’s signed cookie format.
 */
export function buildSessionCookieHeader(sessionId: string): string {
  const secret = getSessionSecret();
  const signed = 's:' + cookieSignature.sign(sessionId, secret);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}
