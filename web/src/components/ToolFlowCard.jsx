// Картка «Звідки течуть токени інструментів» на вкладці «Категорії» (CONTRACT v1.10).
//
// Стоїть безпосередньо НАД карткою RTK і пояснює її стелю: RTK — проксі для
// команд оболонки, тож дотягується рівно до Bash-скибки цього потоку. Доки не
// видно, що більшу частину виводу дає Read, економія RTK виглядає підозріло
// малою — і користувач шукає ваду там, де її немає.
//
// Межі відповідальності:
//  - фільтр ПЕРІОДУ застосовується (те саме вікно, що й у решті дашборда);
//  - фільтр ПРОЄКТУ не застосовується — колектор не ділить вивід інструментів
//    за проєктами, і про це сказано в підзаголовку;
//  - немає snapshot.toolOutput → компонент повертає null (старий снапшот
//    просто не має картки, без порожніх станів і помилок).

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
} from 'recharts';
import {
  toolFlowTotals, toolFlowCoverage, hasToolFlow, OTHER_TOOL, CHARS_PER_TOKEN,
  TOOLS_PER_DAY,
} from '../lib/toolFlow.js';
import { rtkWindow } from '../lib/rtkValue.js';
import {
  fmtUsd, fmtTokens, fmtInt, fmtPct, fmtDomMonth, plural,
} from '../lib/format.js';
import { Card, EmptyState } from './ui.jsx';
import { LegendRow, useHBarAxis } from './charts.jsx';

const GREEN = '#34C759';
const BLUE = '#007AFF';

// Скільки інструментів показувати рядками. За місяць їх набирається під два
// десятки, і хвіст із десятих відсотка робить діаграму нечитабельною.
const TOP_ROWS = 10;

/** '2026-08-12' → '12 серпня'. */
const dayInWords = (day) => fmtDomMonth(Number(String(day).slice(8, 10)), day);

const SUBTITLE_TAIL =
  'Рахунок глобальний: фільтр за проєктом на нього не впливає';

