// Аналітик у правому нижньому куті: кнопка відкриває бічну панель розмови з
// Managed Agent spend-lens. Лише режим Supabase: функції агента потрібен вхід.
// Панель не модальна: дашборд поруч лишається робочим, розмова живе, поки
// відкрита вкладка браузера (sessionStorage), «нова розмова» починає сесію заново.
import { useEffect, useRef, useState } from 'react';
import { askAgent } from '../lib/agentClient.js';
import { CopyButton } from './ui.jsx';
import { fmtUsd } from '../lib/format.js';
import './AgentChat.css';

const STORE = 'spend-lens:agent';

const SUGGESTIONS = [
  'Скільки я витратив сьогодні?',
  'Які сесії найдорожчі за тиждень?',
  'Що найбільше роздуває витрати?',
  'Як зменшити витрати цього місяця?',
];

const TOOL_LABEL = {
  get_spend_summary: 'Рахую підсумок витрат',
  get_top_sessions: 'Шукаю найдорожчі сесії',
  get_cost_factors: 'Аналізую фактори перевитрати',
};

const STOP_NOTE = {
  retries_exhausted: 'Аналітик не зміг відповісти після кількох спроб. Спробуйте ще раз.',
  budget_reached: 'Денний бюджет аналітика вичерпано. Він оновиться опівночі за Києвом.',
  refusal: 'Аналітик не відповідає на це питання.',
  terminated: 'Розмову завершено. Почніть нову.',
};

const EMPTY = { sessionId: null, messages: [] };

function loadChat() {
  try {
    const c = JSON.parse(sessionStorage.getItem(STORE));
    if (c && Array.isArray(c.messages)) return c;
  } catch { /* приватне вікно або зіпсований запис */ }
  return EMPTY;
}

function saveChat(c) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(c));
  } catch { /* сховище недоступне: розмова просто не переживе перезавантаження */ }
}

// Зріз, відкритий у дашборді, у термінах аргументів інструментів.
function filterContext({ period, project, day }) {
  const args = [day ? `day=${day}` : `period_days=${period}`];
  if (project) args.push(`project="${project}"`);
  return `Зріз, відкритий у дашборді: ${args.join(', ')}. Бери його, якщо питання не задає інший.`;
}

let seq = 0;
const nextId = () => `m${Date.now()}-${seq++}`;

// --- мінімальний markdown відповіді -------------------------------------------
// Абзаци, списки, таблиці, **жирний**, `код` і блоки коду з копіюванням (агент
// дає в них готові промпти). Без innerHTML: текст агента не стає розміткою.

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}

