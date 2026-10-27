// Одна розмова з агентом у терміналі.
// Запуск: node --env-file=.env try.mjs "твоє питання"
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { runAgentTool } from "../web/src/lib/agentTools.js";

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const { agent_id, agent_version, environment_id } = readJson("./agent.json");
const snapshot = readJson("../web/public/data/usage.json"); // той самий снапшот, що бачить дашборд
const question = process.argv[2] ?? "Скільки я витратив за весь час і на який проєкт найбільше?";

const client = new Anthropic();

// Сесія закріплюється за конкретною версією агента.
const session = await client.beta.sessions.create({
  agent: { type: "agent", id: agent_id, version: agent_version },
  environment_id,
  title: "try.mjs",
});
console.log(`сесія: ${session.id}\n`);

// Спершу відкриваємо потік, потім надсилаємо питання: інакше перші події можна пропустити.
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [{ type: "user.message", content: [{ type: "text", text: question }] }],
});

for await (const event of stream) {
  switch (event.type) {
    case "agent.message":
      for (const block of event.content) if (block.type === "text") process.stdout.write(block.text);
      break;

    case "agent.custom_tool_use": {
      console.log(`\n[інструмент] ${event.name} ${JSON.stringify(event.input)}`);
      const { text, isError } = runAgentTool(snapshot, event.name, event.input);
      console.log(`[результат] ${text.length} символів${isError ? ", ПОМИЛКА" : ""}`);
      await client.beta.sessions.events.send(session.id, {
        events: [{
          type: "user.custom_tool_result",
          custom_tool_use_id: event.id, // звʼязує відповідь з конкретним викликом
          content: [{ type: "text", text }],
          is_error: isError,
        }],
      });
      break;
    }

    case "session.usage":
      console.log(`\n[usage] ${JSON.stringify(event.usage ?? event)}`);
      break;

    case "session.error":
      console.log(`\n[помилка сесії] ${JSON.stringify(event)}`);
      break;
  }

  // Вихід: сесія завершилась або стала idle НЕ через очікування нашого інструмента.
  if (event.type === "session.status_terminated") break;
  if (event.type === "session.status_idle" && event.stop_reason?.type !== "requires_action") {
    console.log(`\n\n[кінець: ${event.stop_reason?.type}]`);
    break;
  }
}