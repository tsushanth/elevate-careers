-- supabase/migrations/20261008000000_job_feed.sql
-- Read model for the home feed. One row per (job, country, region, city) with
-- everything a list card needs, so a feed page is one index range scan.
-- Indexes are created separately by hand (supabase/manual/20261008000100_job_feed_indexes.sql) after
-- the backfill, with CONCURRENTLY; it must not run inside a migration transaction.
create table if not exists public.job_feed (
  job_id bigint not null,
  country_code text not null,
  region_code text not null default '',
  city_key text not null default '',
  city text,
  sort_at timestamptz not null,
  remote boolean not null default false,
  employment_type text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  title text not null,
  company_name text not null,
  company_key text not null default '',
  company_logo_domain text,
  provider text,
  apply_url text not null,
  apply_provider text,
  autofill_ready boolean not null default false,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  is_country_primary boolean not null default false,
  is_region_primary boolean not null default false,
  primary key (job_id, country_code, region_code, city_key)
);

create table if not exists public.geo_place (
  id bigserial primary key,
  type text not null check (type in ('country', 'state', 'city')),
  label text not null,
  name_key text not null,
  country_code text not null,
  region_code text not null default '',
  city_key text not null default '',
  job_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (type, country_code, region_code, city_key)
);
create index if not exists geo_place_name_key_idx on public.geo_place (name_key text_pattern_ops);

-- Read only by the API (postgres role, bypasses RLS). Nothing for anon.
alter table public.job_feed enable row level security;
alter table public.geo_place enable row level security;
