import { describe, expect, it } from "vitest";
import type { BusinessPlanOption } from "@prospero/shared";
import {
  formatChargeItem,
  resolveChosenOption,
  marketingChips,
} from "./businessPlanReview.helpers.js";

// ── formatChargeItem ─────────────────────────────────────────────────────────

describe("formatChargeItem", () => {
  const opts = { perMonth: "/mês", perYear: "/ano" };

  it("formats a monthly BRL subscription with whole number amount", () => {
    expect(
      formatChargeItem(
        { name: "A", description: "", amount: 1900, currency: "brl", interval: "month" },
        opts,
      ),
    ).toBe("R$ 19/mês");
  });

  it("formats a yearly BRL subscription with cents", () => {
    expect(
      formatChargeItem(
        { name: "A", description: "", amount: 9999, currency: "brl", interval: "year" },
        opts,
      ),
    ).toBe("R$ 99.99/ano");
  });

  it("formats a one-time BRL charge (no interval)", () => {
    expect(
      formatChargeItem({ name: "A", description: "", amount: 9700, currency: "brl" }, opts),
    ).toBe("R$ 97");
  });

  it("formats a USD monthly subscription", () => {
    expect(
      formatChargeItem(
        { name: "A", description: "", amount: 999, currency: "usd", interval: "month" },
        opts,
      ),
    ).toBe("USD 9.99/mês");
  });

  it("uses currency code prefix for non-BRL currencies", () => {
    expect(
      formatChargeItem({ name: "A", description: "", amount: 500, currency: "eur" }, opts),
    ).toBe("EUR 5");
  });

  it("handles amounts that result in .00 as whole number", () => {
    expect(
      formatChargeItem({ name: "A", description: "", amount: 5000, currency: "brl" }, opts),
    ).toBe("R$ 50");
  });
});

// ── resolveChosenOption ───────────────────────────────────────────────────────

const makeOption = (name: string): BusinessPlanOption => ({
  concept: "c",
  monetization: [],
  pricing: null,
  research: null,
  ownerProfile: null,
  marketing: { initialChannel: "x", tactics: [], laterChannels: "" },
  identity: { name, voice: "v", proposedXHandle: "@h" },
  dropped: [],
  recommended: false,
  whyRecommended: "",
  signals: { market: 50, virality: 50, community: 50, revenue12m: "R$ 1k" },
  projection: { month3: "R$ 300", month6: "R$ 600", month12: "R$ 1.200", assumption: "Assume X" },
});

describe("resolveChosenOption", () => {
  it("returns the option at the chosen index", () => {
    const opts = [makeOption("A"), makeOption("B"), makeOption("C")];
    const result = resolveChosenOption(opts, 1);
    expect(result?.identity.name).toBe("B");
  });

  it("returns null when options is null", () => {
    expect(resolveChosenOption(null, 0)).toBeNull();
  });

  it("returns null when chosenIndex is null", () => {
    expect(resolveChosenOption([makeOption("A")], null)).toBeNull();
  });

  it("returns null when index is out of range (too high)", () => {
    expect(resolveChosenOption([makeOption("A")], 5)).toBeNull();
  });

  it("returns null when index is negative", () => {
    expect(resolveChosenOption([makeOption("A")], -1)).toBeNull();
  });

  it("returns the first option at index 0", () => {
    const opts = [makeOption("First"), makeOption("Second")];
    expect(resolveChosenOption(opts, 0)?.identity.name).toBe("First");
  });
});

// ── marketingChips ────────────────────────────────────────────────────────────

describe("marketingChips", () => {
  it("returns non-empty tactics", () => {
    expect(marketingChips(["Threads", "Templates grátis", "Antes/depois"])).toEqual([
      "Threads",
      "Templates grátis",
      "Antes/depois",
    ]);
  });

  it("filters out empty strings", () => {
    expect(marketingChips(["A", "", "  ", "B"])).toEqual(["A", "B"]);
  });

  it("returns empty array for empty input", () => {
    expect(marketingChips([])).toEqual([]);
  });
});
