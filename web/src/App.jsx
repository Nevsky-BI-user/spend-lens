// Кореневий компонент: резолюція режиму даних (Supabase / local / demo),
// hash-навігація вкладками, шапка з банером демо-даних, глобальний фільтр
// (період + проєкт) — застосовується ОДИН раз тут, вкладки отримують
// уже відфільтрований снапшот.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveMode, loadLocalSnapshot, loadDemoSnapshot } from './lib/loadData.js';
import { filterSnapshot, projectsByCost, lastDay } from './lib/analytics.js';
import { fmtDateTime } from './lib/format.js';
import OverviewTab from './components/OverviewTab.jsx';
import CategoriesTab from './components/CategoriesTab.jsx';
import SessionsTab from './components/SessionsTab.jsx';
import FactorsTab from './components/FactorsTab.jsx';
import ActionsTab from './components/ActionsTab.jsx';
import LoginCard from './components/LoginCard.jsx';
import { Segmented, ProjectSelect } from './components/ui.jsx';

const TABS = [
  { id: 'overview', label: 'Огляд', component: OverviewTab },
  { id: 'categories', label: 'Категорії', component: CategoriesTab },
  { id: 'sessions', label: 'Сесії', component: SessionsTab },
  { id: 'factors', label: 'Фактори', component: FactorsTab },
  { id: 'actions', label: 'Дії', component: ActionsTab },
];

const PERIODS = [
  { value: 7, label: '7 днів' },
  { value: 30, label: '30 днів' },
  { value: 0, label: 'Увесь час' },
];

function useHashTab() {
  const read = () => {
    const id = window.location.hash.replace(/^#\/?/, '');
    return TABS.some((t) => t.id === id) ? id : 'overview';
  };
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (id) => { window.location.hash = `#${id}`; };
  return [tab, go];
}

export default function App() {
  const [mode] = useState(resolveMode);
  const [state, setState] = useState({ status: 'loading' });
  const [tab, go] = useHashTab();

  // --- глобальний фільтр: період (7/30/0=усі) + проєкт (null = усі) ---
  const [period, setPeriod] = useState(30);
  const [project, setProject] = useState(null);

  const snapshot = state.status === 'ready' ? state.snapshot : null;

  // Період + проєкт — для всіх вкладок.
  const filtered = useMemo(
    () => (snapshot ? filterSnapshot(snapshot, { period, project }) : null),
    [snapshot, period, project]
  );
  // Лише проєкт (без періоду) — для KPI-карток «Огляду» з фіксованими вікнами.
  const projectOnly = useMemo(
    () => (snapshot ? filterSnapshot(snapshot, { period: 0, project }) : null),
    [snapshot, project]
  );
  const projects = useMemo(
    () => (snapshot ? projectsByCost(snapshot.days || []) : []),
    [snapshot]
  );
  const anchorDay = useMemo(
    () => (snapshot ? lastDay(snapshot.days || []) : ''),
    [snapshot]
  );

  // --- локальний / демо-режим ---
  useEffect(() => {
    if (mode === 'supabase') return;
    const load = mode === 'demo' ? loadDemoSnapshot : loadLocalSnapshot;
    load()
      .then(({ snapshot, demo }) => setState({ status: 'ready', snapshot, demo }))
      .catch((e) => setState({ status: 'error', error: e.message }));
  }, [mode]);

  // --- Supabase-режим (динамічний імпорт, щоб не тягнути SDK у demo-збірку) ---
  const loadFromSupabase = useCallback(async (sb, session) => {
    try {
      const snapshot = await sb.fetchSnapshot();
      setState({ status: 'ready', snapshot, demo: false, email: session?.user?.email });
    } catch (e) {
      if (e.message === 'ACCESS_DENIED') {
        setState({ status: 'denied', email: session?.user?.email || '' });
      } else {
        setState({ status: 'error', error: e.message });
      }
    }
  }, []);

  useEffect(() => {
    if (mode !== 'supabase') return;
    let unsub = null;
    (async () => {
      const sb = await import('./lib/supabaseData.js');
      const supabase = sb.getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await loadFromSupabase(sb, session);
      else setState({ status: 'auth', sb });
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
        if (event === 'SIGNED_IN' && sess) loadFromSupabase(sb, sess);
        if (event === 'SIGNED_OUT') setState({ status: 'auth', sb });
      });
      unsub = () => subscription.unsubscribe();
    })().catch((e) => setState({ status: 'error', error: e.message }));
    return () => { if (unsub) unsub(); };
  }, [mode, loadFromSupabase]);

  const signOut = useCallback(async () => {
    const sb = await import('./lib/supabaseData.js');
    await sb.signOut();
  }, []);

  // --- стани без даних ---
  if (state.status === 'loading') {
    return <div className="center-note"><div className="spinner" />Завантаження даних…</div>;
  }
  if (state.status === 'error') {
    return <div className="center-note error-note">Помилка: {state.error}</div>;
  }
  if (state.status === 'auth') {
    const sb = state.sb;
    return (
      <LoginCard
        onGoogle={() => sb.signInWithGoogle()}
        onSendOtp={async (email) => { const { error } = await sb.signInWithOtp(email); if (error) throw error; }}
        onVerifyOtp={async (email, token) => { const { error } = await sb.verifyOtp(email, token); if (error) throw error; }}
      />
    );
  }
  if (state.status === 'denied') {
    return (
      <div className="center-note">
        <div className="card denied-card">
          <h2>Доступ заборонено для {state.email}</h2>
          <p className="muted-text">Цей акаунт відсутній у списку дозволених користувачів.</p>
          <button type="button" className="btn-secondary" onClick={signOut}>Вийти</button>
        </div>
      </div>
    );
  }

  const { demo, email } = state;
  const ActiveTab = TABS.find((t) => t.id === tab).component;

  return (
    <div className="app">
      {demo && (
        <div className="demo-banner">
          Демо-дані — синтетичний набір для перегляду інтерфейсу. Реальні витрати тут не показані.
        </div>
      )}

      <header className="app-header">
        <div className="app-title-row">
          <h1>spend-lens</h1>
          <div className="app-meta">
            {snapshot.generatedAt && <span>Оновлено: {fmtDateTime(snapshot.generatedAt)}</span>}
            {email && (
              <span className="user-box">
                {email}
                <button type="button" className="link-btn" onClick={signOut}>Вийти</button>
              </span>
            )}
          </div>
        </div>
        <p className="app-sub">Куди йдуть гроші в Claude Code — і що з цим робити</p>

        {(snapshot.warnings || []).length > 0 && (
          <div className="warn-banner">
            Попередження колектора: {snapshot.warnings.join('; ')}
          </div>
        )}

        <div className="tabs-row">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                className={t.id === tab ? 'active' : ''}
                onClick={() => go(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="filter-toolbar">
            <Segmented options={PERIODS} value={period} onChange={setPeriod} ariaLabel="Період" />
            <ProjectSelect projects={projects} value={project} onChange={setProject} />
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* kpiDays/anchorDay використовує лише «Огляд» (KPI з фіксованими
            вікнами поважають фільтр проєкту, але не період); решта вкладок
            ці пропси ігнорує. */}
        <ActiveTab
          snapshot={filtered}
          kpiDays={projectOnly ? projectOnly.days : []}
          anchorDay={anchorDay}
        />
      </main>

      <footer className="app-footer">
        Джерело цін: {snapshot.pricingSource === 'litellm' ? 'LiteLLM' : 'вбудована таблиця'} ·
        часовий пояс {snapshot.timezone || 'Europe/Kyiv'}
      </footer>
    </div>
  );
}
