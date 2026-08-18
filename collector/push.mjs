/**
 * spend-lens — Supabase push module (PostgREST upserts, zero npm dependencies).
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from collector/.env.
 * When .env is absent (or values are missing/placeholders) the push is skipped SILENTLY
 * (contract: local-only mode must just work).
 *
 * Tables (see supabase/migrations/001_init.sql):
 *   usage_days   PK (day, project, model, sidechain)
 *   sessions_agg PK (session_id), `day` is a generated column — not sent
 *   meta         PK (key), value jsonb
 * Upserts use `Prefer: resolution=merge-duplicates` + `on_conflict=<pk cols>`, <= 500 rows/request.
 */

import fs from 'node:fs';
import { httpsPostJson } from './http.mjs';

const BATCH = 500;

function loadEnv(envPath) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return null; // .env absent -> skip silently
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function dayRow(d) {
  return {
    day: d.day,
    project: d.project,
    model: d.model,
    sidechain: d.sidechain,
    input: d.input,
    output: d.output,
    cache_read: d.cacheRead,
    cache_write_5m: d.cacheWrite5m,
    cache_write_1h: d.cacheWrite1h,
    cost_usd: d.costUsd,
    messages: d.messages,
    sessions: d.sessions,
  };
}

function sessionRow(s) {
  return {
    session_id: s.sessionId,
    project: s.project,
    project_path: s.projectPath,
    title: s.title,
    sidechain: s.sidechain,
    started_at: s.startedAt,
    ended_at: s.endedAt,
    user_turns: s.userTurns,
    assistant_turns: s.assistantTurns,
    models: s.models,
    input: s.totals.input,
    output: s.totals.output,
    cache_read: s.totals.cacheRead,
    cache_write_5m: s.totals.cacheWrite5m,
    cache_write_1h: s.totals.cacheWrite1h,
    cost_usd: s.totals.costUsd,
    max_context: s.maxContext,
    avg_context: s.avgContext,
    cache_hit_rate: s.cacheHitRate,
  };
}

/**
 * Push snapshot aggregates to Supabase. Resolves quietly; logs a summary line on success,
 * warnings on HTTP errors. Never throws (a failed push must not fail the collect run).
 */
export async function pushToSupabase(snapshot, { envPath, verbose = false } = {}) {
  const env = loadEnv(envPath);
  if (!env) return { pushed: false, reason: 'no-env' };
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !url ||
    !key ||
    !/^https:\/\//.test(url) ||
    url.includes('YOUR-PROJECT-REF') ||
    key.includes('YOUR-SERVICE-ROLE-KEY')
  ) {
    return { pushed: false, reason: 'env-not-configured' }; // placeholders -> skip silently
  }

  const base = url.replace(/\/+$/, '');
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    prefer: 'resolution=merge-duplicates',
  };

  const upsert = async (table, onConflict, rows) => {
    let sent = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const res = await httpsPostJson(
        `${base}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
        batch,
        headers
      );
      if (res.status >= 400) {
        console.warn(`[push] ${table} batch ${i / BATCH + 1}: HTTP ${res.status} ${res.body.slice(0, 300)}`);
        return { table, sent, error: res.status };
      }
      sent += batch.length;
      if (verbose) console.log(`[push] ${table}: ${sent}/${rows.length} rows`);
    }
    return { table, sent };
  };

  try {
    const metaRows = [
      { key: 'generatedAt', value: snapshot.generatedAt },
      { key: 'pricingUsed', value: snapshot.pricingUsed },
      { key: 'pricingSource', value: snapshot.pricingSource },
      { key: 'warnings', value: snapshot.warnings },
      { key: 'timezone', value: snapshot.timezone },
      { key: 'schemaVersion', value: snapshot.schemaVersion },
    ];
    const r1 = await upsert('usage_days', 'day,project,model,sidechain', snapshot.days.map(dayRow));
    const r2 = await upsert('sessions_agg', 'session_id', snapshot.sessions.map(sessionRow));
    const r3 = await upsert('meta', 'key', metaRows);
    const ok = !r1.error && !r2.error && !r3.error;
    console.log(
      `[push] ${ok ? 'ok' : 'PARTIAL'} — usage_days: ${r1.sent}, sessions_agg: ${r2.sent}, meta: ${r3.sent}`
    );
    return { pushed: true, ok, usage_days: r1.sent, sessions_agg: r2.sent, meta: r3.sent };
  } catch (e) {
    console.warn(`[push] failed: ${e.message || e}`);
    return { pushed: false, reason: 'error', error: String(e && e.message || e) };
  }
}
