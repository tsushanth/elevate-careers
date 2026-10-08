-- supabase/migrations/20261011000000_job_feed_company_rank.sql
-- Per-company diversity for the home feed. A batch ingest from one company must
-- not own the top of the feed, so each active job is ranked within its company
-- (newest first) and the feed orders by feed_at = sort_at - penalty(rank).
-- Nothing is dropped: a company's older jobs are just spread over later pages.
--
-- Additive and idempotent. feed_at / company_rank stay NULL until
-- recompute_company_rank() (written by the app on every sync) or the one-shot
-- backfill (supabase/manual/20261011000200_recompute_company_rank_all.sql) fill
-- them; the query path orders by coalesce(feed_at, sort_at), so NULL is safe.
-- NULL (not "= sort_at") keeps this migration a metadata-only change on a live
-- table: no table rewrite, no long lock, and a row the old code inserts during a
-- rolling deploy needs no special handling.
alter table public.job_feed add column if not exists company_rank integer;
alter table public.job_feed add column if not exists feed_at timestamptz;

-- THE two tuning constants live here and only here.
-- Penalty per position within a company.
create or replace function public.feed_rank_step() returns interval
  language sql immutable parallel safe as $$ select interval '6 hours' $$;
-- Ranks are capped so a company with thousands of jobs rewrites a bounded number
-- of rows when one more job arrives (rows past the cap all share the same penalty
-- and are not touched). 121 => at most 120 * 6 h = 30 days of penalty.
create or replace function public.feed_rank_cap() returns integer
  language sql immutable parallel safe as $$ select 121 $$;
create or replace function public.feed_penalty(rank integer) returns interval
  language sql immutable parallel safe as $$
  select (least(greatest(rank, 1), public.feed_rank_cap()) - 1) * public.feed_rank_step() $$;

-- Recompute rank + feed_at for the given companies only. Ranking uses the
-- is_primary rows (a multi-location job counts once); every active row of a job
-- copies its job's rank. Only rows whose values change are written. Returns the
-- number of rows written. Uses idx_feed_company (manual file) when present.
create or replace function public.recompute_company_rank(company_keys text[]) returns integer
  language sql as $$
  with ranked as (
    select job_id,
           least(row_number() over (partition by company_key order by sort_at desc, job_id desc),
                 public.feed_rank_cap())::integer as rk
    from public.job_feed
    where is_active and is_primary and company_key = any(company_keys)
  ), upd as (
    update public.job_feed f
       set company_rank = r.rk, feed_at = f.sort_at - public.feed_penalty(r.rk)
      from ranked r
     where f.job_id = r.job_id and f.is_active
       and (f.company_rank is distinct from r.rk
            or f.feed_at is distinct from f.sort_at - public.feed_penalty(r.rk))
    returning 1
  )
  select count(*)::integer from upd $$;
