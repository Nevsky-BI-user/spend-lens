/**
 * spend-lens — Supabase push module (PostgREST upserts, zero npm dependencies).
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from collector/.env.
 * When .env is absent (or values are missing/placeholders) the push is skipped SILENTLY
 * (contract: local-only mode must just work).
 *
 * Tables (see supabase/migrations/001_init.sql, 002_digests.sql):
 *   usage_days   PK (day, project, model, sidechain)
 *   sessions_agg PK (session_id), `day` is a generated column — not sent;
 *                `digest` jsonb added by 002
 *   projects_agg PK (project) — added by 002
 *   meta         PK (key), value jsonb — включно з рядками 'rtk' (v1.9) і 'toolOutput' (v1.10)
 *                та 'appGroups' / 'appSessions' / 'appUngrouped' (v1.12)
 * Upserts use `Prefer: resolution=merge-duplicates` + `on_conflict=<pk cols>`, <= 500 rows/request.
 *
 * Forward/backward safety: when 002_digests.sql has not been applied yet the digest
 * column and projects_agg simply do not exist. Rather than failing the whole push, the
 * sessions_agg upsert is retried without `digest` and projects_agg is skipped — both
 * with a loud one-line hint naming the migration.
 */

import fs from 'node:fs';
import { httpsDelete, httpsPostJson } from './http.mjs';

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
    digest: s.digest || null,
  };
}

function projectRow(p) {
  return {
    project: p.project,
    sessions: p.sessions,
    sidechain_sessions: p.sidechainSessions,
    cost_usd: p.costUsd,
    first_day: p.firstDay,
    last_day: p.lastDay,
    models: p.models,
    areas: p.areas,
    activities: p.activities,
    titles: p.titles,
    note: p.note,
  };
}

/**
 * Рядки таблиці meta (PK key, value jsonb). Винесено окремо, щоб побудову можна було
 * перевірити без мережевого виклику.
 */
export function buildMetaRows(snapshot, { withApp = true } = {}) {
  const rows = [
    { key: 'generatedAt', value: snapshot.generatedAt },
    { key: 'pricingUsed', value: snapshot.pricingUsed },
    { key: 'pricingSource', value: snapshot.pricingSource },
    { key: 'warnings', value: snapshot.warnings },
    { key: 'timezone', value: snapshot.timezone },
    { key: 'schemaVersion', value: snapshot.schemaVersion },
    // v1.9: статистика RTK живе в meta (окремої таблиці контракт не заводить).
    // Пишемо навіть null, інакше після дня без rtk у БД лишалися б застарілі
    // цифри, і сайт показував би картку, якої вже немає в снапшоті.
    { key: 'rtk', value: snapshot.rtk ?? null },
    // v1.10: денний зріз виводу інструментів. Теж у meta: окремої таблиці
    // контракт не заводить, а рядків тут менше, ніж днів × 13.
    { key: 'toolOutput', value: snapshot.toolOutput ?? null },
  ];
  // v1.12: групи бокової панелі й сесії десктопного застосунку. Теж у meta, без
  // міграції; null (застосунок не прочитано) пишемо явно, як і для rtk, щоб у БД не
  // лишались застарілі дані. Прогін з --no-app ці рядки не чіпає зовсім: він свідомо
  // не читав застосунок і не має права затирати те, що зібрав попередній прогін.
  if (withApp) {
    rows.push(
      { key: 'appGroups', value: snapshot.appGroups ?? null },
      { key: 'appSessions', value: snapshot.appSessions ?? null },
      { key: 'appUngrouped', value: snapshot.appUngrouped ?? null },
    );
  }
  return rows;
}

/**
 * Push snapshot aggregates to Supabase. Resolves quietly; logs a summary line on success,
 * warnings on HTTP errors. Never throws (a failed push must not fail the collect run).
 */
export async function pushToSupabase(snapshot, { envPath, verbose = false, withApp = true } = {}) {
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
        return { table, sent, error: res.status, body: String(res.body || '') };
      }
      sent += batch.length;
      if (verbose) console.log(`[push] ${table}: ${sent}/${rows.length} rows`);
    }
    return { table, sent };
  };

  const warnErr = (r) => console.warn(`[push] ${r.table}: HTTP ${r.error} ${r.body.slice(0, 300)}`);
  // PostgREST: PGRST204 = column not in schema cache, PGRST205 = table not found
  const missingColumn = (r) => /PGRST204/.test(r.body) || /column .*digest.* does not exist/i.test(r.body);
  const missingTable = (r) => r.error === 404 || /PGRST205/.test(r.body);

  try {
    const metaRows = buildMetaRows(snapshot, { withApp });

    const r1 = await upsert('usage_days', 'day,project,model,sidechain', snapshot.days.map(dayRow));
    if (r1.error) warnErr(r1);

    let r2 = await upsert('sessions_agg', 'session_id', snapshot.sessions.map(sessionRow));
    if (r2.error && missingColumn(r2)) {
      console.warn('[push] sessions_agg has no `digest` column — apply supabase/migrations/002_digests.sql; retrying without digests');
      const legacy = snapshot.sessions.map((s) => {
        const row = sessionRow(s);
        delete row.digest;
        return row;
      });
      r2 = await upsert('sessions_agg', 'session_id', legacy);
      if (!r2.error) r2.degraded = 'no-digest';
    }
    if (r2.error) warnErr(r2);

    const projects = snapshot.projects || [];
    let r3 = { table: 'projects_agg', sent: 0 };
    if (projects.length) {
      r3 = await upsert('projects_agg', 'project', projects.map(projectRow));
      if (r3.error && missingTable(r3)) {
        console.warn('[push] table projects_agg is missing — apply supabase/migrations/002_digests.sql; skipping');
        r3 = { table: 'projects_agg', sent: 0, skipped: true };
      } else if (r3.error) {
        warnErr(r3);
      }
    }

    // meta.value is NOT NULL, and PostgREST turns a JSON null into SQL NULL: one null
    // (rtk unavailable, app not read) used to fail the whole meta upsert. A null now
    // deletes its row instead, so stale values still go away and the rest is written.
    const nullKeys = metaRows.filter((r) => r.value === null || r.value === undefined).map((r) => r.key);
    const r4 = await upsert('meta', 'key', metaRows.filter((r) => !nullKeys.includes(r.key)));
    if (r4.error) warnErr(r4);
    if (nullKeys.length && !r4.error) {
      const filter = `key=in.(${nullKeys.map((k) => `"${k}"`).join(',')})`;
      const del = await httpsDelete(`${base}/rest/v1/meta?${encodeURI(filter)}`, headers);
      if (del.status >= 400) {
        r4.error = del.status;
        r4.body = String(del.body || '');
        warnErr(r4);
      } else if (verbose) {
        console.log(`[push] meta: cleared ${nullKeys.join(', ')}`);
      }
    }

    const ok = !r1.error && !r2.error && !r3.error && !r4.error;
    console.log(
      `[push] ${ok ? 'ok' : 'PARTIAL'} — usage_days: ${r1.sent}, sessions_agg: ${r2.sent}${
        r2.degraded ? ' (no digest)' : ''
      }, projects_agg: ${r3.sent}${r3.skipped ? ' (skipped)' : ''}, meta: ${r4.sent}`
    );
    return {
      pushed: true,
      ok,
      usage_days: r1.sent,
      sessions_agg: r2.sent,
      projects_agg: r3.sent,
      meta: r4.sent,
    };
  } catch (e) {
    console.warn(`[push] failed: ${e.message || e}`);
    return { pushed: false, reason: 'error', error: String((e && e.message) || e) };
  }
}
