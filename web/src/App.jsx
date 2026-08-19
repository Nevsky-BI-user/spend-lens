// Кореневий компонент: резолюція режиму даних (Supabase / local / demo),
// стан у query-рядку (вкладка + фільтри, v1.6), шапка з банером демо-даних,
// глобальний фільтр (період + проєкт + день) — застосовується ОДИН раз тут,
// вкладки отримують уже відфільтрований снапшот.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveMode, loadLocalSnapshot, loadDemoSnapshot } from './lib/loadData.js';
import {
  filterSnapshot, projectsByCost, lastDay, cumulativeMonthCompare,
} from './lib/analytics.js';
import { detectAnomalies } from './lib/anomalies.js';
import { parseUrlState, writeUrlState, writeStoredBudget } from './lib/urlState.js';
import { exportSnapshotXlsx } from './lib/xlsxExport.js';
import { fmtDateTime, fmtDomMonth } from './lib/format.js';
import OverviewTab from './components/OverviewTab.jsx';
import CategoriesTab from './components/CategoriesTab.jsx';
import SessionsTab from './components/SessionsTab.jsx';
import FactorsTab from './components/FactorsTab.jsx';
import ActionsTab from './components/ActionsTab.jsx';
import LoginCard from './components/LoginCard.jsx';
import PrintReport from './print/PrintReport.jsx';
import { Segmented, ProjectSelect, DayChip, ExportButton } from './components/ui.jsx';

const TABS = [
  { id: 'overview', label: 'Огляд', component: OverviewTab },
  { id: 'categories', label: 'Категорії', component: CategoriesTab },
  { id: 'sessions', label: 'Сесії', component: SessionsTab },
  { id: 'factors', label: 'Фактори', component: FactorsTab },
  { id: 'actions', label: 'Дії', component: ActionsTab },
];

const PERIODS = [
  { value: 1, label: 'Сьогодні' },
  { value: 7, label: '7 днів' },
  { value: 30, label: '30 днів' },
  { value: 0, label: 'Увесь час' },
];

const DEFAULT_TAB = 'overview';
const DEFAULT_PERIOD = 30;

// Одна константа на весь модуль: parse/write мають бачити однакові дефолти,
// інакше «30 днів» то зникає з URL, то з'являється.
const URL_OPTS = {
  tabIds: TABS.map((t) => t.id),
  periodValues: PERIODS.map((p) => p.value),
  defaultTab: DEFAULT_TAB,
  defaultPeriod: DEFAULT_PERIOD,
};

/** '2026-08-18' → '18 серпня' (підпис чіпа дня). */
function dayLabel(day) {
  return fmtDomMonth(Number(day.slice(8, 10)), day);
}

/**
 * Стан застосунку в URL (CONTRACT v1.6 §6). Джерело істини — history:
 *  - pushState для вкладки й дня (щоб «назад» скасовував дрил-даун);
 *  - replaceState для дрібних правок фільтра;
 *  - popstate/hashchange повертають стан назад у React.
 * ref-дзеркало потрібне, бо історію не можна чіпати всередині оновлювача
 * useState: у StrictMode він викликається двічі і в стек лягли б два записи.
 */
