// Money formatting for the Financeiro screen. Stripe amounts are in the smallest
// currency unit (cents); the currency code comes from the data so a BRL business shows
// R$ and a USD one shows $. Falls back gracefully for unknown codes.

const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp"]); // Stripe zero-decimal currencies

export const formatMoney = (amountMinor: number, currency: string): string => {
  const code = (currency || "brl").toUpperCase();
  const zeroDecimal = ZERO_DECIMAL.has(currency.toLowerCase());
  const value = zeroDecimal ? amountMinor : amountMinor / 100;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
  } catch {
    // Unknown / malformed currency code → plain number with the raw code.
    return `${code} ${value.toFixed(zeroDecimal ? 0 : 2)}`;
  }
};

// USD cents → "$x.xx" (Claude cost is billed in USD).
export const formatUsdCents = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, cents) / 100);

// "YYYY-MM" → "mmm/yy" (e.g. "2026-06" → "jun/26") for chart axes.
const MONTHS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
export const formatMonthLabel = (yyyymm: string): string => {
  const [y, m] = yyyymm.split("-");
  const idx = Number.parseInt(m ?? "1", 10) - 1;
  const mon = MONTHS_PT[idx] ?? m ?? "";
  return `${mon}/${(y ?? "").slice(2)}`;
};
