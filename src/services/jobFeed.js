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

export async function syncJobFeedBatch(db, jobIds) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return 0;

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

  return rows.length;
}

export const syncJobFeed = (db, jobId) => syncJobFeedBatch(db, [jobId]);

export async function deactivateInFeed(db, jobIds) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return;
  await db.query('UPDATE job_feed SET is_active = false WHERE job_id = ANY($1::bigint[])', [ids]);
}
