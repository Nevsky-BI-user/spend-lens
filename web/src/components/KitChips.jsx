// Рядки чіпів «Скіли / В агентах / Агенти / Воркфлоу / Команди» (CONTRACT v1.12).
// Спільні для рядка сесії на вкладці «Скіли й агенти» і для блоку в дровері
// сесії, тож кольори й підписи однакові всюди.

import React from 'react';
import { fmtInt, plural } from '../lib/format.js';

function ChipLine({ label, entries, chipClass, prefix = '' }) {
  if (!entries || !entries.length) return null;
  return (
    <div className="kit-line">
      <span className="kit-line-label">{label}</span>
      <div className="chip-row">
        {entries.map((e) => (
          <span className={`chip kit-chip ${chipClass}`} key={e.name}>
            {prefix}{e.name}<em>×{fmtInt(e.count)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{rec: ReturnType<import('../lib/kit.js').digestKit>}} props
 * rec null: нічого не рендеримо (даних немає зовсім).
 */
export default function KitChips({ rec }) {
  if (!rec) return null;
  return (
    <div className="kit-lines">
      {!rec.used && <p className="kit-none">скілів і агентів не викликала</p>}
      <ChipLine label="Скіли" entries={rec.skills} chipClass="chip-skill" />
      <ChipLine label="В агентах" entries={rec.skillsInAgents} chipClass="chip-skill-agent" />
      <ChipLine label="Агенти" entries={rec.agents} chipClass="chip-agent" />
      <ChipLine label="Агенти в агентах" entries={rec.agentsInAgents} chipClass="chip-agent" />
      {rec.workflows > 0 && (
        <div className="kit-line">
          <span className="kit-line-label">Воркфлоу</span>
          <div className="chip-row">
            <span className="chip kit-chip chip-workflow">
              <em>{fmtInt(rec.workflows)}</em>{plural(rec.workflows, 'запуск', 'запуски', 'запусків')}
            </span>
          </div>
        </div>
      )}
      <ChipLine label="Команди" entries={rec.commands} chipClass="chip-command" prefix="/" />
    </div>
  );
}
