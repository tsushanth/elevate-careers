-- supabase/manual/20261008000200_job_updated_at_index.sql
-- Run this ONE statement on its own, outside a transaction (CREATE INDEX
-- CONCURRENTLY cannot run in a transaction, so `supabase db push` and
-- `apply_migration` would abort on it), off-peak. Safe to re-run. If a run is
-- interrupted it leaves an INVALID index: drop it (DROP INDEX CONCURRENTLY
-- public.idx_job_active_updated_at) and run this again.
-- Used by feedReconcile.findUpdatedInWindow (active jobs updated in the last N
-- hours, keyset-paged by (updated_at, id)). Until it exists and is valid the
-- reconcile job skips that selection and logs a warning.
create index concurrently if not exists idx_job_active_updated_at
  on public.job (updated_at desc) where is_active;
