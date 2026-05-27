import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionHeader } from "./DecisionHeader.js";

const defaultProps = {
  chip: { variant: "brand" as const, label: "Plano de org" },
  meta: "CEO · há 4 min",
  title: "Novo time de produto",
};

describe("DecisionHeader", () => {
  it("renders chip label, meta and title", () => {
    const html = renderToStaticMarkup(<DecisionHeader {...defaultProps} />);
    expect(html).toContain("Plano de org");
    expect(html).toContain("CEO · há 4 min");
    expect(html).toContain("Novo time de produto");
  });

  it("default mode renders h1 with text-2xl", () => {
    const html = renderToStaticMarkup(<DecisionHeader {...defaultProps} />);
    expect(html).toContain("text-2xl");
  });

  it("compact mode renders h1 with text-xl", () => {
    const html = renderToStaticMarkup(<DecisionHeader {...defaultProps} compact />);
    expect(html).toContain("text-xl");
  });
});
