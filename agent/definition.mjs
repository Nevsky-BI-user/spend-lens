// Опис агента spend-lens. Будь-яка зміна тут доходить до API через setup.mjs,
// і кожна реальна зміна дає нову версію агента.

// Зріз даних: ті самі параметри, що в глобальних фільтрах дашборду (filterSnapshot).
const SLICE = {
  period_days: {
    type: "integer",
    minimum: 0,
    description: "Скільки останніх днів снапшота брати: 7, 30 тощо. 0 означає увесь час.",
  },
  project: {
    type: "string",
    description: "Назва проєкту рівно як у дашборді. Не вказуй, якщо потрібні всі проєкти.",
  },
  day: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Один день YYYY-MM-DD. Перевизначає period_days.",
  },
};

export const ENVIRONMENT = {
  name: "spend-lens-env",
  config: {
    type: "cloud",
    // limited без allowed_hosts: жодного виходу в мережу.
    // Якщо networking пропустити, API створить unrestricted.
    networking: { type: "limited" },
  },
};

export const AGENT = {
  name: "spend-lens analyst",
  description: "Відповідає на питання про витрати Claude Code за даними spend-lens.",
  model: { id: "claude-opus-5-5", effort: "medium" },
  system: [
    "Ти аналітик витрат на Claude Code у дашборді spend-lens.",
    "Відповідай українською, коротко: спершу відповідь, потім пояснення.",
    "Кожне число бери лише з результатів інструментів. Не рахуй у голові і не вигадуй:",
    "якщо потрібного числа немає в жодному інструменті, так і скажи.",
    "Суми в доларах США, як у дашборді.",
    "Не вживай тире (\u2014 і \u2013): замість них двокрапка, кома або дефіс.",
    "Коли радиш, як зменшити витрати, додай готовий промпт українською для Claude Code у блоці коду.",
    "У тебе є лише агрегати за днями, проєктами, моделями й сесіями. Текстів переписки немає.",
  ].join("\n"),
  // Лише custom tools: їх виконує наш застосунок (функції web/src/lib/analytics.js),
  // а не пісочниця Anthropic. Вбудованого agent_toolset тут немає взагалі.
  tools: [
    {
      type: "custom",
      name: "get_spend_summary",
      description:
        "Підсумок витрат за зріз: KPI (сьогодні, тиждень, місяць, разом), розклад за проєктами " +
        "і моделями, основні сесії проти субагентів, економіка кешу. Ті самі числа, що на вкладці «Огляд».",
      input_schema: { type: "object", properties: { ...SLICE } },
    },
    {
      type: "custom",
      name: "get_top_sessions",
      description:
        "Найдорожчі сесії зрізу: назва, проєкт, вартість, моделі, контекст, кеш-хіт і прапорці " +
        "перевитрати. Ті самі дані, що на вкладці «Сесії».",
      input_schema: {
        type: "object",
        properties: {
          ...SLICE,
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Скільки сесій. Типово 10." },
        },
      },
    },
    {
      type: "custom",
      name: "get_cost_factors",
      description:
        "Фактори перевитрати з оцінкою втрат у доларах і рекомендації. Ті самі дані, що на вкладках " +
        "«Фактори» і «Дії».",
      input_schema: { type: "object", properties: { ...SLICE } },
    },
  ],
  metadata: { project: "spend-lens" },
};