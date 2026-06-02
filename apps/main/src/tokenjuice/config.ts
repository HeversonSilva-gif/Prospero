// TokenJuice configuration. Fase 1 uses a GENEROUS budget on purpose — only
// genuinely large payloads get clamped, while instrumentation measures real
// sizes. Fase 2 tightens budgets per-tool from the measured offenders.

const envFlag = (name: string, dflt: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined) return dflt;
  return !(v === "0" || v.toLowerCase() === "false");
};

export const tokenjuiceConfig = {
  enabled: envFlag("PROSPERO_TOKENJUICE", true),
  defaultBudgetChars: 12_000, // ~3k tokens
  perToolBudgetChars: {} as Record<string, number>,
  maxFieldChars: 800,
  maxArrayItems: 20,
  minSize: 512,
  minReductionRatio: 0.05, // skip clamping if it would save < 5%
};

export const budgetFor = (toolName: string): number =>
  tokenjuiceConfig.perToolBudgetChars[toolName] ?? tokenjuiceConfig.defaultBudgetChars;
