import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { BusinessPlan, BusinessPlanOption } from "@prospero/shared";
import { BusinessPlanReview } from "./BusinessPlanReview.js";
import { useBusinessPlanStore } from "../stores/businessPlan.js";

// pricing / research / ownerProfile are `.optional()` in the schema, so when the
// AI omits them they are ABSENT (undefined) in the stored JSON — not null. The
// genesis "ver plano completo" screen guarded them with `!== null`, which
// `undefined` passes → it then read `.items` / `.competitors` / `.trim()` on
// undefined → TypeError → blank screen (no ErrorBoundary). These fixtures carry
// every REQUIRED field but omit the three optional ones, reproducing that shape.
const commonRequired = {
  concept: "Uma ferramenta SaaS para criadores organizarem seus lançamentos.",
  monetization: ["assinatura mensal"],
  marketing: { initialChannel: "x", tactics: ["threads diárias"], laterChannels: "" },
  identity: { name: "LaunchPad", voice: "direto e prático", proposedXHandle: "@launchpad" },
  dropped: [],
  // pricing, research, ownerProfile intentionally ABSENT (undefined)
};

const option = {
  ...commonRequired,
  recommended: true,
  whyRecommended: "Maior mercado e o que a equipe entrega sozinha.",
  signals: { market: 72, virality: 61, community: 80, revenue12m: "R$ 1.000/mês" },
  projection: {
    month3: "R$ 100",
    month6: "R$ 400",
    month12: "R$ 1.000",
    assumption: "Conversão 2%",
  },
} as unknown as BusinessPlanOption;

// A fully-formed flat plan (so the legacy path doesn't crash on missing flat
// fields) carrying the same option — isolates the crash to the optional-field guards.
const plan = {
  id: "bp1",
  ...commonRequired,
  options: [option],
} as unknown as BusinessPlan;

describe("BusinessPlanReview — option with absent optional fields (white-screen repro)", () => {
  it("renders the enriched chosen-option view without crashing", () => {
    useBusinessPlanStore.setState({ chosenIndex: 0, plan });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BusinessPlanReview plan={plan} />
      </MemoryRouter>,
    );
    expect(html).toContain("LaunchPad");
  });

  it("renders the legacy flat-plan view without crashing", () => {
    useBusinessPlanStore.setState({ chosenIndex: null, plan });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BusinessPlanReview plan={plan} />
      </MemoryRouter>,
    );
    expect(html).toContain("LaunchPad");
  });
});
