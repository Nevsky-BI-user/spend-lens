// Вкладка «Скіли й агенти» (CONTRACT v1.12, частина B): сесії застосунку так,
// як їх групує бічна панель десктопа, і для кожної: які скіли, агенти,
// воркфлоу й команди вона викликала. Уся арифметика в lib/kit.js.

import React, { useMemo, useState } from 'react';
import { analyzeSessions } from '../lib/analytics.js';
import {
  kitStatus, kitGroups, normalizeGroupSelection, toggleGroupSelection,
  filterAppSessions, hiddenArchivedCount, kitSummary, groupAppSessions,
  ungroupedRows, indexSessions, latestTranscriptSession, digestKit, fmtKyivShort,
} from '../lib/kit.js';
import { fmtUsd, fmtInt, fmtPct, plural, shortModel } from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';
import KitChips from './KitChips.jsx';
import { Drawer } from './SessionsTab.jsx';

function GroupFilter({ groups, selection, onChange, archived, onArchived, hiddenArchived }) {
  const all = !selection;
  return (
    <div className="kit-filters">
      <div className="kit-group-chips" role="group" aria-label="Групи бічної панелі">
        <button
          type="button"
          className={`kit-filter-chip${all ? ' active' : ''}`}
          aria-pressed={all}
          onClick={() => onChange(null)}
        >
          Усі групи
        </button>
        {groups.map((g) => {
          const on = !all && selection.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`kit-filter-chip${on ? ' active' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(toggleGroupSelection(selection, g.id, groups))}
            >
              {g.name}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`kit-filter-chip kit-archived-toggle${archived ? ' active' : ''}`}
        aria-pressed={archived}
        onClick={() => onArchived(!archived)}
        title={archived ? 'Сховати архівні сесії' : 'Показати архівні сесії'}
      >
        Архівні{!archived && hiddenArchived > 0 ? <em>{fmtInt(hiddenArchived)}</em> : null}
      </button>
    </div>
  );
}

function SummaryCard({ summary }) {
  const pct = (n) => fmtPct(summary.sessions ? (n / summary.sessions) * 100 : 0);
  return (
    <Card
      title="Підсумок"
      subtitle="Скіли й агенти рахуються за власними викликами сесії; виклики всередині агентів видно в рядках сесій."
    >
      <div className="kit-kpis">
        <div>
          <span className="kpi-label">Сесій</span>
          <strong>{fmtInt(summary.sessions)}</strong>
        </div>
        <div>
          <span className="kpi-label">Зі скілами</span>
          <strong>{fmtInt(summary.withSkills)}</strong>
          <span className="kit-kpi-note">{pct(summary.withSkills)}</span>
        </div>
        <div>
          <span className="kpi-label">З агентами</span>
          <strong>{fmtInt(summary.withAgents)}</strong>
          <span className="kit-kpi-note">{pct(summary.withAgents)}</span>
        </div>
        <div>
          <span className="kpi-label">Воркфлоу</span>
          <strong>{fmtInt(summary.workflows)}</strong>
          <span className="kit-kpi-note">{plural(summary.workflows, 'запуск', 'запуски', 'запусків')}</span>
        </div>
      </div>

      <div className="kit-tops">
        <div>
          <h4 className="project-section">Найчастіші скіли</h4>
          {summary.topSkills.length ? (
            <div className="chip-row">
              {summary.topSkills.map((e) => (
                <span className="chip kit-chip chip-skill" key={e.name}>{e.name}<em>×{fmtInt(e.count)}</em></span>
              ))}
            </div>
          ) : <p className="muted-text">Скілів не викликали.</p>}
        </div>
        <div>
          <h4 className="project-section">Найчастіші агенти</h4>
          {summary.topAgents.length ? (
            <div className="chip-row">
              {summary.topAgents.map((e) => (
                <span className="chip kit-chip chip-agent" key={e.name}>{e.name}<em>×{fmtInt(e.count)}</em></span>
              ))}
            </div>
          ) : <p className="muted-text">Агентів не запускали.</p>}
        </div>
      </div>
    </Card>
  );
}

function SessionRow({ s, timeZone, target, onOpen }) {
  const meta = [
    fmtKyivShort(s.lastActivityAt, timeZone),
    [s.model ? shortModel(s.model) : '', s.effort || ''].filter(Boolean).join(' · '),
    s.project || '',
  ].filter(Boolean).join(' · ');
  const body = (
    <>
      <div className="kit-row-top">
        <span className="kit-row-title">
          {s.title || s.appSessionId}
          {s.archived && <span className="side-badge">архівна</span>}
        </span>
        <span className="kit-row-cost">{fmtUsd(s.costUsd)}</span>
      </div>
      {meta && <div className="kit-row-meta">{meta}</div>}
      <KitChips rec={digestKit(s)} />
    </>
  );
  if (!target) {
    return (
      <li className="kit-row" title="Транскрипту цієї сесії немає серед сесій знімка">
        {body}
      </li>
    );
  }
  return (
    <li className="kit-row kit-row-link">
      <div
        role="button"
        tabIndex={0}
        className="kit-row-btn"
        aria-label={`Відкрити деталі сесії: ${s.title || s.appSessionId}`}
        onClick={() => onOpen(target)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(target);
          }
        }}
      >
        {body}
      </div>
    </li>
  );
}

function UngroupedCard({ data }) {
  if (!data.rows.length) return null;
  return (
    <Card className="kit-ungrouped">
      <details>
        <summary>
          <span className="kit-ungrouped-title">Без групи</span>
          <span className="kit-ungrouped-count">
            {fmtInt(data.total)} {plural(data.total, 'сесія', 'сесії', 'сесій')}
          </span>
        </summary>
        <p className="muted-text">
          Здебільшого це запуски рутин за розкладом, тому тут лише кількість за проєктами за весь час.
        </p>
        <ul className="other-projects">
          {data.rows.map((r) => (
            <li key={r.project}>
              <span className="other-project-name">{r.project}</span>
              <span className="other-project-cost">{fmtInt(r.sessions)}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export default function KitTab({
  snapshot, projectSnapshot = null, anchorDay = '', period = 0, project = null, day = null,
  returns = null, kitGroups: selectedGroups = null, kitArchived = false,
  onKitGroupsChange = () => {}, onKitArchivedChange = () => {},
}) {
  const [selected, setSelected] = useState(null);
  const status = kitStatus(snapshot);
  const timeZone = (snapshot && snapshot.timezone) || 'Europe/Kyiv';

  const groups = useMemo(() => (status.ok ? kitGroups(snapshot) : []), [snapshot, status.ok]);
  const selection = normalizeGroupSelection(selectedGroups, groups);
  // Масив вибору щоразу новий, тож у залежності йде його рядковий ключ.
  const selKey = selection ? selection.join(',') : '';

  const { list, hiddenArchived } = useMemo(() => {
    if (!status.ok) return { list: [], hiddenArchived: 0 };
    const opts = {
      groups: selKey ? selKey.split(',') : null,
      archived: kitArchived, project, period, day, anchorDay,
    };
    return {
      list: filterAppSessions(snapshot, opts),
      hiddenArchived: kitArchived ? 0 : hiddenArchivedCount(snapshot, opts),
    };
  }, [snapshot, status.ok, selKey, kitArchived, project, period, day, anchorDay]);
  const summary = useMemo(() => kitSummary(list), [list]);
  const grouped = useMemo(() => groupAppSessions(list, groups), [list, groups]);
  const ungrouped = useMemo(
    () => (status.ok ? ungroupedRows(snapshot, { project }) : { rows: [], total: 0 }),
    [snapshot, status.ok, project]
  );

  // Дровер відкриває сесію з повного (лише за проєктом) списку: сесія, почата
  // 40 днів тому з активністю вчора, у зрізі періоду за startedAt відсутня.
  const source = projectSnapshot || snapshot;
  const byId = useMemo(() => indexSessions(source && source.sessions), [source]);

  // Прапорці рахуються лише коли дровер відкрито: на сесіях того ж зрізу, що й
  // «Сесії» у режимі «Увесь час», плюс «Слабка віддача» з App.
  const item = useMemo(() => {
    if (!selected) return null;
    const found = analyzeSessions(source).flagged.find((f) => f.session.sessionId === selected.sessionId);
    const flags = found ? found.flags : [];
    const lowReturn = returns && returns.byId ? returns.byId.get(selected.sessionId) : null;
    return { session: selected, flags: lowReturn ? [lowReturn, ...flags] : flags };
  }, [selected, source, returns]);

  if (!status.ok) return <EmptyState text={status.reason} />;

  return (
    <>
      <GroupFilter
        groups={groups}
        selection={selection}
        onChange={onKitGroupsChange}
        archived={kitArchived}
        onArchived={onKitArchivedChange}
        hiddenArchived={hiddenArchived}
      />

      {list.length ? (
        <>
          <SummaryCard summary={summary} />
          <div className="kit-groups">
            {grouped.map((g) => (
              <Card
                key={g.group.id}
                className="kit-group-card"
                title={g.group.name}
                subtitle={`${fmtInt(g.sessions.length)} ${plural(g.sessions.length, 'сесія', 'сесії', 'сесій')} · ${fmtUsd(g.costUsd)}`}
              >
                <ul className="kit-rows">
                  {g.sessions.map((s) => (
                    <SessionRow
                      key={s.appSessionId}
                      s={s}
                      timeZone={timeZone}
                      target={latestTranscriptSession(s, byId)}
                      onOpen={setSelected}
                    />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text="Немає сесій у вибраних групах за цей період чи проєкт." />
      )}

      <UngroupedCard data={ungrouped} />
      <Drawer item={item} onClose={() => setSelected(null)} />
    </>
  );
}
