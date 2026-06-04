import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BusinessPlanOption } from "@prospero/shared";
import { BusinessPlanOptions } from "./BusinessPlanOptions.js";

// Render-safety + I8: the chooser must render every option shape (including ones with
// and without a discard list) without crashing, and surface the "Descartei N" toggle
// (INV-2's viability filter) when there are dropped ideas. renderToStaticMarkup throws
// if any child throws.

const option = (over: Partial<BusinessPlanOption> = {}): BusinessPlanOption =>
  ({
    recommended: false,
    whyRecommended: "",
    concept: "Um micro-SaaS que organiza lançamentos para criadores.",
    monetization: ["assinatura mensal"],
    marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "" },
    identity: { name: "LaunchPad", voice: "direto", proposedXHandle: "@launchpad" },
    dropped: [
      { idea: "e-book", reason: "exige design humano" },
      { idea: "loja física", reason: "não automatiza" },
    ],
    signals: { market: 72, virality: 61, community: 80, revenue12m: "R$ 1.000/mês" },
    projection: { month3: "R$ 100", month6: "R$ 400", month12: "R$ 1.000", assumption: "2%" },
    ...over,
  }) as unknown as BusinessPlanOption;

const render = (options: BusinessPlanOption[]) =>
  renderToStaticMarkup(<BusinessPlanOptions options={options} />);

describe("BusinessPlanOptions — render safety + discard disclosure (I8)", () => {
  it("renders the 3-option chooser without crashing", () => {
    const html = render([
      option({ recommended: true, whyRecommended: "maior mercado" }),
      option({ identity: { name: "B", voice: "x", proposedXHandle: "@b" } }),
      option({ identity: { name: "C", voice: "y", proposedXHandle: "@c" } }),
    ]);
    expect(html).toContain("LaunchPad");
  });

  it("shows the discard toggle when an option has dropped ideas (INV-2)", () => {
    const html = render([option({ recommended: true })]);
    // i18n is not initialized in tests → the key echoes; either way the toggle renders.
    expect(html).toContain("droppedToggle");
    expect(html).toContain("aria-expanded");
  });

  it("omits the discard toggle when there are no dropped ideas", () => {
    const html = render([option({ recommended: true, dropped: [] })]);
    expect(html).not.toContain("droppedToggle");
  });

  it("survives an option missing the dropped array entirely (legacy row)", () => {
    const legacy = option({ recommended: true });
    // simulate a hand-edited/legacy row with no dropped field
    delete (legacy as { dropped?: unknown }).dropped;
    expect(() => render([legacy])).not.toThrow();
  });
});