function useUrlState() {
  const [state, setState] = useState(() => parseUrlState({
    search: window.location.search, hash: window.location.hash, ...URL_OPTS,
  }));
  const ref = useRef(state);

  // Нормалізація адреси на старті: '#sessions' → '?tab=sessions',
  // бюджет із localStorage стає частиною посилання, яким можна поділитися.
  useEffect(() => {
    writeUrlState(ref.current, { push: false, ...URL_OPTS });
  }, []);

  useEffect(() => {
    const hashTab = () => {
      const id = window.location.hash.replace(/^#\/?/, '');
      return URL_OPTS.tabIds.includes(id) ? id : null;
    };
    // #hash лишається псевдонімом вкладки: перехід за старим посиланням
    // перемикає вкладку, а адресу ми одразу нормалізуємо в ?tab=.
    // ВАЖЛИВО: Chrome на переході за фрагментом шле popstate ПЕРЕД hashchange,
    // тож нормалізація живе в popstate — інакше вона ніколи не спрацьовує
    // (hashchange приходить другим і бачить уже потрібну вкладку).
    const onPop = () => {
      const parsed = parseUrlState({
        search: window.location.search, hash: window.location.hash, ...URL_OPTS,
      });
      // Перехід за фрагментом — свіжіший намір, ніж старий ?tab= в адресі,
      // тож валідний #hash перемагає; після нормалізації фрагмента не лишиться.
      const alias = hashTab();
      const next = alias ? { ...parsed, tab: alias } : parsed;
      ref.current = next;
      setState(next);
      if (alias) writeUrlState(next, { push: false, ...URL_OPTS });
    };
    // Запасний шлях для браузерів, де hashchange приходить першим (або сам).
    const onHash = () => {
      const id = hashTab();
      if (!id) return;
      const next = { ...ref.current, tab: id };
      ref.current = next;
      setState(next);
      writeUrlState(next, { push: false, ...URL_OPTS });
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const apply = useCallback((patch, push = false) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    writeUrlState(next, { push, ...URL_OPTS });
    setState(next);
  }, []);

  return [state, apply];
}

/**
 * Друкований режим v1.3 (?print=daily|monthly|yearly&date=YYYY-MM-DD) —
 * перевіряється ДО стану в URL і авторизації: PDF-пайплайн (report/)
 * рендерить сайт без Supabase, тулбарів і вкладок. location.search
 * незмінний протягом життя сторінки, тож раннє повернення стабільне.
 * v1.6: ?budget= пробрасується у звіт (картка бюджету в PDF).
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const printType = params.get('print');
  if (printType === 'daily' || printType === 'monthly' || printType === 'yearly') {
    return (
      <PrintReport
        type={printType}
        date={params.get('date') || ''}
        budget={params.get('budget') || ''}
      />
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const [mode] = useState(resolveMode);
  const [state, setState] = useState({ status: 'loading' });
  const [ui, apply] = useUrlState();
  const { tab, period, project, day, budget } = ui;

  const setTab = useCallback((id) => apply({ tab: id }, true), [apply]);
  const setPeriod = useCallback((p) => apply({ period: p, day: null }), [apply]);
  const setProject = useCallback((p) => apply({ project: p }), [apply]);
  // Дрил-даун: день + перехід на «Сесії» одним записом історії — «назад»
  // повертає рівно туди, звідки клікнули.
  const selectDay = useCallback((d) => apply({ day: d, tab: 'sessions' }, true), [apply]);
  const clearDay = useCallback(() => apply({ day: null }, true), [apply]);
  const setBudget = useCallback((v) => {
    writeStoredBudget(v);
    apply({ budget: v });
  }, [apply]);

  const snapshot = state.status === 'ready' ? state.snapshot : null;

  // Період + проєкт + день — для всіх вкладок (day перевизначає period).
  const filtered = useMemo(
    () => (snapshot ? filterSnapshot(snapshot, { period, project, day }) : null),
    [snapshot, period, project, day]
  );
  // Лише проєкт (без періоду й дня) — для KPI-карток «Огляду» з фіксованими
  // вікнами, місячної картки, бюджету й детекції аномалій (їм потрібна історія).
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
  // Аномалії рахуємо на ПОВНІЙ історії проєкту: ковзне вікно 30 днів і медіана
  // сесій проєкту вимагають бази, якої у вузькому зрізі просто немає.
  const anomalies = useMemo(
    () => (projectOnly ? detectAnomalies(projectOnly) : null),
    [projectOnly]
  );
  const monthCmp = useMemo(
    () => (projectOnly ? cumulativeMonthCompare(projectOnly.days, anchorDay) : null),
    [projectOnly, anchorDay]
  );

  // Проєкт із чужого посилання може не існувати в цьому снапшоті — тихо
  // скидаємо фільтр, інакше користувач дивиться на порожній дашборд.
  useEffect(() => {
    if (!snapshot || !project) return;
    if (!projects.includes(project)) apply({ project: null });
  }, [snapshot, projects, project, apply]);

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

  // --- експорт XLSX поточного зрізу (exceljs — ліниво, окремим чанком) ---
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const doExport = useCallback(async () => {
    if (!filtered) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await exportSnapshotXlsx(filtered, {
        project,
        period,
        day,
        budgetUsd: budget,
        forecastTotal: monthCmp ? monthCmp.forecastTotal : null,
        // Ті самі аномалії, що й у таблиці «Сесій»: рахувати їх ще раз на
        // вузькому зрізі означало б віддати файл, де чіпа «Аномалія» немає,
        // хоча на екрані він є (медіана проєкту й guard ≥8 точок на зрізі інші).
        sessionAnomalies: anomalies ? anomalies.sessions : null,
      });
    } catch (e) {
      setExportError(e.message || 'не вдалося зібрати файл');
    } finally {
      setExportBusy(false);
    }
  }, [filtered, project, period, day, budget, monthCmp, anomalies]);

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
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="filter-toolbar">
            {/* Вибір періоду знімає дрил-даун за днем: день перевизначає
                період, і лишати обидва означало б показувати не той зріз,
                який підсвічено в тулбарі. */}
            <Segmented
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              ariaLabel="Період"
            />
            <ProjectSelect projects={projects} value={project} onChange={setProject} />
            {day && <DayChip label={dayLabel(day)} onClear={clearDay} />}
            <ExportButton busy={exportBusy} onClick={doExport} error={exportError} />
          </div>
        </div>
        {exportError && (
          <p className="toolbar-error">Не вдалося створити XLSX: {exportError}</p>
        )}
      </header>

      <main className="app-main">
        {/* kpiDays, anchorDay, period, project, budget і обробники кліків
            використовує переважно «Огляд»; «Сесії» беруть anomalies для чіпа
            «Аномалія» — решта вкладок зайві пропси ігнорує. */}
        <ActiveTab
          snapshot={filtered}
          kpiDays={projectOnly ? projectOnly.days : []}
          anchorDay={anchorDay}
          period={period}
          project={project}
          day={day}
          anomalies={anomalies}
          budgetUsd={budget}
          onBudgetChange={setBudget}
          onSelectProject={setProject}
          onSelectDay={selectDay}
        />
      </main>

      <footer className="app-footer">
        Джерело цін: {snapshot.pricingSource === 'litellm' ? 'LiteLLM' : 'вбудована таблиця'} ·
        часовий пояс {snapshot.timezone || 'Europe/Kyiv'}
      </footer>
    </div>
  );
}