/** Тултіп рядка: токени, символи, виклики та груба вхідна оцінка в грошах. */
function FlowTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{row.tool}</div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: row.reachable ? GREEN : BLUE }} />
        <span className="chart-tooltip-name">токенів, приблизно</span>
        <span className="chart-tooltip-value">{fmtTokens(row.tokens)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: 'transparent' }} />
        <span className="chart-tooltip-name">частка потоку</span>
        <span className="chart-tooltip-value">{fmtPct(row.share * 100, 1)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: 'transparent' }} />
        <span className="chart-tooltip-name">символів</span>
        <span className="chart-tooltip-value">{fmtInt(row.chars)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="dot" style={{ background: 'transparent' }} />
        <span className="chart-tooltip-name">результатів</span>
        <span className="chart-tooltip-value">{fmtInt(row.calls)}</span>
      </div>
      {row.estUsd > 0 && (
        <div className="chart-tooltip-row">
          <span className="dot" style={{ background: 'transparent' }} />
          <span className="chart-tooltip-name">вхідними, приблизно</span>
          <span className="chart-tooltip-value">{fmtUsd(row.estUsd)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Підпис праворуч від смуги. Власний рендер, а не звичайний LabelList: у
 * recharts підпис успадковує ширину смуги й на коротких смугах ламається на
 * три рядки («1,0M» / «·» / «2,6 %»). Тут текст лишається одним рядком.
 */
function BarValueLabel({ x, y, width, height, value, fontSize }) {
  if (value == null) return null;
  return (
    <text
      x={(x || 0) + (width || 0) + 8}
      y={(y || 0) + (height || 0) / 2}
      dy={4}
      fontSize={fontSize}
      fill="#1C1C1E"
    >
      {value}
    </text>
  );
}

/**
 * Хвіст із дрібних інструментів зводимо в один рядок. Дві тонкощі:
 *
 *  1. Колектор уже має власну хвостову корзину з таким самим підписом («інші» =
 *     усе, що не ввійшло в топ-12 інструментів ДНЯ). Коли вона потрапляє в
 *     топ-10 періоду, наївне згортання дає ДВІ смуги з однаковим підписом і
 *     схожою часткою — розрізнити їх на діаграмі неможливо. Тому чужий хвіст
 *     завжди виймаємо з рейтингу й вливаємо у свій.
 *  2. Інструменти в зоні дії RTK лишаємо завжди — саме заради них картка й існує.
 *
 * @returns {{rows: Array, folded: number, collectorTail: boolean}}
 *          folded — скільки ІМЕНОВАНИХ інструментів звели ми самі; скільки їх
 *          у денному хвості колектора, снапшот уже не памʼятає.
 */
function foldTail(rows, limit) {
  const named = [];
  const tail = [];
  for (const r of rows) {
    if (r.tool === OTHER_TOOL) tail.push(r);
    else named.push(r);
  }
  const collectorTail = tail.length > 0;

  const head = [];
  let folded = 0;
  for (const r of named) {
    if (head.length < limit || r.reachable) head.push(r);
    else { tail.push(r); folded += 1; }
  }
  if (!tail.length) return { rows: head, folded: 0, collectorTail: false };

  const other = tail.reduce(
    (a, r) => ({
      tool: OTHER_TOOL,
      calls: a.calls + r.calls,
      chars: a.chars + r.chars,
      tokens: a.tokens + r.tokens,
      share: a.share + r.share,
      estUsd: a.estUsd + r.estUsd,
      reachable: false,
    }),
    { calls: 0, chars: 0, tokens: 0, share: 0, estUsd: 0 }
  );
  return { rows: [...head, other], folded, collectorTail };
}

/**
 * Найбільші інструменти ПОЗА зоною дії RTK — те, з чого насправді складається
 * «решта». Хвостову корзину не називаємо: «решту дають інші» — не речення.
 * Перелік будується з даних вікна: у різні періоди топ різний, а вшита в код
 * трійця вже розходилася з тим, що показує діаграма поруч.
 */
function outsideNames(rows) {
  const names = rows
    .filter((r) => !r.reachable && r.tool !== OTHER_TOOL)
    .slice(0, 3)
    .map((r) => r.tool);
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' та ' + names[names.length - 1];
}

export default function ToolFlowCard({
  toolOutput, allDays = [], pricingUsed = {}, period = 0, day = null, anchorDay = '',
  isPhone = false,
}) {
  const win = useMemo(
    () => rtkWindow({ period, day, anchorDay }),
    [period, day, anchorDay]
  );
  const flow = useMemo(
    () => toolFlowTotals(toolOutput, { ...win, days: allDays, pricingUsed }),
    [toolOutput, win, allDays, pricingUsed]
  );
  const cover = useMemo(() => toolFlowCoverage(toolOutput), [toolOutput]);

  const fold = useMemo(
    () => (flow
      ? foldTail(flow.rows, TOP_ROWS)
      : { rows: [], folded: 0, collectorTail: false }),
    [flow]
  );
  const rows = useMemo(
    () => fold.rows.map((r) => ({
      ...r,
      label: isPhone
        ? fmtTokens(r.tokens)
        : `${fmtTokens(r.tokens)} · ${fmtPct(r.share * 100, 1)}`,
    })),
    [fold, isPhone]
  );

  const axis = useHBarAxis(rows.map((r) => r.tool), isPhone);

  // Немає блоку toolOutput у снапшоті — картки не існує (CONTRACT v1.10).
  if (!hasToolFlow(toolOutput) || !flow) return null;

  const reachableNames = flow.reachableTools.join(', ');

  // Підзаголовок каже рівно те, що виміряно: яку частку потоку RTK взагалі може
  // дістати. Скільки він із неї зрізав — інше число й інша картка (RTK стинає
  // близько шостої частини своєї скибки, тож «RTK підрізає {reachableShare}»
  // перебільшувало економію в рази). Перелік «решти» — з даних вікна.
  const outside = outsideNames(flow.rows);
  const lead = `≈${fmtTokens(flow.tokens)} токенів вивели інструменти за період`;
  const reachPct = fmtPct(flow.reachableShare * 100, 1);
  let subtitle;
  if (flow.chars === 0) {
    subtitle = SUBTITLE_TAIL;
  } else if (flow.reachableChars === 0) {
    subtitle = `${lead}, і жоден із них не пройшов через оболонку — RTK тут не мав `
      + `до чого дотягнутися. ${SUBTITLE_TAIL}.`;
  } else if (flow.reachableShare >= 0.999) {
    subtitle = `${lead}, і майже все це — вивід команд, тобто зона дії RTK. ${SUBTITLE_TAIL}.`;
  } else if (outside) {
    subtitle = `${lead}. У зоні дії RTK — лише ${reachPct} з них. Решту дають інструменти, `
      + `до яких він не дотягується; найбільші — ${outside}. ${SUBTITLE_TAIL}.`;
  } else {
    subtitle = `${lead}. У зоні дії RTK — лише ${reachPct} з них; решта осіла в зведеному `
      + `хвості «${OTHER_TOOL}». ${SUBTITLE_TAIL}.`;
  }

  let emptyText = 'За вибраний період інструменти не повернули жодного результату.';
  if (cover.from && win.to && win.to < cover.from) {
    emptyText = `Дані про вивід інструментів починаються з ${dayInWords(cover.from)} — `
      + 'за раніші дні їх немає.';
  } else if (cover.to && win.from && win.from > cover.to) {
    emptyText = `Дані про вивід інструментів закінчуються ${dayInWords(cover.to)} — `
      + 'за пізніші дні їх немає.';
  }

  // Що саме опинилося в «інші»: наш зріз, чужий денний хвіст — або обидва.
  let foldNote = '';
  if (fold.folded > 0) {
    const n = `${fold.folded} ${plural(fold.folded, 'інструмент', 'інструменти', 'інструментів')}`;
    // Лічильник стоїть у кінці навмисне: сполучник перед ним не залежить від
    // форми числівника («21 інструмент й денний хвіст» було б помилкою).
    foldNote = fold.collectorTail
      ? `В «${OTHER_TOOL}» зведено денний хвіст колектора (усе, що не ввійшло `
        + `в топ-${TOOLS_PER_DAY} інструментів за день) і ще ${n}.`
      : `В «${OTHER_TOOL}» зведено ${n}.`;
  } else if (fold.collectorTail) {
    foldNote = `Рядок «${OTHER_TOOL}» — це денний хвіст колектора: усе, що не ввійшло `
      + `в топ-${TOOLS_PER_DAY} інструментів того дня.`;
  }

  return (
    <Card title="Звідки течуть токени інструментів" subtitle={subtitle}>
      {rows.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <>
          <div ref={axis.ref}>
            <ResponsiveContainer width="100%" height={Math.max(200, rows.length * axis.rowHeight)}>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 4, right: isPhone ? 56 : 108, left: isPhone ? 0 : 8, bottom: 4 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="tool"
                  tickLine={false}
                  axisLine={false}
                  width={axis.yWidth}
                  tick={axis.tick}
                />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<FlowTooltip />} />
                <Bar dataKey="chars" barSize={22} radius={[0, 6, 6, 0]}>
                  {rows.map((r) => (
                    <Cell key={r.tool} fill={r.reachable ? GREEN : BLUE} />
                  ))}
                  <LabelList
                    dataKey="label"
                    content={<BarValueLabel fontSize={isPhone ? 11 : 12} />}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <LegendRow
            items={[
              {
                label: reachableNames
                  ? `у зоні дії RTK — ${reachableNames}`
                  : 'у зоні дії RTK',
                color: GREEN,
              },
              { label: 'поза нею', color: BLUE },
            ]}
          />

          <p className="muted-text">
            {foldNote && <>{foldNote}{' '}</>}
            Символи переведено в токени за наближенням ≈{CHARS_PER_TOKEN}:1: для коду й
            латиниці воно близьке, для кирилиці занижує, а для скриншотів у base64
            (computer, browser) завищує на порядок. Пораховано те, що інструменти
            ПОВЕРНУЛИ в контекст, а не те, за що виставлено рахунок: кожен такий вивід
            далі перечитується з кешу на кожному наступному ході, тож справжній тиск
            на витрати більший за ці числа.
          </p>
        </>
      )}
    </Card>
  );
}
