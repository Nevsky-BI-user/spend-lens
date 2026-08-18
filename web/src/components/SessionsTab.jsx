// Вкладка «Сесії»: таблиця із сортованими колонками (типово $ ↓),
// клік по рядку → дровер із міксом моделей, метриками, прапорцями
// та рекомендаціями сесії.

import React, { useEffect, useMemo, useState } from 'react';
import { analyzeSessions, sessionRecommendations } from '../lib/analytics.js';
import {
  fmtUsd, fmtTokens, fmtPct, fmtDateTime, fmtInt, shortModel,
} from '../lib/format.js';
import { FLAG_META } from '../lib/rules.js';
import { Card, FlagChip, CopyButton, EmptyState } from './ui.jsx';

function ModelMix({ models }) {
  const rows = Object.entries(models || {}).sort((a, b) => (b[1].costUsd || 0) - (a[1].costUsd || 0));
  return (
    <table className="mix-table">
      <thead>
        <tr><th>Модель</th><th>Вхід</th><th>Вихід</th><th>Кеш-читання</th><th>$</th></tr>
      </thead>
      <tbody>
        {rows.map(([model, m]) => (
          <tr key={model}>
            <td>{shortModel(model)}</td>
            <td>{fmtTokens(m.input)}</td>
            <td>{fmtTokens(m.output)}</td>
            <td>{fmtTokens(m.cacheRead)}</td>
            <td>{fmtUsd(m.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Drawer({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;
  const { session: s, flags } = item;
  const recs = sessionRecommendations(s, flags);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Деталі сесії">
        <header className="drawer-head">
          <div>
            <h3>{s.title || s.sessionId}</h3>
            <p className="drawer-sub">
              {s.project}{s.sidechain ? ' · сабчейн' : ''} · {fmtDateTime(s.startedAt)}
            </p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Закрити">✕</button>
        </header>

        <div className="metric-grid">
          <div><span>Вартість</span><strong>{fmtUsd(s.totals?.costUsd)}</strong></div>
          <div><span>Ходи (користувач / асистент)</span><strong>{fmtInt(s.userTurns)} / {fmtInt(s.assistantTurns)}</strong></div>
          <div><span>Кеш-хіт</span><strong>{fmtPct((s.cacheHitRate || 0) * 100)}</strong></div>
          <div><span>Контекст сер. / макс.</span><strong>{fmtTokens(s.avgContext)} / {fmtTokens(s.maxContext)}</strong></div>
        </div>

        <h4 className="drawer-section">Мікс моделей</h4>
        <ModelMix models={s.models} />

        <h4 className="drawer-section">Прапорці</h4>
        {flags.length ? (
          <div className="chip-row">
            {flags.map((f) => <FlagChip key={f.type} type={f.type} wasteUsd={f.wasteUsd} />)}
          </div>
        ) : (
          <p className="muted-text">Прапорців немає — сесія виглядає здоровою.</p>
        )}
        {flags.map((f) => (
          <p className="muted-text" key={`ev-${f.type}`}>
            <strong>{FLAG_META[f.type]?.label || f.type}:</strong> {f.evidence}
          </p>
        ))}

        {recs.length > 0 && (
          <>
            <h4 className="drawer-section">Рекомендації</h4>
            {recs.map((r, i) => (
              <div className="prompt-box" key={i}>
                <p>{r.prompt}</p>
                <CopyButton text={r.prompt} />
              </div>
            ))}
          </>
        )}
      </aside>
    </>
  );
}

// Колонки таблиці. Ключі сортування — за CONTRACT v1.1:
// Назва/Проєкт — алфавіт, Коли — startedAt, Токени — in+out+cacheRead,
// Кеш-хіт, Контекст (avgContext), $, Прапорці — кількість. «Моделі» не сортуються.
const COLUMNS = [
  { key: 'title', label: 'Назва', sortable: true, alpha: true },
  { key: 'project', label: 'Проєкт', sortable: true, alpha: true },
  { key: 'when', label: 'Коли', sortable: true },
  { key: 'models', label: 'Моделі', sortable: false },
  { key: 'tokens', label: 'Токени (вх / вих / кеш)', sortable: true },
  { key: 'cache', label: 'Кеш-хіт', sortable: true },
  { key: 'context', label: 'Контекст', sortable: true },
  { key: 'cost', label: '$', sortable: true },
  { key: 'flags', label: 'Прапорці', sortable: true },
];

const SORT_GET = {
  title: (it) => (it.session.title || it.session.sessionId || '').toLowerCase(),
  project: (it) => (it.session.project || '').toLowerCase(),
  when: (it) => it.session.startedAt || '',
  tokens: (it) => {
    const t = it.session.totals || {};
    return (t.input || 0) + (t.output || 0) + (t.cacheRead || 0);
  },
  cache: (it) => it.session.cacheHitRate || 0,
  context: (it) => it.session.avgContext || 0,
  cost: (it) => (it.session.totals && it.session.totals.costUsd) || 0,
  flags: (it) => (it.flags || []).length,
};

export default function SessionsTab({ snapshot }) {
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState({ key: 'cost', dir: 'desc' }); // типово $ ↓
  const { flagged } = useMemo(() => analyzeSessions(snapshot), [snapshot]);

  const onSort = (key, alpha) => {
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: alpha ? 'asc' : 'desc' })); // нова колонка: алфавіт ↑, числа ↓
  };

  const rows = useMemo(() => {
    const get = SORT_GET[sort.key] || SORT_GET.cost;
    const mult = sort.dir === 'asc' ? 1 : -1;
    return [...flagged].sort((a, b) => {
      const va = get(a), vb = get(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'uk') : va - vb;
      return cmp * mult;
    });
  }, [flagged, sort]);

  if (!rows.length) return <EmptyState text="Немає сесій за вибраний період чи проєкт." />;

  return (
    <Card className="table-card">
      <div className="table-scroll">
        <table className="sessions-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.sortable ? `sortable${sort.key === c.key ? ' sorted' : ''}` : ''}
                  onClick={c.sortable ? () => onSort(c.key, c.alpha) : undefined}
                  onKeyDown={c.sortable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSort(c.key, c.alpha);
                    }
                  } : undefined}
                  tabIndex={c.sortable ? 0 : undefined}
                  title={c.sortable ? `Сортувати за: ${c.label}` : undefined}
                  aria-sort={
                    sort.key === c.key
                      ? (sort.dir === 'asc' ? 'ascending' : 'descending')
                      : undefined
                  }
                >
                  {c.label}
                  {c.sortable && sort.key === c.key && (
                    <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const s = item.session;
              const t = s.totals || {};
              return (
                <tr key={s.sessionId} onClick={() => setSelected(item)}>
                  <td className="cell-title">
                    {s.title || s.sessionId}
                    {s.sidechain && <span className="side-badge">сабчейн</span>}
                  </td>
                  <td>{s.project}</td>
                  <td className="cell-when">{fmtDateTime(s.startedAt)}</td>
                  <td>
                    {Object.entries(s.models || {})
                      .filter(([, m]) => (m.costUsd || 0) > 0) // ховаємо нульові (`<synthetic>`)
                      .map(([model]) => shortModel(model))
                      .join(', ')}
                  </td>
                  <td className="cell-num">{fmtTokens(t.input)} / {fmtTokens(t.output)} / {fmtTokens(t.cacheRead)}</td>
                  <td className="cell-num">{fmtPct((s.cacheHitRate || 0) * 100)}</td>
                  <td className="cell-num">{fmtTokens(s.avgContext)}</td>
                  <td className="cell-num cell-cost">{fmtUsd(t.costUsd)}</td>
                  <td className="cell-flags">
                    <div className="chip-row">
                      {item.flags.map((f) => <FlagChip key={f.type} type={f.type} />)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Drawer item={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
