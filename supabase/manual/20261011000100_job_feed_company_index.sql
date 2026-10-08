-- supabase/manual/20261011000100_job_feed_company_index.sql
-- Step (a2): run right after the migration, BEFORE deploying the code that calls
-- recompute_company_rank(). One statement, CONCURRENTLY, safe to re-run.
-- Serves recompute_company_rank (rank one company's active primary rows).
create index concurrently if not exists idx_feed_company
  on public.job_feed (company_key, sort_at desc, job_id desc) where is_active and is_primary;
