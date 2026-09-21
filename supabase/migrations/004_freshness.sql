-- ============================================================
-- spend-lens — Supabase schema, migration 004_freshness
-- Публічна функція свіжості даних для зовнішнього вартового.
-- Ідемпотентна: можна виконувати повторно через SQL Editor.
-- Запускати ПІСЛЯ 001_init.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Навіщо окрема функція, а не select із meta.
-- Уся схема закрита RLS: читати meta може лише автентифікований користувач
-- з allowed_users. Вартовому в GitHub Actions входити нема під ким, а класти
-- service_role-ключ у CI заради однієї позначки часу — надмірна плата.
-- SECURITY DEFINER віддає рівно одне значення: коли колектор останній раз
-- заливав дані. Ні сум, ні проєктів, ні сесій крізь неї не видно.
--
-- meta.value має тип jsonb, тому рядок дістається через #>> '{}': value::text
-- дав би лапки разом зі значенням і ::timestamptz на ньому впав би.
-- ------------------------------------------------------------
create or replace function public.data_freshness()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select (value #>> '{}')::timestamptz
  from public.meta
  where key = 'generatedAt';
$$;

-- Явно звужуємо права: created-by-default execute для public знімається,
-- лишається тільки те, що потрібне вартовому (anon) і застосунку.
revoke all on function public.data_freshness() from public;
grant execute on function public.data_freshness() to anon, authenticated;

comment on function public.data_freshness() is
  'Час останнього успішного пушу колектора. Відкрита для anon навмисно: '
  'єдиний споживач — вартовий свіжості в GitHub Actions.';
