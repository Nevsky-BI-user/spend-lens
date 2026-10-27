// Синхронізує definition.mjs з API. Перший запуск створює, наступні оновлюють.
// Запуск: node --env-file=.env setup.mjs
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AGENT, ENVIRONMENT } from "./definition.mjs";

const LOCK = new URL("./agent.json", import.meta.url);
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {};
const save = () => writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");

const client = new Anthropic(); // ключ бере з ANTHROPIC_API_KEY

if (lock.environment_id) {
  console.log(`environment уже є: ${lock.environment_id}`);
} else {
  const env = await client.beta.environments.create(ENVIRONMENT);
  lock.environment_id = env.id;
  save(); // одразу: якщо агент далі впаде, другого environment не буде
  console.log(`environment створено: ${env.id}`);
}

if (lock.agent_id) {
  const before = lock.agent_version;
  // version дає оптимістичне блокування: якщо агента змінили деінде, прийде 409.
  const agent = await client.beta.agents.update(lock.agent_id, { version: before, ...AGENT });
  lock.agent_version = agent.version;
  console.log(
    agent.version === before
      ? `агент без змін: ${agent.id}, версія ${agent.version}`
      : `агента оновлено: ${agent.id}, версія ${before} -> ${agent.version}`,
  );
} else {
  const agent = await client.beta.agents.create(AGENT);
  lock.agent_id = agent.id;
  lock.agent_version = agent.version;
  console.log(`агента створено: ${agent.id}, версія ${agent.version}`);
}
save();
