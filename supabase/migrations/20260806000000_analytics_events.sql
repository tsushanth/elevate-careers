-- Lightweight append-only funnel event log.
-- Purpose: answer "where do new signups drop off" without guessing.
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_name_idx on public.analytics_events (event_name, created_at);
create index if not exists analytics_events_user_id_idx on public.analytics_events (user_id, created_at);

alter table public.analytics_events enable row level security;

-- Anyone (including anon, pre-auth) can insert their own events.
-- Nobody can read except via service role (used for internal dashboards/queries).
create policy "Anyone can insert events"
  on public.analytics_events for insert
  to anon, authenticated
  with check (true);
