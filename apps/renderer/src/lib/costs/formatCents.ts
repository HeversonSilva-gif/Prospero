// USD only in v1 (spec §12 R7 — câmbio dinâmico = v2).

export const formatCents = (cents: number): string => {
  const safe = Math.max(0, cents);
  const dollars = safe / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
};

export const formatTokens = (tokens: number): string => {
  const safe = Math.max(0, tokens);
  if (safe < 1000) return String(safe);
  if (safe < 1_000_000) return `${(safe / 1000).toFixed(1)}k`;
  return `${(safe / 1_000_000).toFixed(1)}M`;
};
