// Вкладка «Дії»: картки рекомендацій із готовими до вставки українськими
// промптами для Claude Code. Сортування: оцінка втрат ↓.

import React, { useMemo } from 'react';
import { buildRecommendations } from '../lib/analytics.js';
import { fmtUsd } from '../lib/format.js';
import { Card, FlagChip, CopyButton, EmptyState } from './ui.jsx';

const SEVERITY_ICON = { high: '🔴', medium: '🟠', low: '🟡' };
const SEVERITY_LABEL = { high: 'критично', medium: 'помітно', low: 'дрібниця' };

export default function ActionsTab({ snapshot }) {
  const cards = useMemo(() => buildRecommendations(snapshot), [snapshot]);

  if (!cards.length) {
    return <EmptyState text="Рекомендацій немає — витрати виглядають здоровими." />;
  }

  return (
    <div className="actions-list">
      {cards.map((c) => (
        <Card key={c.id} className="action-card">
          <div className="action-head">
            <span className="severity" title={SEVERITY_LABEL[c.severity]}>{SEVERITY_ICON[c.severity]}</span>
            <h3 className="action-title">{c.title}</h3>
            <span className="action-waste">{fmtUsd(c.wasteUsd)}</span>
          </div>
          <div className="chip-row"><FlagChip type={c.type} /></div>
          <p className="action-evidence">{c.evidence}</p>
          <div className="prompt-box">
            <p>{c.prompt}</p>
            <CopyButton text={c.prompt} />
          </div>
        </Card>
      ))}
    </div>
  );
}
