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

    // 4. Сесія: нова або своя. Агента й версію задають секрети, а не браузер.
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
      });
      sessionId = s.id;
    }

    // 5. Спершу потік, потім події: так не пропустимо перших відповідей.
    const stream = await anthropic.beta.sessions.events.stream(sessionId);
    // deno-lint-ignore no-explicit-any
    await anthropic.beta.sessions.events.send(sessionId, { events: events as any });

    // 6. Пересилання у браузер як SSE до першого idle після роботи агента.
    const enc = new TextEncoder();
    const out = new ReadableStream({
      async start(controller) {
        const emit = (e: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        const timer = setTimeout(() => stream.controller.abort(), SEGMENT_MS);
        emit({ type: "relay.session", session_id: sessionId });
        let working = false;
        try {
          for await (const event of stream) {
            emit(event);
            const t = event.type as string;
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
          controller.close();
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