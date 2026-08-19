// Режим Supabase: авторизація і читання агрегатів у форму снапшота.
// Модуль завантажується динамічно лише коли задано VITE_SUPABASE_URL.
//
// v1.7: колектор пише дайджести (sessions_agg.digest) і projects_agg
// (міграція 002_digests.sql). Читач мусить їх піднімати, інакше вкладка
// «Проєкти», рядок-дайджест у «Сесіях», дровер, XLSX і PDF лишаються
// порожніми саме в тому режимі, у якому працює опублікований сайт.
// Зворотна сумісність: якщо міграцію ще не застосовано, projects_agg просто
// немає — тоді снапшот лишається schemaVersion 1 і весь новий UI мовчки
// вимикається (hasDigestData() === false), а не падає.

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
    // jsonb приходить уже в camelCase — колектор кладе digest як є.
    // null (рядок до v1.7 або без міграції) НЕ перетворюємо на {}: порожній
    // об'єкт увімкнув би блоки «Що відбувалося» без жодного вмісту.
    digest: row.digest || null,
  };
}

/** Рядок projects_agg → елемент снапшотного projects[] (див. CONTRACT v1.7a). */
function mapProject(row) {
  return {
    project: row.project,
    sessions: pick(row, 'sessions', 'sessions'),
    sidechainSessions: pick(row, 'sidechainSessions', 'sidechain_sessions'),
    costUsd: pick(row, 'costUsd', 'cost_usd'),
    firstDay: row.firstDay ?? row.first_day ?? null,
    lastDay: row.lastDay ?? row.last_day ?? null,
    models: row.models || [],
    areas: row.areas || [],
    activities: row.activities || [],
    titles: row.titles || [],
    note: row.note ?? null,
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

  const [daysRes, sessRes, projRes, metaRes] = await Promise.all([
    fetchAll(supabase, 'usage_days', ['day', 'project', 'model', 'sidechain']),
    fetchAll(supabase, 'sessions_agg', ['session_id']),
    fetchAll(supabase, 'projects_agg', ['project']),
    supabase.from('meta').select('*'),
  ]);

  // projRes навмисно поза перевіркою доступу: «permission denied for table
  // projects_agg» (таблиця є, GRANT забули) — це проблема міграції, а не
  // відсутність користувача в allowlist; вона не мусить вибивати логін.
  const denied = [allowRes, daysRes, sessRes, metaRes].find(
    (r) => r.error && /permission|denied|rls|policy/i.test(r.error.message || '')
  );
  if (denied) throw new Error('ACCESS_DENIED');
  const err = [daysRes, sessRes, metaRes].find((r) => r.error);
  if (err) throw new Error(err.error.message);

  const meta = {};
  for (const row of metaRes.data || []) meta[row.key] = row.value;

  // projects_agg — таблиця з міграції 002. Поки її не застосували, PostgREST
  // віддає 404/PGRST205; це не привід валити весь дашборд, тому помилку
  // ковтаємо і йдемо далі з порожнім projects[] (снапшот залишиться v1).
  const projects = projRes.error ? [] : (projRes.data || []).map(mapProject);
  const sessions = (sessRes.data || []).map(mapSession);

  // Версію бере з meta (колектор пише schemaVersion туди), але не сліпо:
  // якщо колонки digest ще немає, дані de-facto v1 — і UI має це бачити.
  const hasDigests = projects.length > 0 || sessions.some((s) => s.digest);
  const declared = Number(meta.schemaVersion);
  const schemaVersion = hasDigests
    ? (Number.isFinite(declared) && declared >= 2 ? declared : 2)
    : 1;

  return {
    schemaVersion,
    generatedAt: meta.generatedAt || null,
    timezone: meta.timezone || 'Europe/Kyiv',
    pricingSource: meta.pricingSource || 'fallback',
    pricingUsed: meta.pricingUsed || {},
    warnings: meta.warnings || [],
    days: (daysRes.data || []).map(mapDay),
    sessions,
    projects,
  };
}
