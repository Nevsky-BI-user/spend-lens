-- ============================================================
-- spend-lens — Supabase schema, migration 002_digests (contract v1.7a)
-- Adds the per-session digest column and the projects_agg roll-up.
-- Idempotent: safe to re-run via the SQL Editor.
-- Run AFTER 001_init.sql.
-- ============================================================

-- ------------------------------------------------------------
-- sessions_agg.digest — mirrors snapshot sessions[].digest
--   { activity, tools:{name:count}, areas:[{path,count}],
--     edits, filesTouched, intent }
-- Nullable on purpose: rows written by a pre-v1.7 collector keep NULL and
-- the UI degrades silently (contract: "readers must tolerate v1").
-- ------------------------------------------------------------
alter table public.sessions_agg
  add column if not exists digest jsonb;

-- ------------------------------------------------------------
-- projects_agg — mirrors snapshot projects[] (grain: one row per project)
-- Arrays stay jsonb so the shape follows the snapshot without a migration:
--   models     ["claude-fable-5", …]              top 3 by cost
--   areas      [{"path":"src/lib","count":24}, …] top 5
--   activities [{"label":"правки коду","count":6}, …]
--   titles     ["…", …]                           top 5 session titles by cost
-- note is plain text: the optional manual description from collector/projects.json.
-- ------------------------------------------------------------
create table if not exists public.projects_agg (
  project            text             primary key,
  sessions           integer          not null default 0,
  sidechain_sessions integer          not null default 0,
  cost_usd           double precision not null default 0,
  first_day          date,
  last_day           date,
  models             jsonb            not null default '[]'::jsonb,
  areas              jsonb            not null default '[]'::jsonb,
  activities         jsonb            not null default '[]'::jsonb,
  titles             jsonb            not null default '[]'::jsonb,
  note               text
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
create index if not exists projects_agg_cost_idx on public.projects_agg (cost_usd desc);

-- ------------------------------------------------------------
-- Row Level Security — identical pattern to 001_init:
-- SELECT only, only for the "authenticated" role, only for allowlisted emails.
-- No INSERT/UPDATE/DELETE policies: the collector writes with the service_role
-- key, which bypasses RLS entirely.
-- ------------------------------------------------------------
alter table public.projects_agg enable row level security;

drop policy if exists projects_agg_select on public.projects_agg;
create policy projects_agg_select on public.projects_agg
  for select to authenticated
  using ((auth.jwt() ->> 'email') in (select email from public.allowed_users));

grant select on public.projects_agg to authenticated;
