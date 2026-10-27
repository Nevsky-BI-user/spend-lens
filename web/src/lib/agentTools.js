// Виконавці custom tools агента spend-lens. Рахують тими самими функціями,
// що й вкладки, тому агент не може назвати число, якого немає на екрані.
// Агенту йдуть лише агрегати: без projectPath і digest сесій.
import {
  filterSnapshot, lastDay, computeKpis, costByProject, costByModel,
  mainVsSidechain, cacheEconomics, analyzeSessions, computeFactors, buildRecommendations,
} from './analytics.js';

// Аргументи інструмента -> той самий зріз, що дають фільтри в шапці дашборду.
function slice(snapshot, input) {
  return filterSnapshot(snapshot, {
    period: input.period_days ?? 0,
    project: input.project ?? null,
    day: input.day ?? null,
  });
}

const RUNNERS = {
  get_spend_summary(snapshot, input) {
    const s = slice(snapshot, input);
    // KPI-картки «Огляду» беруть лише фільтр проєкту: вікна «тиждень», «місяць»
    // відраховуються від останнього дня снапшота, а не від обраного періоду.
    const kpiDays = filterSnapshot(snapshot, { period: 0, project: input.project ?? null }).days;
    return {
      kpis: computeKpis(kpiDays, lastDay(snapshot.days || [])),
      byProject: costByProject(s.days, 0),
      byModel: costByModel(s.days, 0),
      mainVsSidechain: mainVsSidechain(s.days, 0),
      cache: cacheEconomics(s.days, s.pricingUsed, 0),
    };
  },

  get_top_sessions(snapshot, input) {
    const limit = Math.min(20, Math.max(1, input.limit ?? 10));
    // flagged уже відсортовано за вартістю, від найдорожчої.
    const { flagged } = analyzeSessions(slice(snapshot, input));
    return flagged.slice(0, limit).map(({ session: s, flags }) => ({
      title: s.title,
      project: s.project,
      startedAt: s.startedAt,
      sidechain: s.sidechain,
      costUsd: s.totals.costUsd,
      models: Object.keys(s.models || {}),
      assistantTurns: s.assistantTurns,
      avgContext: s.avgContext,
      maxContext: s.maxContext,
      cacheHitRate: s.cacheHitRate,
      flags: flags.map((f) => ({ type: f.type, wasteUsd: f.wasteUsd, evidence: f.evidence })),
    }));
  },

  get_cost_factors(snapshot, input) {
    const s = slice(snapshot, input);
    return {
      factors: computeFactors(s),
      recommendations: buildRecommendations(s).slice(0, 5),
    };
  },
};

// Повертає { text, isError }: text іде агенту як результат інструмента.
export function runAgentTool(snapshot, name, input) {
  const run = RUNNERS[name];
  if (!run) return { text: `Невідомий інструмент: ${name}`, isError: true };
  try {
    return { text: JSON.stringify(run(snapshot, input || {})), isError: false };
  } catch (e) {
    return { text: `Помилка інструмента ${name}: ${e?.message ?? e}`, isError: true };
  }
}