import { describe, expect, it } from "vitest";
import type { BusinessPlanOption } from "@prospero/shared";
import {
  signalToPercent,
  findRecommendedIndex,
  signalLabel,
} from "./businessPlanOptions.helpers.js";

describe("signalToPercent", () => {
  it("converts 0 to 0%", () => {
    expect(signalToPercent(0)).toBe("0%");
  });
  it("converts 100 to 100%", () => {
    expect(signalToPercent(100)).toBe("100%");
  });
  it("converts 85 to 85%", () => {
    expect(signalToPercent(85)).toBe("85%");
  });
  it("clamps values above 100", () => {
    expect(signalToPercent(150)).toBe("100%");
  });
  it("clamps negative values to 0%", () => {
    expect(signalToPercent(-5)).toBe("0%");
  });
  it("rounds decimals", () => {
    expect(signalToPercent(72.7)).toBe("73%");
  });
});

describe("findRecommendedIndex", () => {
  const makeOption = (recommended: boolean): BusinessPlanOption => ({
    concept: "c",
    monetization: [],
    pricing: null,
    research: null,
    ownerProfile: null,
    marketing: { initialChannel: "x", tactics: [], laterChannels: "" },
    identity: { name: "N", voice: "v", proposedXHandle: "@h" },
    dropped: [],
    recommended,
    whyRecommended: "",
    signals: { market: 50, virality: 50, community: 50, revenue12m: "R$ 1k" },
    projection: { month3: "300", month6: "600", month12: "1200", assumption: "" },
  });

  it("returns index 0 when first option is recommended", () => {
    expect(findRecommendedIndex([makeOption(true), makeOption(false)])).toBe(0);
  });
  it("returns index 1 when second option is recommended", () => {
    expect(findRecommendedIndex([makeOption(false), makeOption(true)])).toBe(1);
  });
  it("returns -1 when no option is recommended", () => {
    expect(findRecommendedIndex([makeOption(false), makeOption(false)])).toBe(-1);
  });
  it("returns the first match if multiple are marked recommended", () => {
    expect(findRecommendedIndex([makeOption(true), makeOption(true)])).toBe(0);
  });
});

describe("signalLabel", () => {
  it("community: >=88 = Muito forte", () => {
    expect(signalLabel("community", 92)).toBe("Muito forte");
  });
  it("community: >=75 = Forte", () => {
    expect(signalLabel("community", 82)).toBe("Forte");
  });
  it("community: >=55 = Média", () => {
    expect(signalLabel("community", 60)).toBe("Média");
  });
  it("community: <55 = Fraca", () => {
    expect(signalLabel("community", 40)).toBe("Fraca");
  });
  it("market: >=80 = Alta", () => {
    expect(signalLabel("market", 85)).toBe("Alta");
  });
  it("virality: >=63 = Média-alta", () => {
    expect(signalLabel("virality", 63)).toBe("Média-alta");
  });
  it("market: <35 = Baixa", () => {
    expect(signalLabel("market", 20)).toBe("Baixa");
  });
});
