-- ============================================================
-- spend-lens: Supabase schema, migration 005_agent_spend
-- Облік витрат аналітика (Managed Agent) і денний ліміт.
-- Ідемпотентна: можна виконувати повторно через SQL Editor.
-- Запускати ПІСЛЯ 001_init.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Звідки числа. Під час розмови API шле подію session.usage, і її
-- list_cost КУМУЛЯТИВНИЙ: це сума за всю сесію на цю мить, у центах.
-- Тому за кожною сесією памʼятаємо останній знімок (agent_sessions.cents),
-- а до дня додаємо лише приріст. Повторний або старіший знімок дає
-- приріст 0 і нічого не подвоює.
--
-- День рахується за Києвом, як і решта дашборда: ліміт оновлюється
-- опівночі за київським часом.
--
-- Писати й читати можуть лише service_role (Edge Function agent):
-- RLS увімкнено без жодної політики, а функції відкриті тільки йому.
-- ------------------------------------------------------------

create table if not exists public.agent_spend (
  day        date primary key,
  cents      integer not null default 0 check (cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_sessions (
  session_id text primary key,
  owner      uuid not null,
  cents      integer not null default 0 check (cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_spend enable row level security;
alter table public.agent_sessions enable row level security;

comment on table public.agent_spend is
  'Витрати аналітика за київський день, центи за прейскурантом Anthropic (list_cost).';
comment on table public.agent_sessions is
  'Останній кумулятивний list_cost кожної сесії аналітика, центи.';

-- Записати знімок usage сесії. Повертає витрати за сьогодні після запису.
create or replace function public.agent_record_usage(p_session text, p_owner uuid, p_cents integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Europe/Kyiv')::date;
  v_prev  integer;
  v_delta integer;
  v_total integer;
begin
  insert into agent_sessions (session_id, owner)
  values (p_session, p_owner)
  on conflict (session_id) do nothing;

  -- for update: два паралельні відрізки однієї сесії не порахують приріст двічі.
  select cents into v_prev from agent_sessions where session_id = p_session for update;
  v_delta := greatest(p_cents - v_prev, 0);

  update agent_sessions
  set cents = v_prev + v_delta, updated_at = now()
  where session_id = p_session;

  insert into agent_spend (day, cents)
  values (v_day, v_delta)
  on conflict (day) do update
  set cents = agent_spend.cents + excluded.cents, updated_at = now();

  select cents into v_total from agent_spend where day = v_day;
  return v_total;
end;
$$;

-- Витрати за сьогодні (київський день), центи.
create or replace function public.agent_spent_today()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cents from public.agent_spend where day = (now() at time zone 'Europe/Kyiv')::date),
    0
  );
$$;

revoke all on function public.agent_record_usage(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.agent_spent_today() from public, anon, authenticated;
grant execute on function public.agent_record_usage(text, uuid, integer) to service_role;
grant execute on function public.agent_spent_today() to service_role;
