// src/services/jobFeed.js
// Keeps job_feed in step with job + job_location. One implementation for a
// single job (ingest) and for batches (backfill).
import { buildFeedRows } from './feedRows.js';

export const JOB_FEED_COLUMNS = [
  'job_id', 'country_code', 'region_code', 'city_key', 'city', 'sort_at', 'remote', 'employment_type',
  'salary_min', 'salary_max', 'salary_currency', 'title', 'company_name', 'company_key',
  'company_logo_domain', 'provider', 'apply_url', 'apply_provider', 'autofill_ready', 'is_active',
  'is_primary', 'is_country_primary', 'is_region_primary',
];

const KEY_COLUMNS = ['job_id', 'country_code', 'region_code', 'city_key'];
const RECORD_DEF = `job_id bigint, country_code text, region_code text, city_key text, city text,
  sort_at timestamptz, remote boolean, employment_type text, salary_min numeric, salary_max numeric,
  salary_currency text, title text, company_name text, company_key text, company_logo_domain text,
  provider text, apply_url text, apply_provider text, autofill_ready boolean, is_active boolean,
  is_primary boolean, is_country_primary boolean, is_region_primary boolean`;

// Company keys per recompute statement. Each statement ranks only those companies'
// active primary rows (idx_feed_company) and writes only rows whose rank changed, so
// its cost is bounded by the keys' row counts and the rank cap (feed_rank_cap()).
export const RECOMPUTE_CHUNK = 200;

// Recompute company_rank / feed_at for these companies (one statement per chunk).
// Fail-soft: the feed orders by coalesce(feed_at, sort_at), so a failed recompute
// leaves a slightly stale order, never a broken or empty feed. Reconcile repairs it.
export async function recomputeCompanyRank(db, companyKeys, { logger = console } = {}) {
  const keys = [...new Set(companyKeys)].filter(k => typeof k === 'string');
  let written = 0;
  for (let i = 0; i < keys.length; i += RECOMPUTE_CHUNK) {
    try {
      const { rows } = await db.query('SELECT recompute_company_rank($1::text[]) AS n', [keys.slice(i, i + RECOMPUTE_CHUNK)]);
      written += Number(rows?.[0]?.n) || 0;
    } catch (e) {
      try { logger?.warn?.({ error: e.message }, 'recompute_company_rank failed'); } catch { /* ignore */ }
    }
  }
  return written;
}

// opts.companyKeys: a Set. When given, the affected company keys are added to it and
// the recompute is left to the caller (feedReconcile does one pass per run instead of
// one per chunk); otherwise the recompute runs here, once for the whole batch.
async function finishCompanies(db, keys, opts) {
  if (opts.companyKeys) { for (const k of keys) opts.companyKeys.add(k); return; }
  await recomputeCompanyRank(db, keys, opts);
}

export async function syncJobFeedBatch(db, jobIds, opts = {}) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return 0;
  // Companies whose rank this batch can change: the jobs' previous company (a job may
  // move company) and their new one. Read before the upsert overwrites company_key.
  const affected = new Set();
  try {
    const { rows } = await db.query('SELECT DISTINCT company_key FROM job_feed WHERE job_id = ANY($1::bigint[])', [ids]);
    for (const r of rows || []) affected.add(r.company_key);
  } catch { /* first sync of a new job has nothing to read; the new key is added below */ }

  const [{ rows: jobs }, { rows: locs }] = await Promise.all([
    db.query(
      `SELECT j.id, j.title, j.provider, j.apply_url, j.employment_type, j.remote, j.salary_min, j.salary_max,
              j.salary_currency, j.posted_at, j.created_at, j.is_active,
              c.name AS company_name, c.logo_domain AS company_logo_domain, c.name_normalized AS company_key
       FROM job j JOIN company c ON c.id = j.company_id WHERE j.id = ANY($1::bigint[])`, [ids]),
    db.query('SELECT job_id, city, region, country FROM job_location WHERE job_id = ANY($1::bigint[]) ORDER BY id', [ids]),
  ]);

  const locsByJob = new Map();
  for (const l of locs) {
    if (!locsByJob.has(l.job_id)) locsByJob.set(l.job_id, []);
    locsByJob.get(l.job_id).push(l);
  }
  const rows = jobs.flatMap(j => buildFeedRows(j, locsByJob.get(j.id) || []));
  for (const r of rows) affected.add(r.company_key);

  if (rows.length) {
    const cols = JOB_FEED_COLUMNS.join(', ');
    const updates = JOB_FEED_COLUMNS.filter(c => !KEY_COLUMNS.includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ');
    // sort_at is stored with millisecond precision so the feed cursor (a JS ISO
    // string) round-trips exactly against the keyset comparison.
    const selectList = JOB_FEED_COLUMNS.map(c => (c === 'sort_at' ? "date_trunc('milliseconds', sort_at)" : c)).join(', ');
    // Upsert first, then delete stale rows, so readers never see a job with
    // fewer rows than it should have.
    await db.query(
      `INSERT INTO job_feed (${cols})
       SELECT ${selectList} FROM jsonb_to_recordset($1::jsonb) AS r(${RECORD_DEF})
       ON CONFLICT (job_id, country_code, region_code, city_key) DO UPDATE SET ${updates}`,
      [JSON.stringify(rows)]);
  }

  // Remove rows no longer produced (changed locations) and rows of deleted jobs.
  await db.query(
    `DELETE FROM job_feed f
     WHERE f.job_id = ANY($1::bigint[])
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(job_id bigint, country_code text, region_code text, city_key text)
         WHERE r.job_id = f.job_id AND r.country_code = f.country_code
           AND r.region_code = f.region_code AND r.city_key = f.city_key)`,
    [ids, JSON.stringify(rows.map(r => ({ job_id: r.job_id, country_code: r.country_code, region_code: r.region_code, city_key: r.city_key })))]);

  await finishCompanies(db, affected, opts);
  return rows.length;
}

export const syncJobFeed = (db, jobId, opts) => syncJobFeedBatch(db, [jobId], opts);

// Deactivated rows leave their company's ranking, so the remaining jobs move up.
export async function deactivateInFeed(db, jobIds, opts = {}) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return;
  const { rows } = await db.query(
    'UPDATE job_feed SET is_active = false WHERE job_id = ANY($1::bigint[]) AND is_active RETURNING company_key', [ids]);
  await finishCompanies(db, new Set((rows || []).map(r => r.company_key)), opts);
}
