// Клієнт аналітика: розмова з Managed Agent через Edge Function `agent`.
// Один POST = один відрізок розмови: функція пересилає події сесії до паузи.
// Якщо на паузі агент просить інструмент (requires_action), рахуємо його тут,
// над тим самим снапшотом, що бачить дашборд, і шлемо результат наступним POST.
// Ключ Anthropic у браузер не потрапляє: його знає лише функція.
import { runAgentTool } from './agentTools.js';

const MAX_SEGMENTS = 8; // запобіжник: агент не може просити інструменти без кінця

const defaultEndpoint = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent`;

// Токен беремо перед кожним POST: supabase-js сам оновлює прострочений.
async function supabaseToken() {
  const { getSupabase } = await import('./supabaseData.js');
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Сесія входу закінчилась. Оновіть сторінку й увійдіть знову.');
  return token;
}

// Потік SSE: події розділені порожнім рядком, дані в рядках `data: `.
async function readEvents(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const data = buf
        .slice(0, cut)
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      buf = buf.slice(cut + 2);
      if (data) onEvent(JSON.parse(data));
    }
  }
}

async function postSegment({ endpoint, token, sessionId, events, signal }, onEvent) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { session_id: sessionId, events } : { events }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // Сюди ж падає відмова шлюзу без CORS-заголовків: браузер ховає її код.
    throw new Error('Немає звʼязку з аналітиком. Перевірте мережу або оновіть сторінку й увійдіть знову.');
  }
  if (!res.ok) {
    // Наша функція відповідає { error }, шлюз Supabase відповідає { code, message }.
    // 429 ще й приносить { budget }: скільки витрачено за день і ліміт.
    let msg = `HTTP ${res.status}`;
    let budget = null;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
      budget = j.budget || null;
    } catch { /* тіло не JSON: лишаємо код */ }
    throw Object.assign(new Error(msg), { status: res.status, budget });
  }
  try {
    await readEvents(res.body, onEvent);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // Зʼєднання обірвалося посеред потоку: сесія могла лишитися на паузі
    // з невиконаним інструментом, тому панель почне наступне питання з нуля.
    throw Object.assign(new Error('Зʼєднання з аналітиком обірвалося. Спробуйте ще раз.'), { dropped: true });
  }
}

function toolResult(snapshot, call, id) {
  const { text, isError } = call
    ? runAgentTool(snapshot, call.name, call.input)
    : { text: 'Виклик інструмента не знайдено', isError: true };
  return {
    type: 'user.custom_tool_result',
    custom_tool_use_id: id,
    content: [{ type: 'text', text }],
    is_error: isError,
  };
}

/**
 * Одне питання до аналітика, з усіма викликами інструментів до кінця відповіді.
 * context: службовий текст (поточний фільтр дашборда), іде перед питанням.
 * onEvent: кожна подія сесії, для показу в панелі.
 * Повертає { sessionId, stop }: stop.type це end_turn, refusal тощо.
 */
export async function askAgent({
  text,
  context,
  sessionId,
  snapshot,
  onEvent = () => {},
  signal,
  getToken = supabaseToken,
  endpoint = defaultEndpoint(),
}) {
  const content = context ? [{ type: 'text', text: context }, { type: 'text', text }] : [{ type: 'text', text }];
  let events = [{ type: 'user.message', content }];

  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const calls = new Map();
    let stop = null;
    let failure = null;
    await postSegment({ endpoint, token: await getToken(), sessionId, events, signal }, (ev) => {
      if (ev.type === 'relay.session') sessionId = ev.session_id;
      else if (ev.type === 'agent.custom_tool_use') calls.set(ev.id, ev);
      else if (ev.type === 'session.status_idle') stop = ev.stop_reason;
      else if (ev.type === 'session.status_terminated') stop = { type: 'terminated' };
      else if (ev.type === 'relay.timeout') failure = 'Аналітик не відповів за 2 хвилини. Спробуйте ще раз.';
      else if (ev.type === 'relay.error') failure = ev.message || 'Збій звʼязку з аналітиком';
      onEvent(ev);
    });
    if (failure) throw new Error(failure);
    if (stop?.type !== 'requires_action') return { sessionId, stop };
    events = (stop.event_ids || []).map((id) => toolResult(snapshot, calls.get(id), id));
  }
  throw new Error('Аналітик зробив забагато кроків поспіль. Спробуйте поставити питання вужче.');
}
