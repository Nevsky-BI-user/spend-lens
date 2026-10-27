// Одноразове налаштування Managed Agent: середовище + агент.
// Перший запуск створює обидва й пише ID в agent.json (комітиться).
// Повторний запуск НЕ створює нових: оновлює наявного агента (нова версія)
// з поточних system-prompt.md і TOOL_DEFS. Середовище лишається те саме.
//
//   npm run setup

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFS } from '../web/src/lib/chatTools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, 'agent.json');

const AGENT = {
  name: 'spend-lens-analyst',
  description: 'Чат дашборда spend-lens: витрати Claude Code і поради з оптимізації',
  model: { id: 'claude-opus-5-5', effort: 'high' },
  system: fs.readFileSync(path.join(HERE, 'system-prompt.md'), 'utf8').trim(),
  // Вбудований набір (bash, read, web_search…) свідомо не підключено: усі числа
  // приходять з analytics.js через власні інструменти, контейнеру нічого робити.
  tools: TOOL_DEFS,
};

// Контейнер без вбудованих інструментів мережі не потребує: закриваємо все.
const ENVIRONMENT = {
  name: 'spend-lens-chat',
  description: 'Пісочниця агента spend-lens-analyst, мережу закрито',
  config: {
    type: 'cloud',
    networking: { type: 'limited', allowed_hosts: [], allow_mcp_servers: false, allow_package_managers: false },
  },
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Немає ANTHROPIC_API_KEY. Скопіюй .env.example у .env і впиши ключ.');
  process.exit(1);
}

const client = new Anthropic();
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};

function save() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

try {
  if (!state.environment_id) {
    const env = await client.beta.environments.create(ENVIRONMENT);
    state.environment_id = env.id;
    save(); // зберігаємо одразу: якщо агент упаде, друге середовище не створиться
    console.log(`Середовище створено: ${env.id}`);
  } else {
    console.log(`Середовище вже є: ${state.environment_id}`);
  }

  if (!state.agent_id) {
    const agent = await client.beta.agents.create(AGENT);
    Object.assign(state, { agent_id: agent.id, agent_version: agent.version });
    save();
    console.log(`Агента створено: ${agent.id}, версія ${agent.version}`);
  } else {
    // version = оптимістичне блокування: якщо агента змінили деінде, оновлення
    // відмовить, і чужі правки не перезапишуться мовчки.
    const agent = await client.beta.agents.update(state.agent_id, { ...AGENT, version: state.agent_version });
    const changed = agent.version !== state.agent_version;
    state.agent_version = agent.version;
    save();
    console.log(changed
      ? `Агента оновлено: ${agent.id}, нова версія ${agent.version}`
      : `Агент ${agent.id} без змін, версія ${agent.version}`);
  }
  console.log(`Інструментів: ${TOOL_DEFS.length} (${TOOL_DEFS.map((t) => t.name).join(', ')})`);
  console.log(`ID записано в ${path.relative(process.cwd(), STATE_FILE) || 'agent.json'}`);
} catch (e) {
  if (e instanceof Anthropic.APIError) {
    console.error(`API ${e.status}: ${e.message}`);
    if (e.status === 409 || /version/i.test(e.message)) {
      console.error('Схоже, агента змінили поза setup.mjs. Звір конфіг і онови agent_version в agent.json вручну.');
    }
  } else {
    console.error(e);
  }
  process.exit(1);
}
