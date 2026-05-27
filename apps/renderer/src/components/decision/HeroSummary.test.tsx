import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroSummary } from "./HeroSummary.js";

const stats = [
  { label: "Papéis", value: "3" },
  { label: "A contratar", value: "5" },
];

describe("HeroSummary", () => {
  it("renders all stat labels and values", () => {
    const html = renderToStaticMarkup(<HeroSummary variant="brand" stats={stats} />);
    expect(html).toContain("Papéis");
    expect(html).toContain("3");
    expect(html).toContain("A contratar");
    expect(html).toContain("5");
  });

  it("brand variant applies border-l-brand class", () => {
    const html = renderToStaticMarkup(<HeroSummary variant="brand" stats={stats} />);
    expect(html).toContain("border-l-brand");
  });

  it("goal variant applies border-l-semantic-warning class", () => {
    const html = renderToStaticMarkup(<HeroSummary variant="goal" stats={stats} />);
    expect(html).toContain("border-l-semantic-warning");
  });
});
