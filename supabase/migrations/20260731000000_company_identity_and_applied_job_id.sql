-- Fixes two related bugs: excluded companies/titles silently reappearing
-- after re-ingestion (company identity was keyed only by domain, which
-- isn't stable across ingestion runs), and applied jobs reappearing in the
-- feed (applied-job matching was a string comparison against apply_url,
-- which drifts on re-ingest instead of a stable id).

-- 1. Normalized company name, so a new domain variant of an already-known
--    company can be found instead of spawning a duplicate row.
ALTER TABLE company ADD COLUMN IF NOT EXISTS name_normalized TEXT;

-- Note: Postgres regexp_replace uses POSIX ARE syntax, where \b is a
-- backspace escape, NOT a word boundary (\y is) — unlike JS \b. Must match
-- normalizeCompanyName() in src/services/normalizer.js exactly, including
-- stripping punctuation before the legal-suffix pass so "Bumble Inc." and
-- "Bumble Inc" normalize identically.
UPDATE company
SET name_normalized = trim(regexp_replace(
  regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'), '\y(inc|llc|ltd|corp|co)\y', '', 'g'),
  '\s+', ' ', 'g'
))
WHERE name_normalized IS NULL;

CREATE INDEX IF NOT EXISTS idx_company_name_normalized ON company (name_normalized);

-- 2. Stable link from an applied job to the job row, resolved once at apply
--    time instead of re-derived later from a URL that can drift.
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS job_id BIGINT REFERENCES job(id);

-- Best-effort backfill for existing rows: match on the same normalized-URL
-- comparison the app already used, since apply_url hasn't necessarily
-- drifted yet for jobs applied to recently.
UPDATE job_applications ja
SET job_id = j.id
FROM job j
WHERE ja.job_id IS NULL
  AND rtrim(split_part(j.apply_url, '?', 1), '/') = rtrim(split_part(ja.job_url, '?', 1), '/');

CREATE INDEX IF NOT EXISTS idx_job_applications_job_id ON job_applications (job_id);
