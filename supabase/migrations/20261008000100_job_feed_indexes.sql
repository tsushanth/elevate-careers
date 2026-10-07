-- supabase/migrations/20261008000100_job_feed_indexes.sql
-- Run each statement on its own (CREATE INDEX CONCURRENTLY cannot run in a
-- transaction), off-peak, AFTER the backfill. Safe to re-run.
create index concurrently if not exists idx_feed_primary
  on public.job_feed (sort_at desc, job_id desc) where is_active and is_primary;
create index concurrently if not exists idx_feed_primary_remote
  on public.job_feed (sort_at desc, job_id desc) where is_active and is_primary and remote;
create index concurrently if not exists idx_feed_country
  on public.job_feed (country_code, sort_at desc, job_id desc) where is_active and is_country_primary;
create index concurrently if not exists idx_feed_region
  on public.job_feed (country_code, region_code, sort_at desc, job_id desc) where is_active and is_region_primary;
create index concurrently if not exists idx_feed_city
  on public.job_feed (country_code, region_code, city_key, sort_at desc, job_id desc) where is_active;
