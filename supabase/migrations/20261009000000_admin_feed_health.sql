-- supabase/migrations/20261009000000_admin_feed_health.sql
-- Admin-only: how in sync is job_feed with job? Same access rule as simplyapply_admin_overview.
create or replace function public.simplyapply_admin_feed_health()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and lower(u.email) in (select lower(email) from public.simplyapply_admins)
      and (u.raw_app_meta_data->'providers') ? 'google'
  ) into v_ok;
  if not coalesce(v_ok, false) then raise exception 'not found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'feed_rows', (select reltuples::bigint from pg_class where oid = 'public.job_feed'::regclass),
    'active_jobs_missing_from_feed', (
      select count(*) from (select id from job where is_active order by id desc limit 50000) j
      where not exists (select 1 from job_feed f where f.job_id = j.id)),
    'unknown_location_jobs', (select count(distinct job_id) from job_feed where is_active and country_code = 'ZZ'),
    'inactive_job_active_in_feed', (
      select count(*) from (select job_id from job_feed where is_active limit 200000) f
      join job j on j.id = f.job_id where not j.is_active),
    'places', (select count(*) from geo_place)
  );
end;
$$;
revoke all on function public.simplyapply_admin_feed_health() from public, anon;
grant execute on function public.simplyapply_admin_feed_health() to authenticated;