const LIST = /^\s*([-*]|\d+\.)\s+/;
const BLOCK_START = /^(```|#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s)/;
const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function Markdown({ text }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = out.length;
    if (line.startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      const code = body.join('\n');
      out.push(
        <div className="agent-code" key={key}>
          <pre>{code}</pre>
          <CopyButton text={code} />
        </div>
      );
    } else if (/^\s*\|/.test(line)) {
      const rows = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        if (!/^\s*\|?[\s:|-]+$/.test(lines[i])) rows.push(cells(lines[i]));
      }
      const [head, ...body] = rows;
      out.push(
        <div className="agent-table-wrap" key={key}>
          <table className="agent-table">
            <thead><tr>{head.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr></thead>
            <tbody>
              {body.map((r, n) => <tr key={n}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      );
    } else if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && LIST.test(lines[i]); i++) items.push(lines[i].replace(LIST, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={key}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</Tag>);
    } else if (/^#{1,4}\s/.test(line)) {
      out.push(<p className="agent-h" key={key}>{inline(line.replace(/^#+\s+/, ''))}</p>);
      i++;
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i]); i++) para.push(lines[i]);
      if (!para.length) para.push(lines[i++]); // рядок, схожий на блок, але не розібраний
      out.push(
        <p key={key}>
          {para.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l)}</span>)}
        </p>
      );
    }
  }
  return out;
}

function Message({ m }) {
  if (m.role === 'user') return <div className="agent-msg user">{m.text}</div>;
  if (m.role === 'agent') return <div className="agent-msg bot"><Markdown text={m.text} /></div>;
  return <div className={`agent-msg ${m.role}`}>{m.text}</div>; // error або note
}

// --- іконки (stroke = currentColor) -------------------------------------------

const Spark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z" fill="currentColor" />
    <path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" />
  </svg>
);
const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const PLUS = 'M12 5v14M5 12h14';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const SEND = 'M12 19V5M5.5 11.5L12 5l6.5 6.5';

// --- панель -------------------------------------------------------------------

export default function AgentChat({ snapshot, period, project, day }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(loadChat);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  // { spent_cents, limit_cents } з функції: після кожної відповіді й у 429.
  const [budget, setBudget] = useState(null);
  const abortRef = useRef(null);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const wasOpen = useRef(false);

  useEffect(() => saveChat(chat), [chat]);

  // Фокус: у поле при відкритті, назад на кнопку після закриття. Escape закриває.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      const onKey = (e) => e.key === 'Escape' && setOpen(false);
      window.addEventListener('keydown', onKey);
      wasOpen.current = true;
      return () => window.removeEventListener('keydown', onKey);
    }
    if (wasOpen.current) launcherRef.current?.focus();
  }, [open]);

  // Нове повідомлення чи статус: стрічка до низу.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, status, open]);

  // Сторінку закрили посеред відповіді: обриваємо запит.
  useEffect(() => () => abortRef.current?.abort(), []);

  const add = (m) =>
    setChat((c) =>
      m.id && c.messages.some((x) => x.id === m.id)
        ? c
        : { ...c, messages: [...c.messages, { ...m, id: m.id || nextId() }] }
    );

  async function send(text) {
    const q = text.trim();
    if (!q || busy || !snapshot) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = '';
    add({ role: 'user', text: q });
    setBusy(true);
    setStatus('Думаю');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let current = chat.sessionId; // сесія цього питання, зокрема щойно створена
    try {
      const { stop } = await askAgent({
        text: q,
        context: filterContext({ period, project, day }),
        sessionId: chat.sessionId,
        snapshot,
        signal: ctrl.signal,
        onEvent: (ev) => {
          if (ev.type === 'relay.session') {
            current = ev.session_id;
            setChat((c) => ({ ...c, sessionId: ev.session_id }));
          } else if (ev.type === 'relay.budget') {
            setBudget({ spent_cents: ev.spent_cents, limit_cents: ev.limit_cents });
          } else if (ev.type === 'agent.custom_tool_use') {
            setStatus(TOOL_LABEL[ev.name] || 'Рахую');
          } else if (ev.type === 'agent.thinking') {
            setStatus('Думаю');
          } else if (ev.type === 'agent.message') {
            const t = (ev.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
            if (t) add({ role: 'agent', text: t, id: ev.id });
          } else if (ev.type === 'session.error') {
            add({ role: 'error', text: ev.error?.message || 'Помилка сесії аналітика' });
          }
        },
      });
      if (STOP_NOTE[stop?.type]) add({ role: 'note', text: STOP_NOTE[stop.type] });
      // Сесія вичерпала свою стелю або завершилась: наступне питання піде в нову.
      if (stop?.type === 'terminated' || stop?.type === 'budget_reached') {
        setChat((c) => ({ ...c, sessionId: null }));
      }
    } catch (e) {
      if (e.name !== 'AbortError') add({ role: 'error', text: e.message });
      if (e.budget) setBudget(e.budget);
      // Сервер відхилив продовження (сесія застрягла посеред інструмента після
      // перезавантаження, завершилась чи чужа): наступне питання піде в нову.
      // 401 (вхід) і 429 (денний ліміт) до самої сесії стосунку не мають.
      const rejected = e.status && e.status !== 401 && e.status !== 429;
      if ((rejected || e.dropped) && current) {
        setChat((c) => ({ ...c, sessionId: null }));
        add({ role: 'note', text: 'Наступне питання почне нову розмову.' });
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setBusy(false);
        setStatus('');
      }
    }
  }

  function newChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus('');
    setChat(EMPTY);
    inputRef.current?.focus();
  }

  const grow = (e) => {
    e.target.style.height = '';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  if (!open) {
    return (
      <button ref={launcherRef} type="button" className="agent-launcher" onClick={() => setOpen(true)}>
        <span className="agent-launcher-icon"><Spark /></span>
        Аналітик
      </button>
    );
  }

  return (
    <aside className="agent-panel" role="dialog" aria-label="Аналітик витрат">
      <header className="agent-head">
        <span className="agent-avatar"><Spark /></span>
        <div className="agent-title">
          Аналітик <span className="agent-beta">beta</span>
        </div>
        <button
          type="button"
          className="agent-icon-btn"
          onClick={newChat}
          disabled={!chat.messages.length && !busy}
          aria-label="Нова розмова"
        >
          <Icon d={PLUS} />
        </button>
        <button type="button" className="agent-icon-btn" onClick={() => setOpen(false)} aria-label="Закрити">
          <Icon d={CLOSE} />
        </button>
      </header>

      <div className="agent-body" ref={bodyRef} aria-live="polite">
        {chat.messages.length === 0 && (
          <div className="agent-welcome">
            <p>Привіт! Я відповідаю на питання про витрати Claude Code за даними цього дашборда і підказую, як їх зменшити.</p>
            <div className="agent-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="agent-chip" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m) => <Message key={m.id} m={m} />)}
        {busy && (
          <div className="agent-status">
            <span className="agent-dots" aria-hidden="true"><i /><i /><i /></span>
            {status}…
          </div>
        )}
      </div>

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={2000}
          placeholder="Запитайте про витрати"
          aria-label="Питання аналітику"
          onChange={(e) => setDraft(e.target.value)}
          onInput={grow}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button type="submit" className="agent-send" disabled={busy || !draft.trim()} aria-label="Надіслати">
          <Icon d={SEND} />
        </button>
      </form>
      <p className="agent-foot">
        Аналітик може помилятися
        {budget && (
          <>
            {' · '}
            <span className="num">
              сьогодні {fmtUsd(budget.spent_cents / 100)} з {fmtUsd(budget.limit_cents / 100)}
            </span>
          </>
        )}
      </p>
    </aside>
  );
}
