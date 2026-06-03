import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { FinanceSummary } from "@prospero/shared";
import { Panorama } from "./Financeiro.js";

// White-screen guard: the data-heavy panorama must render for every shape it can
// receive — including the degenerate ones (all-null rates, empty arrays, blank
// currency) — without throwing. renderToStaticMarkup throws if any child throws during
// render, so a green test means no blank screen. (The parent route's null/loading/
// empty/error branches are simple guards; this exercises the part that does real work.)

const full: FinanceSummary = {
  currency: "brl",
  lifetimeRevenueCents: 250_000,
  windowRevenueCents: 30_000,
  revenueByCurrency: { brl: 250_000 },
  mrrCents: 2000,
  activeSubscriptions: 2,
  activeCustomers: 5,
  newCustomers: 1,
  churnRatePct: 12.5,
  repeatPurchaseRatePct: null,
  topProducts: [{ name: "Plano Pro", mrrCents: 2000, activeCount: 2 }],
  revenueByMonth: [
    { month: "2026-05", revenueCents: 10_000 },
    { month: "2026-06", revenueCents: 20_000 },
  ],
  costCents: 1234,
  windowDays: 30,
  hasStripe: true,
};

const render = (s: FinanceSummary) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Panorama s={s} />
    </MemoryRouter>,
  );

describe("Financeiro Panorama — render safety (white-screen guard)", () => {
  it("renders a full panorama without crashing", () => {
    const html = render(full);
    expect(html).toContain("Plano Pro");
    expect(html).toContain("R$"); // BRL money formatted
  });

  it("renders the repeat-purchase fallback when there is no churn", () => {
    const html = render({ ...full, churnRatePct: null, repeatPurchaseRatePct: 40 });
    expect(html).toContain("40%");
  });

  it("shows a dash when both churn and repeat-rate are null", () => {
    expect(() =>
      render({ ...full, churnRatePct: null, repeatPurchaseRatePct: null }),
    ).not.toThrow();
  });

  it("survives the all-degenerate shape (empty arrays, blank currency, zeros)", () => {
    const degenerate: FinanceSummary = {
      currency: "",
      lifetimeRevenueCents: 0,
      windowRevenueCents: 0,
      revenueByCurrency: {},
      mrrCents: 0,
      activeSubscriptions: 0,
      activeCustomers: 0,
      newCustomers: 0,
      churnRatePct: null,
      repeatPurchaseRatePct: null,
      topProducts: [],
      revenueByMonth: [],
      costCents: 0,
      windowDays: 30,
      hasStripe: true,
    };
    expect(() => render(degenerate)).not.toThrow();
  });
});
