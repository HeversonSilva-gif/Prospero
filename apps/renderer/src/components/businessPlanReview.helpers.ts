import type { BusinessPlanOption, ChargeItem } from "@prospero/shared";

/**
 * Format a ChargeItem amount (stored in smallest currency unit, e.g. cents)
 * as a human-readable price string with the interval suffix when recurring.
 *
 * Examples:
 *   { amount: 1900, currency: "brl", interval: "month" } → "R$ 19,00/mês"
 *   { amount: 9700, currency: "brl" }                   → "R$ 97,00"
 *   { amount: 1999, currency: "usd", interval: "year" }  → "USD 19,99/yr"
 */
export function formatChargeItem(
  item: ChargeItem,
  opts: {
    perMonth: string;
    perYear: string;
  },
): string {
  const major = item.amount / 100;
  const formatted = major % 1 === 0 ? major.toFixed(0) : major.toFixed(2);
  const currencyPrefix = item.currency.toLowerCase() === "brl" ? "R$" : item.currency.toUpperCase();
  const base = `${currencyPrefix} ${formatted}`;
  if (item.interval === "month") return `${base}${opts.perMonth}`;
  if (item.interval === "year") return `${base}${opts.perYear}`;
  return base;
}

/**
 * Given a plan options array (typed as unknown[] from the BusinessPlan store)
 * and a chosen index, return the chosen option cast to BusinessPlanOption,
 * or null if the array is missing, empty, or the index is out of range.
 */
export function resolveChosenOption(
  options: unknown[] | null,
  chosenIndex: number | null,
): BusinessPlanOption | null {
  if (options === null || chosenIndex === null) return null;
  if (chosenIndex < 0 || chosenIndex >= options.length) return null;
  return options[chosenIndex] as BusinessPlanOption;
}

/**
 * Split a marketing tactics array into an initial "X" portion and a later-channels
 * string. In the options flow, the marketing object is the same flat shape; we just
 * need the tactics as chips and the laterChannels label.
 */
export function marketingChips(tactics: string[]): string[] {
  return tactics.filter((t) => t.trim() !== "");
}
