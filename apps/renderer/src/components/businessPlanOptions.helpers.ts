import type { BusinessPlanOption, BusinessSignals } from "@prospero/shared";

/**
 * Clamp a signal score (0-100) and convert it to a CSS percentage string
 * suitable for a width style or similar bar-fill use.
 */
export function signalToPercent(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return `${clamped}%`;
}

/**
 * Return the 0-based index of the recommended option, or -1 if none is marked.
 */
export function findRecommendedIndex(options: BusinessPlanOption[]): number {
  return options.findIndex((o) => o.recommended);
}

/**
 * Return the score-to-label mapping for a given signal score.
 * Labels match the mockup Portuguese text used by the CEO.
 */
export function signalLabel(
  dimension: keyof Omit<BusinessSignals, "revenue12m">,
  score: number,
): string {
  if (dimension === "community") {
    if (score >= 88) return "Muito forte";
    if (score >= 75) return "Forte";
    if (score >= 55) return "Média";
    return "Fraca";
  }
  // market + virality share the same scale
  if (score >= 80) return "Alta";
  if (score >= 63) return "Média-alta";
  if (score >= 48) return "Média";
  if (score >= 35) return "Médio-grande";
  return "Baixa";
}
