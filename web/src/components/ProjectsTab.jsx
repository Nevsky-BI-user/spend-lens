// Вкладка «Проєкти» (CONTRACT v1.7b): картка на проєкт, відсортовано за
// вартістю ↓. У картці — назва, ручний опис або автоопис одним реченням,
// KPI (витрати / сесії / частка субагентів), чіпи областей, мікс активностей,
// топ-5 сесій із вартістю і кнопка «Показати лише цей проєкт».
//
// Вкладка живе на ТОМУ САМОМУ відфільтрованому зрізі, що й решта: період,
// день і проєкт застосовує App. Вибраний у тулбарі проєкт означає, що в зріз
// потрапляє лише він — картка залишається одна, як вимагає контракт, але
// частка витрат рахується від суми ВСІХ проєктів періоду (prop shareTotalUsd),
// щоб «44 % витрат» не перетворювалося на «100 % витрат» від власного кліку.
//
// Снапшот schemaVersion 1 (без digest/projects) → чесний порожній стан
// «Оновіть дані колектором», а не порожні картки.

import React, { useMemo } from 'react';
import { buildProjectCards, projectSummary, hasDigestData } from '../lib/digest.js';
import { plural } from '../lib/analytics.js';
import { fmtUsd, fmtInt, fmtPct } from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';
import { SERIES } from './charts.jsx';

/** Мікс активностей: 100%-смуга + легенда з кількістю сесій. */
function ActivityMix({ activities }) {
  if (!activities.length) return null;
  return (
    <div className="activity-mix">
      <div className="activity-bar" aria-hidden="true">
        {activities.map((a, i) => (
          <span
            key={a.label}
            style={{ width: `${Math.max(a.share * 100, 1)}%`, background: SERIES[i % SERIES.length] }}
          />
        ))}
      </div>
      <ul className="activity-legend">
        {activities.map((a, i) => (
          <li key={a.label}>
            <i className="dot" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="activity-label">{a.label}</span>
            <b>{fmtInt(a.count)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ card, selected, onSelectProject }) {
  const summary = card.note || projectSummary(card);
  return (
    <Card className="project-card">
      <div className="project-head">
        <h3 className="project-name">{card.project}</h3>
        <span
          className="project-share"
          title="Частка у витратах за вибраний період — по всіх проєктах, а не лише по видимих"
        >
          {fmtPct(card.share * 100)} витрат
        </span>
      </div>
      {summary && <p className="project-summary">{summary}</p>}

      <div className="metric-grid project-kpi">
        <div>
          <span>Витрати</span>
          <strong>{fmtUsd(card.costUsd)}</strong>
        </div>
        <div>
          <span>Сесії</span>
          <strong>{fmtInt(card.sessions)}</strong>
        </div>
        <div>
          <span>Частка субагентів</span>
          <strong>{fmtPct(card.sidechainShare * 100)}</strong>
        </div>
      </div>

      {card.areas.length > 0 && (
        <>
          <h4 className="project-section">Області</h4>
          <div className="chip-row">
            {card.areas.map((a) => (
              <span
                className="chip chip-area"
                key={a.path}
                title={`${a.path} — ${fmtInt(a.count)} ${plural(a.count, 'звернення', 'звернення', 'звернень')} до файлів`}
              >
                {a.path}
              </span>
            ))}
          </div>
        </>
      )}

      {card.activities.length > 0 && (
        <>
          <h4 className="project-section">Чим займалися</h4>
          <ActivityMix activities={card.activities} />
        </>
      )}

      {card.titles.length > 0 && (
        <>
          <h4 className="project-section">Найдорожчі сесії</h4>
          <ul className="project-sessions">
            {card.titles.map((t) => (
              <li key={t.sessionId}>
                <span className="project-session-title">
                  {t.title}
                  {t.sidechain && <span className="side-badge">сабчейн</span>}
                </span>
                <span className="project-session-cost">{fmtUsd(t.costUsd)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="project-actions">
        {selected ? (
          <button type="button" className="link-btn" onClick={() => onSelectProject(null)}>
            Показати всі проєкти
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => onSelectProject(card.project)}
            title={`Показати лише ${card.project}`}
          >
            Показати лише цей проєкт
          </button>
        )}
      </div>
    </Card>
  );
}

export default function ProjectsTab({
  snapshot, project = null, shareTotalUsd = null, onSelectProject = () => {},
}) {
  // shareTotalUsd — витрати всіх проєктів за той самий період (App). Саме вони
  // база для «N % витрат»: інакше вибір одного проєкту в тулбарі перетворював би
  // будь-яку картку на «100 % витрат», хоча зміна фільтра нічого не витратила.
  const cards = useMemo(
    () => buildProjectCards(snapshot || {}, { totalUsd: shareTotalUsd }),
    [snapshot, shareTotalUsd]
  );
  const hasDigests = useMemo(() => hasDigestData(snapshot), [snapshot]);

  if (!hasDigests) {
    return (
      <EmptyState text="Цей знімок зібрано старою версією колектора — у ньому немає дайджестів проєктів. Оновіть дані колектором (node collector/collect.mjs), і вкладка покаже, чим займався кожен проєкт." />
    );
  }
  if (!cards.length) {
    return <EmptyState text="Немає проєктів за вибраний період." />;
  }

  return (
    <div className="projects-grid">
      {cards.map((c) => (
        <ProjectCard
          key={c.project}
          card={c}
          selected={project === c.project}
          onSelectProject={onSelectProject}
        />
      ))}
    </div>
  );
}
