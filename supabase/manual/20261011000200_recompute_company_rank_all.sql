-- supabase/manual/20261011000200_recompute_company_rank_all.sql
-- Step (c): one-shot recompute of company_rank and feed_at for every active row.
-- A single UPDATE ... FROM (window); idempotent (rewrites only rows that differ),
-- so it can be re-run. Measured on 300k synthetic rows: see the PR description.
-- Run it from the SQL editor with a raised statement timeout if the role's is short:
--   set statement_timeout = '300s';
update public.job_feed f
   set company_rank = r.rk, feed_at = f.sort_at - public.feed_penalty(r.rk)
  from (select job_id,
               least(row_number() over (partition by company_key order by sort_at desc, job_id desc),
                     public.feed_rank_cap())::integer as rk
        from public.job_feed
        where is_active and is_primary) r
 where f.job_id = r.job_id and f.is_active
   and (f.company_rank is distinct from r.rk
        or f.feed_at is distinct from f.sort_at - public.feed_penalty(r.rk));
-- Then:
-- analyze public.job_feed;
