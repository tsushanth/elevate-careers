-- supabase/manual/20261012000100_job_feed_title_gin.sql
-- Role filter / profile match (src/services/roleMatch.js): the feed queries
--   to_tsvector('simple', f.title) @@ $n::tsquery
-- This GIN index is built on exactly that expression, restricted to live rows like the other
-- job_feed indexes. Single statement: CREATE INDEX CONCURRENTLY cannot run in a transaction, so run
-- it by hand (not `supabase db push` / apply_migration), off-peak, then ANALYZE.
-- Safe to re-run. Nothing reads it until FEED_ROLE_MATCH=on (README step "Role match").
create index concurrently if not exists idx_feed_title_tsv
  on public.job_feed using gin (to_tsvector('simple', title)) where is_active;
-- Then: ANALYZE public.job_feed;
-- Check valid: select indisvalid from pg_index where indexrelid = 'public.idx_feed_title_tsv'::regclass;
