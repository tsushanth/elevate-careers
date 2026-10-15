-- Adds a 'web_funnel' key to simplyapply_admin_overview(). Everything else is the 20261007 body unchanged.
-- NOT APPLIED by this commit. Apply AFTER 20261014000000_funnel_events.sql (it reads the funnel_* views;
-- applying it first makes the whole admin page fail with "relation funnel_weekly does not exist").
-- ROLLBACK: re-run supabase/migrations/20261007000000_simplyapply_admin_overview.sql (create or replace).

create or replace function public.simplyapply_admin_overview(p_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 14), 1), 90);
  v_ok boolean;
  v_admin_ids uuid[];
  r jsonb;
begin
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) in (select lower(email) from public.simplyapply_admins)
      and (u.raw_app_meta_data->'providers') ? 'google'
  ) into v_ok;
  if not coalesce(v_ok, false) then
    raise exception 'not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}') into v_admin_ids
  from auth.users where lower(email) in (select lower(email) from public.simplyapply_admins);

  with uni as (
    select user_id from user_profile union select user_id from user_usage
    union select user_id from job_applications union select user_id from apply_preferences
    union select user_id from user_signals union select user_id from saved_job
    union select user_id from analytics_events where user_id is not null
  ),
  su as (
    select u.id, u.email, u.created_at, u.last_sign_in_at,
           coalesce((select string_agg(p, ',') from jsonb_array_elements_text(u.raw_app_meta_data->'providers') p), '') providers
    from auth.users u
    where (u.id in (select user_id from uni) or u.raw_user_meta_data->>'signup_via' in ('website','extension'))
      and not (u.id = any(v_admin_ids))
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', v_days,
    'users', (select jsonb_build_object(
        'total', count(*),
        'new_7d', count(*) filter (where created_at > now() - interval '7 days'),
        'new_30d', count(*) filter (where created_at > now() - interval '30 days'),
        'active_7d', count(*) filter (where last_sign_in_at > now() - interval '7 days'),
        'active_30d', count(*) filter (where last_sign_in_at > now() - interval '30 days')) from su),
    'signups_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n',
        (select count(*) from su where su.created_at::date = d::date)) order by d), '[]'::jsonb)
        from generate_series(current_date - (v_days - 1), current_date, interval '1 day') d),
    'recent_users', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select s.email, s.created_at, s.last_sign_in_at, s.providers,
          (select count(*) from job_applications j where j.user_id = s.id) fills,
          exists (select 1 from user_usage uu where uu.user_id = s.id and uu.extension_first_seen is not null) has_extension
        from su s order by s.created_at desc limit 15) x),
    'extension', (select jsonb_build_object(
        'installed_ever', count(*) filter (where extension_first_seen is not null),
        'seen_7d', count(*) filter (where extension_seen_at > now() - interval '7 days'),
        'new_7d', count(*) filter (where extension_first_seen > now() - interval '7 days'))
        from user_usage where not (user_id = any(v_admin_ids))),
    'autofill', (select jsonb_build_object(
        'fills_all', count(*),
        'fills_external', count(*) filter (where not (user_id = any(v_admin_ids))),
        'fills_external_7d', count(*) filter (where not (user_id = any(v_admin_ids)) and created_at > now() - interval '7 days'),
        'fills_external_30d', count(*) filter (where not (user_id = any(v_admin_ids)) and created_at > now() - interval '30 days'),
        'users_external_30d', count(distinct user_id) filter (where not (user_id = any(v_admin_ids)) and created_at > now() - interval '30 days'),
        'submitted', count(*) filter (where submitted),
        'ai_used', count(*) filter (where ai_used),
        'last_fill', max(created_at)) from job_applications),
    'fills_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
        'external', (select count(*) from job_applications j where j.created_at::date = d::date and not (j.user_id = any(v_admin_ids))),
        'admin', (select count(*) from job_applications j where j.created_at::date = d::date and j.user_id = any(v_admin_ids))) order by d), '[]'::jsonb)
        from generate_series(current_date - (v_days - 1), current_date, interval '1 day') d),
    'top_domains', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select substring(job_url from '^https?://([^/]+)') host, count(*) n
        from job_applications where created_at > now() - make_interval(days => v_days) and job_url is not null
        group by 1 order by n desc limit 8) x),
    'ai', (select jsonb_build_object('calls_total', coalesce(sum(ai_calls),0), 'users', count(*) filter (where ai_calls > 0))
        from user_usage where not (user_id = any(v_admin_ids))),
    'tiers', (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (
        select coalesce(subscription_tier,'free') t, count(*) n from user_profile
        where not (user_id = any(v_admin_ids)) group by 1) x),
    -- Anonymous web/extension funnel (20261014000000_funnel_events.sql): weekly cohorts and per-day event counts.
    -- Rates are for the reader to compute; return rates use matured_visitors as the denominator.
    'web_funnel', (select jsonb_build_object(
        'weekly', (select coalesce(jsonb_agg(x order by x.week desc, x.surface), '[]'::jsonb) from (
            select week, surface, new_visitors, signups, activated, matured_visitors, returned_w1
            from funnel_weekly order by week desc limit 24) x),
        'daily', (select coalesce(jsonb_agg(x order by x.day desc, x.event_name), '[]'::jsonb) from (
            select day, surface, event_name, events, visitors
            from funnel_daily where day > current_date - v_days) x))),
    'funnel', (select coalesce(jsonb_agg(x order by x.n_window desc), '[]'::jsonb) from (
        select event_name, count(*) n_all,
          count(*) filter (where created_at > now() - make_interval(days => v_days)) n_window,
          max(created_at) last_seen
        from analytics_events group by 1) x),
    -- Avoid scanning the 300k-row job table: the authenticated role has an 8s
    -- statement timeout. Total is the planner estimate; recent counts look only
    -- at the newest 50k rows by primary key.
    'jobs', (select jsonb_build_object(
        'total_approx', (select reltuples::bigint from pg_class where oid = 'public.job'::regclass),
        'added_24h', count(*) filter (where created_at > now() - interval '1 day'),
        'added_7d', count(*) filter (where created_at > now() - interval '7 days'),
        'latest_added', max(created_at)) from (select created_at from job order by id desc limit 50000) recent),
    'ingestion', (select jsonb_build_object(
        'sources_enabled', count(*) filter (where enabled),
        'sources_total', count(*),
        'ingested_24h', count(*) filter (where last_ingested_at > now() - interval '1 day'),
        'last_ingested', max(last_ingested_at)) from discovered_company),
    'repair', (select jsonb_build_object(
        'unresolved', count(*) filter (where not resolved),
        'top', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
            select domain, label, field_type, fail_reason, count, last_seen
            from repair_queue where not resolved order by count desc, last_seen desc limit 10) x))
        from repair_queue)
  ) into r;
  return r;
end;
$$;

revoke all on function public.simplyapply_admin_overview(int) from public, anon;
grant execute on function public.simplyapply_admin_overview(int) to authenticated;
