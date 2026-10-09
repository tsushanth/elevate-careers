-- supabase/manual/20261013000100_job_feed_country_remote_index.sql
-- Near-home-first feed (FEED_NEAR, src/services/nearHome.js): ONE extra index. Run it on its own (CREATE INDEX
-- CONCURRENTLY cannot run in a transaction), off-peak, AFTER 20261011000300_job_feed_feedat_indexes.sql.
-- Safe to re-run. It serves the "remote jobs of the country" arm of tier 0: an ordered walk of just the
-- remote rows (~7% of the country), so the arm never has to scan the whole country index to find them,
-- also when few or none are left past the cursor. Same expression as idx_feed_country_fa.
create index concurrently if not exists idx_feed_country_remote_fa
  on public.job_feed (country_code, (coalesce(feed_at, sort_at)) desc, job_id desc) where is_active and is_country_primary and remote;
-- Then: ANALYZE public.job_feed;
-- Check it is valid:  select indisvalid from pg_index where indexrelid = 'public.idx_feed_country_remote_fa'::regclass;
-- Verify:  FEED_ORDER=feed_at node scripts/explain-feed.js   (the "near" scenarios must show no FAIL).
-- Rollback: drop index concurrently if exists public.idx_feed_country_remote_fa;  (the feature still works, slower at the tail of tier 0)
