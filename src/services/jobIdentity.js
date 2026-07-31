import { db } from '../db/index.js';

// Resolves a stable job.id for a URL at the moment it's needed (applying),
// while the URL is still fresh — instead of leaving job_applications to be
// matched against apply_url later, which can drift on re-ingestion and
// silently un-hide an already-applied job. Returns null if no match (e.g.
// URL isn't one of ours, or the job was removed) — callers should still
// insert the job_applications row with job_id NULL rather than fail.
export async function resolveJobIdForUrl(applyUrl) {
  if (!applyUrl) return null;
  try {
    const result = await db.query(
      `SELECT id FROM job
       WHERE rtrim(split_part(apply_url, '?', 1), '/') = rtrim(split_part($1, '?', 1), '/')
       LIMIT 1`,
      [applyUrl]
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
