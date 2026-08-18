// Пороги та коефіцієнти правил аналізу. Усі значення можна тюнити без
// перезбирання снапшота — аналітика рахується на клієнті (analytics.js).

export const RULES = {
  // CACHE_MISS: кеш-хіт нижче порога І сесія коштує понад мінімум
  CACHE_MISS: {
    maxHitRate: 0.6,        // cacheHitRate < 0.6
    minCostUsd: 1,          // costUsd > $1
    realisticFactor: 0.5,   // реалістичний коефіцієнт оцінки втрат
  },

  // FAT_CONTEXT: середній контекст на хід понад поріг
  FAT_CONTEXT: {
    maxAvgContext: 120_000, // avgContext > 120k
    baselineContext: 60_000,// «здоровий» базовий контекст
  },

  // LONG_SESSION: занадто багато ходів асистента без /clear
  LONG_SESSION: {
    maxAssistantTurns: 300, // assistantTurns > 300
    wasteShare: 0.15,       // евристична частка вартості сесії, що вважається перевитратою
  },

  // PREMIUM_MODEL: надбавка преміум-моделі проти sonnet понад поріг
  PREMIUM_MODEL: {
    minPremiumUsd: 3,       // costUsd − costIfSonnet > $3
    sonnetPricing: { input: 3, output: 15, cacheRead: 0.3 }, // USD/MTok
  },

  // SUBAGENT_HEAVY: рівень проєкту — частка витрат сабчейнів
  SUBAGENT_HEAVY: {
    minShare: 0.5,          // > 50 % витрат проєкту
    minCostUsd: 2,          // і понад $2
    wasteShare: 0.25,       // евристична частка сабчейн-витрат, що вважається перевитратою
  },

  // TOP_BURNER: сесія дорожча за p90
  TOP_BURNER: {
    percentile: 0.9,
  },
};

// Пороги severity для карток рекомендацій (за оцінкою втрат, USD)
export const SEVERITY = {
  high: 10,   // 🔴 > $10
  medium: 3,  // 🟠 > $3  (інакше 🟡)
};

// Кольори прапорців (iOS-акценти) — використовуються чіпами та графіком факторів
// label — чіп однієї сесії; labelAgg — агрегована назва фактора (вкладка «Фактори»)
export const FLAG_META = {
  CACHE_MISS:     { label: 'Кеш-промахи',       labelAgg: 'Кеш-промахи',       color: '#FF9500' }, // orange
  FAT_CONTEXT:    { label: 'Роздутий контекст', labelAgg: 'Роздутий контекст', color: '#AF52DE' }, // purple
  PREMIUM_MODEL:  { label: 'Дорога модель',     labelAgg: 'Дорога модель',     color: '#FF3B30' }, // red
  LONG_SESSION:   { label: 'Наддовга сесія',    labelAgg: 'Наддовгі сесії',    color: '#5856D6' }, // indigo
  SUBAGENT_HEAVY: { label: 'Субагенти',         labelAgg: 'Субагенти',         color: '#32ADE6' }, // teal
  TOP_BURNER:     { label: 'Найдорожча сесія',  labelAgg: 'Найдорожчі сесії',  color: '#8E8E93' }, // gray
};
