import { Logger } from '@nestjs/common'; // SPRINT-46: log unclassifiable stored values once rather than guessing at them

/**
 * SPRINT-46: the single place that converts a stored media value into a client-loadable URL.
 *
 * The mobile client's rule: a value beginning with a recognised protocol prefix is used
 * unchanged; anything else is treated as a path relative to the API origin, with the API
 * prefix segment stripped and rejoined. A relative value that already carries the `/api`
 * prefix therefore resolves correctly; one without it resolves to an origin-level path
 * that does not exist. Both shapes are handled distinctly below.
 *
 * This function performs NO network call and never checks whether the object exists.
 */

const logger = new Logger('MediaUrl'); // SPRINT-46: shared logger for the unclassifiable branch
const loggedUnclassifiable = new Set<string>(); // SPRINT-46: log each distinct bad value once, not once per request

/** SPRINT-46: hosts this service serves or stores media on — only these may be protocol-upgraded. */
const UPGRADABLE_HOST_SUFFIXES = [
  'res.cloudinary.com', // SPRINT-46: the current storage provider's delivery host
  'cloudinary.com', // SPRINT-46: any other Cloudinary delivery subdomain
  'amazonaws.com', // SPRINT-46: Sprint 11-era S3 delivery hosts
];

/** SPRINT-46: true when the host is one this service is expected to serve or store media on. */
function isUpgradableHost(host: string, publicBase?: string | null): boolean {
  const h = host.toLowerCase(); // SPRINT-46: hosts are case-insensitive
  if (UPGRADABLE_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) {
    return true; // SPRINT-46: a known storage host
  }
  if (publicBase) {
    try {
      const baseHost = new URL(publicBase).host.toLowerCase(); // SPRINT-46: the configured delivery host counts too
      if (baseHost && h === baseHost) return true; // SPRINT-46: exact match against the configured base
    } catch {
      // SPRINT-46: an unparseable configured base simply grants no extra permission
    }
  }
  return false; // SPRINT-46: an unrelated host is never rewritten
}

/**
 * SPRINT-46: resolve one stored media value.
 * @param stored the raw column value, which may be absent
 * @param publicBase the configured public delivery base, e.g. `https://res.cloudinary.com/<cloud>`
 * @returns an absolute secure URL, a correctly-prefixed relative path, or null
 */
export function resolveMediaUrl(
  stored: string | null | undefined,
  publicBase?: string | null,
): string | null {
  // SPRINT-46: rule 1 — absent, empty or whitespace-only returns null, never an empty string,
  // because an empty string is a value the client will attempt to load.
  if (stored == null) return null;
  const s = stored.trim();
  if (s === '') return null;

  // SPRINT-46: rule 2 — already absolute and secure, returned unchanged.
  if (s.startsWith('https://')) return s;

  // SPRINT-46: rule 3 — absolute but insecure. Upgrade only hosts this service serves or
  // stores media on; an unrelated host is returned unchanged rather than silently rewritten.
  if (s.startsWith('http://')) {
    try {
      const parsed = new URL(s);
      if (isUpgradableHost(parsed.host, publicBase)) {
        parsed.protocol = 'https:'; // SPRINT-46: upgrade so Android's cleartext block does not reject it
        return parsed.toString();
      }
      return s; // SPRINT-46: foreign host, left exactly as stored
    } catch {
      return unclassifiable(s); // SPRINT-46: an unparseable absolute URL is not guessed at
    }
  }

  // SPRINT-46: rule 4a — relative value that ALREADY carries the API prefix. The client strips
  // that segment from its base and rejoins, so this shape resolves correctly and is left relative.
  // Adding the prefix here, or absolutising it, would break it.
  if (s.startsWith('/api/') || s.startsWith('api/')) {
    return s.startsWith('/') ? s : `/${s}`; // SPRINT-46: normalise to a single leading separator only
  }

  // SPRINT-46: rule 4b — relative storage key without the API prefix (e.g. `avatars/<id>/<file>.jpg`).
  // This is the shape that resolves to a non-existent origin-level path under the client's rule,
  // so it is joined to the configured public delivery base to produce an absolute secure URL.
  const key = s.replace(/^\/+/, ''); // SPRINT-46: drop any leading separators before joining
  if (key.includes('/') && !key.includes('..')) {
    if (!publicBase) {
      return unclassifiable(s); // SPRINT-46: no base configured — never emit a path the client cannot resolve
    }
    return `${publicBase.replace(/\/+$/, '')}/${key}`; // SPRINT-46: exactly one separator at the join
  }

  // SPRINT-46: rule 5 — anything else (a bare identifier with no path, a malformed value)
  // is unclassifiable. It returns null and is logged, never returned raw as a guess.
  return unclassifiable(s);
}

/** SPRINT-46: record an unclassifiable value once, precisely, then return absent. */
function unclassifiable(value: string): null {
  if (!loggedUnclassifiable.has(value)) {
    loggedUnclassifiable.add(value); // SPRINT-46: bound the log volume to distinct values
    logger.warn(
      `SPRINT-46: unclassifiable stored media value, returning null: ${JSON.stringify(value)}`, // SPRINT-46: record the value exactly so it is diagnosable in one look
    );
  }
  return null; // SPRINT-46: absent beats a broken link
}
