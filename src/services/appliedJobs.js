// Jobs the user has applied to are hidden from the feed, as the old list did by default (show_applied=false).
// Prefer job_id (resolved once at apply time, stable) and fall back to the stored apply URL for older rows whose
// job_id could not be filled in (apply_url can drift on re-ingestion, so this is only a fallback).
const MAX_ROWS = 5000;
const MAX_URLS = 500;

export async function loadAppliedJobIds({ sb, db, userId }) {
  const { data, error } = await sb.from('job_applications').select('job_id, job_url').eq('user_id', userId).limit(MAX_ROWS);
  if (error || !Array.isArray(data)) return [];
  const ids = new Set(data.map(r => Number(r.job_id)).filter(n => Number.isFinite(n) && n > 0));
  const urls = [...new Set(data.filter(r => !r.job_id && r.job_url).map(r => r.job_url))].slice(0, MAX_URLS);
  if (urls.length) {
    try {
      const { rows } = await db.query('SELECT DISTINCT job_id FROM job_feed WHERE apply_url = ANY($1::text[])', [urls]);
      for (const r of rows) { const n = Number(r.job_id); if (Number.isFinite(n)) ids.add(n); }
    } catch { /* keep the ids already resolved */ }
  }
  return [...ids];
}
