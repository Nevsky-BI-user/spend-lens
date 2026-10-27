// Edge Function «agent»: міст між дашбордом spend-lens і Managed Agent.
//
// Один POST = один відрізок розмови. Браузер шле { session_id?, events },
// функція перевіряє вхід, за потреби створює сесію, відкриває потік подій,
// надсилає events і пересилає потік у браузер до першого idle.
// Якщо агент чекає на інструмент (requires_action), браузер рахує його
// функціями analytics.js і шле результат наступним POST.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://nevsky-bi-user.github.io", "http://localhost:5173"];
const INBOUND = new Set(["user.message", "user.custom_tool_result"]);
const MAX_BODY = 200_000; // символів: питання плюс результати інструментів
const SEGMENT_MS = 120_000; // запас до ліміту часу виконання функції
const DEFAULT_DAILY_CENTS = 100; // денний ліміт аналітика, якщо не задано секрет

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "лише POST" });

  try {
    // 1. Налаштування із секретів. Чогось бракує: агент вимкнено, решта дашборда працює.
    const cfg = {
      apiKey: Deno.env.get("ANTHROPIC_SPEND_LENS_API_KEY"),
      agentId: Deno.env.get("SPEND_LENS_AGENT_ID"),
      agentVersion: Number(Deno.env.get("SPEND_LENS_AGENT_VERSION")),
      environmentId: Deno.env.get("SPEND_LENS_ENVIRONMENT_ID"),
    };
    if (!cfg.apiKey || !cfg.agentId || !cfg.agentVersion || !cfg.environmentId) {
      return json(req, 503, { error: "агент вимкнено: не задано секрети" });
    }

    // 2. Хто це. Шлюз Supabase пропускає і anon-ключ, тому користувача перевіряємо самі.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user?.email) return json(req, 401, { error: "потрібен вхід" });
    const { data: allowed } = await admin
      .from("allowed_users").select("email").eq("email", user.email).maybeSingle();
    if (!allowed) return json(req, 403, { error: "доступ заборонено" });

    // 3. Що прийшло. Браузер може лише питати й повертати результати інструментів.
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(req, 413, { error: "завеликий запит" });
    let body: { session_id?: string; events?: Array<{ type?: string }> };
    try {
      body = JSON.parse(raw);
    } catch {
      return json(req, 400, { error: "тіло запиту не JSON" });
    }
    const events = body.events;
    if (!Array.isArray(events) || events.length === 0 ||
        !events.every((e) => INBOUND.has(e?.type ?? ""))) {
      return json(req, 400, { error: "дозволені лише user.message і user.custom_tool_result" });
    }

    // 4. Денний ліміт (міграція 005). Рахується на всіх користувачів разом:
    // платить один рахунок Anthropic. День київський, суми в центах list_cost.
    const limitCents = Number(Deno.env.get("SPEND_LENS_DAILY_BUDGET_CENTS")) || DEFAULT_DAILY_CENTS;
    const { data: spentToday, error: spentErr } = await admin.rpc("agent_spent_today");
    if (spentErr) return json(req, 503, { error: "облік витрат недоступний" });
    const spentCents = Number(spentToday) || 0;
    if (spentCents >= limitCents) {
      return json(req, 429, {
        error: `Денний бюджет аналітика ($${(limitCents / 100).toFixed(2).replace(".", ",")}) вичерпано. Він оновиться опівночі за Києвом.`,
        budget: { spent_cents: spentCents, limit_cents: limitCents },
      });
    }

    // 5. Сесія: нова або своя. Агента й версію задають секрети, а не браузер.
    const anthropic = new Anthropic({ apiKey: cfg.apiKey });
    let sessionId = body.session_id;
    if (sessionId) {
      const s = await anthropic.beta.sessions.retrieve(sessionId);
      if (s.metadata?.owner !== user.id || s.agent.id !== cfg.agentId) {
        return json(req, 403, { error: "чужа сесія" });
      }
    } else {
      const s = await anthropic.beta.sessions.create({
        agent: { type: "agent", id: cfg.agentId, version: cfg.agentVersion },
        environment_id: cfg.environmentId,
        title: "spend-lens: дашборд",
        metadata: { owner: user.id },
        // Стеля сесії = залишок дня: одна розмова не перевищить денний ліміт
        // навіть посеред відповіді. Досягнувши її, сесія стає з budget_reached.
        budget: {
          type: "limit",
          max_list_cost: { amount: String(limitCents - spentCents), currency: "USD" },
        },
      });
      sessionId = s.id;
    }
    const sid = sessionId;

    // Знімок usage кумулятивний, тож у базу йде останній за відрізок,
    // а функція agent_record_usage додає до дня лише приріст.
    let lastUsageCents: number | null = null;
    const recordUsage = async () => {
      if (lastUsageCents === null) {
        const s = await anthropic.beta.sessions.retrieve(sid);
        const amount = s.usage?.list_cost?.amount;
        if (amount === undefined) return null;
        lastUsageCents = Number(amount);
      }
      const { data, error } = await admin.rpc("agent_record_usage", {
        p_session: sid,
        p_owner: user.id,
        p_cents: lastUsageCents,
      });
      return error ? null : Number(data);
    };

    // 6. Спершу потік, потім події: так не пропустимо перших відповідей.
    const stream = await anthropic.beta.sessions.events.stream(sessionId);
    // deno-lint-ignore no-explicit-any
    await anthropic.beta.sessions.events.send(sessionId, { events: events as any });

    // 7. Пересилання у браузер як SSE до першого idle після роботи агента.
    const enc = new TextEncoder();
    const out = new ReadableStream({
      async start(controller) {
        // Браузер міг уже закрити зʼєднання: тоді enqueue кидає, а облік має дійти до кінця.
        const emit = (e: unknown) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch { /* потік скасовано */ }
        };
        const timer = setTimeout(() => stream.controller.abort(), SEGMENT_MS);
        emit({ type: "relay.session", session_id: sessionId });
        let working = false;
        try {
          for await (const event of stream) {
            emit(event);
            const t = event.type as string;
            if (t === "session.usage") {
              const amount = (event as { usage?: { list_cost?: { amount?: string } | null } })
                .usage?.list_cost?.amount;
              if (amount !== undefined) lastUsageCents = Number(amount);
            }
            if (t === "session.status_running" || t.startsWith("agent.") || t.startsWith("span.")) {
              working = true;
            }
            if (t === "session.status_terminated") break;
            if (t === "session.status_idle" && working) break;
          }
        } catch (e) {
          emit(stream.controller.signal.aborted
            ? { type: "relay.timeout" }
            : { type: "relay.error", message: String(e) });
        } finally {
          clearTimeout(timer);
          try {
            const spent = await recordUsage();
            if (spent !== null) emit({ type: "relay.budget", spent_cents: spent, limit_cents: limitCents });
          } catch { /* облік не має ламати відповідь; наступний знімок наздожене приріст */ }
          try {
            controller.close();
          } catch { /* уже закрито */ }
        }
      },
      cancel() {
        stream.controller.abort();
      },
    });

    return new Response(out, {
      headers: {
        ...cors(req),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return json(req, 502, { error: String(e) });
  }
});