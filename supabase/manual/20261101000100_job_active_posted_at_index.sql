-- supabase/manual/20261101000100_job_active_posted_at_index.sql
-- Run this ONE statement on its own, outside a transaction (CREATE INDEX
-- CONCURRENTLY cannot run in a transaction, so `supabase db push` and
-- `apply_migration` would abort on it), off-peak. Safe to re-run. If a run is
-- interrupted it leaves an INVALID index: drop it (DROP INDEX CONCURRENTLY
-- public.idx_job_active_posted_at) and run this again. Rollback is the same DROP.
--
-- Serves GET /jobs (src/services/jobsList.js): the newest N active jobs by
-- (posted_at DESC NULLS LAST, id DESC). Without it Postgres reads the heap of
-- all ~98,000 active jobs (~58,000 pages, 9 to 15 s measured on 2026-11-01) to
-- find the newest 20. With it the same page is ~20 index entries (~70 ms measured
-- with the closest existing index). Size: ~98k entries, a few MB.
-- The code works without it, only slower on a cache miss.
create index concurrently if not exists idx_job_active_posted_at
  on public.job (posted_at desc nulls last, id desc) where is_active;
