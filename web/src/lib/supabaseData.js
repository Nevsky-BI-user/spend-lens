// Режим Supabase: авторизація і читання агрегатів у форму снапшота (schemaVersion 1).
// Модуль завантажується динамічно лише коли задано VITE_SUPABASE_URL.

import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabase() {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  }
  return client;
}

export async function signInWithGoogle() {
  const supabase = getSupabase();
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
}

export async function signInWithOtp(email) {
  const supabase = getSupabase();
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
}

export async function verifyOtp(email, token) {
  const supabase = getSupabase();
  return supabase.auth.verifyOtp({ email, token, type: 'email' });
}

export async function signOut() {
  return getSupabase().auth.signOut();
}

// Ключі рядків БД можуть бути snake_case — нормалізуємо до форми снапшота.
const pick = (row, camel, snake) => row[camel] ?? row[snake] ?? 0;

function mapDay(row) {
  return {
    day: row.day,
    project: row.project,
    model: row.model,
    sidechain: !!row.sidechain,
    input: pick(row, 'input', 'input_tokens') || row.input || 0,
    output: pick(row, 'output', 'output_tokens') || row.output || 0,
    cacheRead: pick(row, 'cacheRead', 'cache_read'),
    cacheWrite5m: pick(row, 'cacheWrite5m', 'cache_write_5m'),
    cacheWrite1h: pick(row, 'cacheWrite1h', 'cache_write_1h'),
    costUsd: pick(row, 'costUsd', 'cost_usd'),
    messages: pick(row, 'messages', 'messages'),
    sessions: pick(row, 'sessions', 'sessions'),
  };
}

function mapSession(row) {
  return {
    sessionId: row.sessionId ?? row.session_id,
    project: row.project,
    projectPath: row.projectPath ?? row.project_path ?? '',
    title: row.title ?? '',
    sidechain: !!row.sidechain,
    startedAt: row.startedAt ?? row.started_at,
    endedAt: row.endedAt ?? row.ended_at,
    userTurns: pick(row, 'userTurns', 'user_turns'),
    assistantTurns: pick(row, 'assistantTurns', 'assistant_turns'),
    models: row.models || {},
    totals: row.totals || {
      input: pick(row, 'input', 'input'),
      output: pick(row, 'output', 'output'),
      cacheRead: pick(row, 'cacheRead', 'cache_read'),
      cacheWrite5m: pick(row, 'cacheWrite5m', 'cache_write_5m'),
      cacheWrite1h: pick(row, 'cacheWrite1h', 'cache_write_1h'),
      costUsd: pick(row, 'costUsd', 'cost_usd'),
    },
    maxContext: pick(row, 'maxContext', 'max_context'),
    avgContext: pick(row, 'avgContext', 'avg_context'),
    cacheHitRate: pick(row, 'cacheHitRate', 'cache_hit_rate'),
  };
}

/**
 * Читає всі рядки таблиці посторінково (range по 1000) — PostgREST обрізає
 * відповідь налаштуванням "Max rows" (типово 1000), тож .limit(20000) не працює.
 * orderCols роблять пагінацію детермінованою (без order сторінки можуть плисти).
 */
async function fetchAll(supabase, table, orderCols) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*').range(from, from + PAGE - 1);
    for (const c of orderCols) q = q.order(c, { ascending: true });
    const res = await q;
    if (res.error) return res;
    rows.push(...(res.data || []));
    if (!res.data || res.data.length < PAGE) break;
  }
  return { data: rows, error: null };
}

/**
 * Читає usage_days / sessions_agg / meta і збирає снапшот.
 * Кидає Error('ACCESS_DENIED'), якщо користувача немає в allowlist.
 * RLS не повертає помилку для SELECT — просто фільтрує рядки, тому доступ
 * перевіряємо явно: політика self-row на allowed_users віддає рядок лише
 * allowlist-користувачу (інакше — порожньо).
 */
export async function fetchSnapshot() {
  const supabase = getSupabase();

  const allowRes = await supabase.from('allowed_users').select('email').limit(1);
  if (!allowRes.error && (allowRes.data || []).length === 0) {
    throw new Error('ACCESS_DENIED');
  }

  const [daysRes, sessRes, metaRes] = await Promise.all([
    fetchAll(supabase, 'usage_days', ['day', 'project', 'model', 'sidechain']),
    fetchAll(supabase, 'sessions_agg', ['session_id']),
    supabase.from('meta').select('*'),
  ]);

  const denied = [allowRes, daysRes, sessRes, metaRes].find(
    (r) => r.error && /permission|denied|rls|policy/i.test(r.error.message || '')
  );
  if (denied) throw new Error('ACCESS_DENIED');
  const err = [daysRes, sessRes, metaRes].find((r) => r.error);
  if (err) throw new Error(err.error.message);

  const meta = {};
  for (const row of metaRes.data || []) meta[row.key] = row.value;

  return {
    schemaVersion: 1,
    generatedAt: meta.generatedAt || null,
    timezone: meta.timezone || 'Europe/Kyiv',
    pricingSource: meta.pricingSource || 'fallback',
    pricingUsed: meta.pricingUsed || {},
    warnings: meta.warnings || [],
    days: (daysRes.data || []).map(mapDay),
    sessions: (sessRes.data || []).map(mapSession),
  };
}
