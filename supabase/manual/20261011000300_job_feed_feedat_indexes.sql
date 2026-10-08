-- supabase/manual/20261011000300_job_feed_feedat_indexes.sql
-- Step (d): run each statement on its own (CREATE INDEX CONCURRENTLY cannot run in a
-- transaction), off-peak, AFTER the recompute-all (c) and BEFORE flipping FEED_ORDER=feed_at.
-- Safe to re-run. Same five shapes as 20261008000100_job_feed_indexes.sql, but ordered by
-- coalesce(feed_at, sort_at), the exact expression feedQuery.js orders and paginates by,
-- so a row whose feed_at is still NULL can never sort first. The existing sort_at
-- indexes stay (they serve FEED_ORDER=sort_at, the rollback).
create index concurrently if not exists idx_feed_primary_fa
  on public.job_feed ((coalesce(feed_at, sort_at)) desc, job_id desc) where is_active and is_primary;
create index concurrently if not exists idx_feed_primary_remote_fa
  on public.job_feed ((coalesce(feed_at, sort_at)) desc, job_id desc) where is_active and is_primary and remote;
create index concurrently if not exists idx_feed_country_fa
  on public.job_feed (country_code, (coalesce(feed_at, sort_at)) desc, job_id desc) where is_active and is_country_primary;
create index concurrently if not exists idx_feed_region_fa
  on public.job_feed (country_code, region_code, (coalesce(feed_at, sort_at)) desc, job_id desc) where is_active and is_region_primary;
create index concurrently if not exists idx_feed_city_fa
  on public.job_feed (country_code, region_code, city_key, (coalesce(feed_at, sort_at)) desc, job_id desc) where is_active;
-- Last step: ANALYZE public.job_feed;
