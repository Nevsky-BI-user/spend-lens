-- ============================================================
-- spend-lens — Supabase schema, migration 001_init
-- Idempotent: safe to re-run via SQL Editor (IF NOT EXISTS /
-- DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING everywhere).
-- ============================================================

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

-- Daily aggregates: grain = day × project × model × sidechain.
-- Columns mirror snapshot "days" entries (usage.json, schemaVersion 1).
create table if not exists public.usage_days (
  day            date             not null,
  project        text             not null,
  model          text             not null,
  sidechain      boolean          not null default false,
  input          bigint           not null default 0,
  output         bigint           not null default 0,
  cache_read     bigint           not null default 0,
  cache_write_5m bigint           not null default 0,
  cache_write_1h bigint           not null default 0,
  cost_usd       double precision not null default 0,
  messages       integer          not null default 0,
  sessions       integer          not null default 0,
  primary key (day, project, model, sidechain)
);

-- Per-session aggregates. Mirrors snapshot "sessions" entries;
-- "models" kept as jsonb (per-model token/cost breakdown),
-- "totals" flattened into top-level columns.
-- "day" is a stored generated column (Europe/Kyiv bucketing, same TZ
-- as the collector) so the web app can filter sessions by day range.
create table if not exists public.sessions_agg (
  session_id      text             primary key,
  project         text,
  project_path    text,
  title           text,
  sidechain       boolean          not null default false,
  started_at      timestamptz,
  ended_at        timestamptz,
  user_turns      integer          not null default 0,
  assistant_turns integer          not null default 0,
  models          jsonb            not null default '{}'::jsonb,
  input           bigint           not null default 0,
  output          bigint           not null default 0,
  cache_read      bigint           not null default 0,
  cache_write_5m  bigint           not null default 0,
  cache_write_1h  bigint           not null default 0,
  cost_usd        double precision not null default 0,
  max_context     bigint           not null default 0,
  avg_context     double precision not null default 0,
  cache_hit_rate  double precision not null default 0,
  day             date generated always as
                    ((timezone('Europe/Kyiv', started_at))::date) stored
);

-- Snapshot metadata: generatedAt, pricingUsed, pricingSource, warnings…
-- One row per key, value is arbitrary jsonb.
create table if not exists public.meta (
  key   text  primary key,
  value jsonb not null
);

-- Auth allowlist. Only emails listed here can read data (see RLS below).
create table if not exists public.allowed_users (
  email text primary key
);

-- Seed the owner. ON CONFLICT DO NOTHING → re-runs are safe.
-- Replace the placeholder e-mail with the owner's Google account BEFORE running
-- (supabase/README.md §2). Never put a real address here — the repo is public.
insert into public.allowed_users (email)
values ('<your-email@example.com>')
on conflict (email) do nothing;

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
-- usage_days PK already leads with "day", which covers day-range scans.
create index if not exists sessions_agg_day_idx  on public.sessions_agg (day);
create index if not exists sessions_agg_cost_idx on public.sessions_agg (cost_usd desc);

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
-- Enabled on ALL tables. Only SELECT policies exist, and only for the
-- "authenticated" role → anon sees nothing, and nobody can INSERT/UPDATE/
-- DELETE through the API. The collector writes with the service_role key,
-- which bypasses RLS entirely.

alter table public.usage_days    enable row level security;
alter table public.sessions_agg  enable row level security;
alter table public.meta          enable row level security;
alter table public.allowed_users enable row level security;

-- Data tables: readable only when the JWT email is in the allowlist.
drop policy if exists usage_days_select on public.usage_days;
create policy usage_days_select on public.usage_days
  for select to authenticated
  using ((auth.jwt() ->> 'email') in (select email from public.allowed_users));

drop policy if exists sessions_agg_select on public.sessions_agg;
create policy sessions_agg_select on public.sessions_agg
  for select to authenticated
  using ((auth.jwt() ->> 'email') in (select email from public.allowed_users));

drop policy if exists meta_select on public.meta;
create policy meta_select on public.meta
  for select to authenticated
  using ((auth.jwt() ->> 'email') in (select email from public.allowed_users));

-- allowed_users itself: a user may only see their OWN row. This is
-- deliberately NOT the subquery form — a policy on allowed_users that
-- subqueries allowed_users would raise "infinite recursion detected".
-- The self-row policy also makes the subqueries above work correctly:
-- inside them, RLS on allowed_users returns the caller's own row when
-- allowlisted (IN → true) and an empty set otherwise (IN → false).
drop policy if exists allowed_users_select_self on public.allowed_users;
create policy allowed_users_select_self on public.allowed_users
  for select to authenticated
  using (email = (auth.jwt() ->> 'email'));

-- ------------------------------------------------------------
-- Grants (explicit, though Supabase default privileges usually cover this)
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on public.usage_days    to authenticated;
grant select on public.sessions_agg  to authenticated;
grant select on public.meta          to authenticated;
grant select on public.allowed_users to authenticated;
