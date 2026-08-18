// Вкладка «Сесії»: таблиця за вартістю ↓, клік по рядку → дровер із
// міксом моделей, метриками, прапорцями та рекомендаціями сесії.

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
          <div><span>Ходи (юзер / асистент)</span><strong>{fmtInt(s.userTurns)} / {fmtInt(s.assistantTurns)}</strong></div>
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

export default function SessionsTab({ snapshot }) {
  const [selected, setSelected] = useState(null);
  const { flagged } = useMemo(() => analyzeSessions(snapshot), [snapshot]);

  const rows = useMemo(
    () => [...flagged].sort(
      (a, b) => (b.session.totals?.costUsd || 0) - (a.session.totals?.costUsd || 0)
    ),
    [flagged]
  );

  if (!rows.length) return <EmptyState text="Сесій поки немає." />;

  return (
    <Card className="table-card">
      <div className="table-scroll">
        <table className="sessions-table">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Проєкт</th>
              <th>Коли</th>
              <th>Моделі</th>
              <th>Токени (вх / вих / кеш)</th>
              <th>Кеш-хіт</th>
              <th>Контекст</th>
              <th>$</th>
              <th>Прапорці</th>
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
                  <td>{Object.keys(s.models || {}).map(shortModel).join(', ')}</td>
                  <td className="cell-num">{fmtTokens(t.input)} / {fmtTokens(t.output)} / {fmtTokens(t.cacheRead)}</td>
                  <td className="cell-num">{fmtPct((s.cacheHitRate || 0) * 100)}</td>
                  <td className="cell-num">{fmtTokens(s.avgContext)}</td>
                  <td className="cell-num cell-cost">{fmtUsd(t.costUsd)}</td>
                  <td>
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
