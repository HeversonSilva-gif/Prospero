// Relative cost tier for the ModelDropdown hint chip. v1 is hard-coded
// against the 3 Claude 4.x presets the pricing table covers. Future models
// fall back to "unknown" (no chip shown).

export type CostTier = "cheap" | "medium" | "expensive" | "unknown";

export type CostTierInfo = {
  tier: CostTier;
  symbol: "" | "$" | "$$" | "$$$";
};

const TIER_BY_MODEL: Record<string, CostTier> = {
  "claude-haiku-4-5-20251001": "cheap",
  "claude-sonnet-4-6": "medium",
  "claude-opus-4-7": "expensive",
  // Audit 2026-06-03 Inteligência & Contexto M3: Opus 4.8 (the CEO model) had
  // no chip entry → the most expensive model showed the weakest cost signal.
  "claude-opus-4-8": "expensive",
};

const SYMBOL_BY_TIER: Record<CostTier, CostTierInfo["symbol"]> = {
  cheap: "$",
  medium: "$$",
  expensive: "$$$",
  unknown: "",
};

export const categorizeCostTier = (model: string): CostTierInfo => {
  // Match exact, then retry with a trailing -YYYYMMDD date suffix stripped, so a
  // dated id the CLI may echo (claude-opus-4-8-20260601) still maps to its tier
  // while the intentionally-dated haiku key hits exactly. Audit 2026-06-03 C2/M3.
  const tier = TIER_BY_MODEL[model] ?? TIER_BY_MODEL[model.replace(/-\d{8}$/, "")] ?? "unknown";
  return { tier, symbol: SYMBOL_BY_TIER[tier] };
};
