import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IsaCriteriaEditor } from "./IsaCriteriaEditor.js";
import type { CriterionEntry } from "./IsaCriteriaEditor.js";

const AUTO: CriterionEntry = {
  id: "c1",
  kind: "auto",
  text: "All tests pass",
  rule: "pnpm test --run",
};

const HUMAN: CriterionEntry = {
  id: "c2",
  kind: "human",
  text: "Design approved",
  note: "Review the UI",
};

describe("IsaCriteriaEditor", () => {
  it("renders all criteria text, rule, and note", () => {
    const html = renderToStaticMarkup(
      <IsaCriteriaEditor
        criteria={[AUTO, HUMAN]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(html).toContain("All tests pass");
    expect(html).toContain("Design approved");
    expect(html).toContain("pnpm test --run");
    expect(html).toContain("Review the UI");
  });

  it("renders the add row with the addLabel", () => {
    const html = renderToStaticMarkup(
      <IsaCriteriaEditor
        criteria={[AUTO]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        addLabel="Adicionar critério"
      />,
    );
    expect(html).toContain("Adicionar critério");
  });
});
