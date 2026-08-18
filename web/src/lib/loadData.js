// Резолюція режиму даних (див. CONTRACT.md):
//   VITE_SUPABASE_URL задано → 'supabase' (потрібна авторизація)
//   ?demo=1 → 'demo' (примусово)
//   інакше → 'local': data/usage.json, на 404 → data/demo.json + банер.

export function resolveMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1') return 'demo';
  if (import.meta.env.VITE_SUPABASE_URL) return 'supabase';
  return 'local';
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return null; // dev-сервер може віддати index.html
  return res.json();
}

/** Локальний режим: usage.json → fallback demo.json. Повертає { snapshot, demo }. */
export async function loadLocalSnapshot() {
  const base = import.meta.env.BASE_URL || '/';
  const usage = await fetchJson(base + 'data/usage.json').catch(() => null);
  if (usage) return { snapshot: usage, demo: false };
  const demo = await fetchJson(base + 'data/demo.json').catch(() => null);
  if (demo) return { snapshot: demo, demo: true };
  throw new Error('Не вдалося завантажити дані (usage.json / demo.json).');
}

/** Примусовий демо-режим. */
export async function loadDemoSnapshot() {
  const base = import.meta.env.BASE_URL || '/';
  const demo = await fetchJson(base + 'data/demo.json').catch(() => null);
  if (demo) return { snapshot: demo, demo: true };
  throw new Error('Не вдалося завантажити демо-дані.');
}
