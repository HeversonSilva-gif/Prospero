import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionPage } from "./DecisionPage.js";

describe("DecisionPage", () => {
  it("renders all slot content", () => {
    const html = renderToStaticMarkup(
      <DecisionPage
        header={<span>header-slot</span>}
        sections={[<p key="s1">section-content</p>]}
        actions={<span>actions-slot</span>}
      />,
    );
    expect(html).toContain("header-slot");
    expect(html).toContain("section-content");
    expect(html).toContain("actions-slot");
  });
});
