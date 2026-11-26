-- The sign-up button on company pages sends 'company_signup_click' to analytics_events. This adds a second permissive
-- insert policy for that one name; the existing "Insert allowed funnel events" policy is not touched. Same limits:
-- no user_id, web only, bounded properties. Additive. No row is changed.
drop policy if exists "Insert company page sign-up clicks" on public.analytics_events;

create policy "Insert company page sign-up clicks"
  on public.analytics_events for insert
  to anon, authenticated
  with check (
    user_id is null
    and surface = 'web'
    and event_name = 'company_signup_click'
    and (visit_id is null or visit_id ~ '^[A-Za-z0-9_-]{16,64}$')
    and jsonb_typeof(properties) = 'object'
    and length(properties::text) <= 1000
  );

-- ROLLBACK:
--   drop policy if exists "Insert company page sign-up clicks" on public.analytics_events;
