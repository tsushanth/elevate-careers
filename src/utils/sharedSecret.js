import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

/**
 * Constant-time check of a caller-supplied credential against a configured shared secret.
 * Fails closed: an unset/empty secret, or a missing/non-string credential, never matches
 * (so an absent env var cannot turn `undefined !== undefined` into a pass).
 */
export function secretMatches(given, expected) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof given !== 'string' || given.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** True when `given` is the INGEST_SECRET (read per call so tests and rotations see the current env). */
export function ingestSecretOk(given) {
  return secretMatches(given, process.env.INGEST_SECRET);
}
