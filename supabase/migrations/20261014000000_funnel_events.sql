-- Anonymous first-party funnel on the existing analytics_events table.
-- NOT APPLIED by this commit. Apply BEFORE deploying the web/extension builds that write
-- visit_id / surface (rollback at the bottom). Additive except the insert policy, which is
-- replaced by a stricter one (event-name allowlist, bounded properties, no user_id).
--
-- Privacy shape: visit_id is a random per-browser (or per-extension-install) string chosen by
-- the client. No IP, no user agent, no user_id is stored by this path.

alter table public.analytics_events add column if not exists visit_id text;
alter table public.analytics_events add column if not exists surface text not null default 'web';

create index if not exists analytics_events_visit_idx
  on public.analytics_events (visit_id, created_at) where visit_id is not null;

-- Old policy: anyone could insert any row (any event name, any size, any user_id).
drop policy if exists "Anyone can insert events" on public.analytics_events;
drop policy if exists "Insert allowed funnel events" on public.analytics_events;

create policy "Insert allowed funnel events"
  on public.analytics_events for insert
  to anon, authenticated
  with check (
    user_id is null
    and surface in ('web', 'extension', 'app')
    and event_name in (
      -- funnel
      'landing_view', 'jobs_view', 'job_open', 'search', 'signup_start', 'signup_complete',
      'onboarding_step', 'save_job', 'apply_click', 'extension_install_seen',
      'extension_first_fill', 'extension_fill',
      -- legacy names still sent by browsers holding an older cached bundle
      'signup_completed', 'onboarding_shown', 'onboarding_install_clicked', 'onboarding_skipped'
    )
    and (visit_id is null or visit_id ~ '^[A-Za-z0-9_-]{16,64}$')
    and jsonb_typeof(properties) = 'object'
    and length(properties::text) <= 1000
  );

-- ---------------------------------------------------------------------------------------------
-- Aggregates. Plain views owned by the migration role; they are NOT exposed to the API roles
-- (revoked below) and are read by the SECURITY DEFINER admin function instead.
-- All dates are UTC. "Visitor" = distinct visit_id.
-- ---------------------------------------------------------------------------------------------

create or replace view public.funnel_daily as
select created_at::date as day,
       surface,
       event_name,
       count(*)                    as events,
       count(distinct visit_id)    as visitors
from public.analytics_events
where event_name in ('landing_view','jobs_view','job_open','search','signup_start','signup_complete',
                     'signup_completed','onboarding_step','save_job','apply_click','extension_install_seen',
                     'extension_first_fill','extension_fill')
group by 1, 2, 3;

-- One row per visitor with what they did in their first 7 days.
--   activated = opened >= 3 distinct jobs, or saved a job, or clicked apply / filled an application
--   returned_w1 = came back on a different UTC day within days 1..7 after the first-seen day
--   matured = the 7-day window has fully passed (only matured visitors count in return rates)
create or replace view public.funnel_visitors as
with ev as (
  select id, visit_id, surface, event_name, created_at, properties
  from public.analytics_events
  where visit_id is not null
    and event_name in ('landing_view','jobs_view','job_open','search','signup_start','signup_complete',
                       'signup_completed','onboarding_step','save_job','apply_click','extension_install_seen',
                       'extension_first_fill','extension_fill')
), first as (
  select visit_id, surface, min(created_at) as first_seen
  from ev group by 1, 2
)
select f.visit_id,
       f.surface,
       f.first_seen,
       date_trunc('week', f.first_seen)::date as cohort_week,
       coalesce(bool_or(e.event_name in ('signup_complete','signup_completed')), false) as signed_up,
       count(distinct coalesce(e.properties->>'job_id', e.id::text))
         filter (where e.event_name = 'job_open') as jobs_opened,
       coalesce(bool_or(e.event_name = 'save_job'), false) as saved,
       coalesce(bool_or(e.event_name in ('apply_click','extension_fill','extension_first_fill')), false) as applied,
       coalesce(bool_or(e.created_at::date between f.first_seen::date + 1 and f.first_seen::date + 7), false) as returned_w1,
       (f.first_seen::date + 7 < (now() at time zone 'utc')::date) as matured
from first f
join ev e
  on e.visit_id = f.visit_id and e.surface = f.surface
 and e.created_at >= f.first_seen
 and e.created_at <  f.first_seen::date + 8
group by f.visit_id, f.surface, f.first_seen;

create or replace view public.funnel_weekly as
select cohort_week                                                        as week,
       surface,
       count(*)                                                           as new_visitors,
       count(*) filter (where signed_up)                                  as signups,
       count(*) filter (where jobs_opened >= 3 or saved or applied)       as activated,
       count(*) filter (where matured)                                    as matured_visitors,
       count(*) filter (where matured and returned_w1)                    as returned_w1
from public.funnel_visitors
group by 1, 2;

revoke all on public.funnel_daily, public.funnel_visitors, public.funnel_weekly from public, anon, authenticated;

-- Optional retention (not scheduled): analytics rows older than ~13 months are not useful.
--   delete from public.analytics_events where created_at < now() - interval '400 days';

-- ROLLBACK (the client builds stop writing the new columns when reverted; these are safe either way):
--   drop view if exists public.funnel_weekly, public.funnel_visitors, public.funnel_daily;
--   drop policy if exists "Insert allowed funnel events" on public.analytics_events;
--   create policy "Anyone can insert events" on public.analytics_events for insert to anon, authenticated with check (true);
--   drop index if exists public.analytics_events_visit_idx;
--   alter table public.analytics_events drop column if exists visit_id, drop column if exists surface;
