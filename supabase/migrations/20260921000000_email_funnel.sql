-- Opt-in email funnel: free resume check -> double opt-in -> automated drip.
-- Additive only. RLS is enabled with no policies: these tables are reachable only
-- through the service role / server connection, never from the browser.

create table if not exists public.email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'unsubscribed', 'bounced', 'complained')),
  source text,
  target_role text,
  target_location text,
  consent_text text not null,
  consent_at timestamptz not null default now(),
  consent_ip_hash text,
  confirm_token text not null,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_confirm_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists email_subscribers_email_key on public.email_subscribers (lower(email));
create index if not exists email_subscribers_status_idx on public.email_subscribers (status);
create unique index if not exists email_subscribers_confirm_token_key on public.email_subscribers (confirm_token);

create table if not exists public.email_sends (
  id bigint generated always as identity primary key,
  subscriber_id uuid not null references public.email_subscribers(id) on delete cascade,
  step int not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 1,
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (subscriber_id, step)  -- a step can never be sent twice
);
create index if not exists email_sends_status_idx on public.email_sends (status, created_at);

create table if not exists public.resume_checks (
  id bigint generated always as identity primary key,
  subscriber_id uuid references public.email_subscribers(id) on delete set null,
  ip_hash text,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists resume_checks_ip_idx on public.resume_checks (ip_hash, created_at);
create index if not exists resume_checks_created_idx on public.resume_checks (created_at);

alter table public.email_subscribers enable row level security;
alter table public.email_sends enable row level security;
alter table public.resume_checks enable row level security;
