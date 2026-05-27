import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueCriteriaVerified } from "./IssueCriteriaVerified.js";
import type { CriterionResult } from "./IssueCriteriaVerified.js";

const C_PASS: CriterionResult = { id: "c1", text: "All tests pass", result: "pass" };
const C_FAIL: CriterionResult = { id: "c2", text: "No regressions", result: "fail" };
const C_AUTO: CriterionResult = { id: "c3", text: "Auto check pending", result: "pending-auto" };
const C_HUMAN: CriterionResult = { id: "c4", text: "Human review needed", result: "pending-human" };

describe("IssueCriteriaVerified", () => {
  it("renders one row per criterion with criterion text", () => {
    const html = renderToStaticMarkup(
      <IssueCriteriaVerified criteria={[C_PASS, C_FAIL, C_AUTO, C_HUMAN]} />,
    );
    expect(html).toContain("All tests pass");
    expect(html).toContain("No regressions");
    expect(html).toContain("Auto check pending");
    expect(html).toContain("Human review needed");
  });

  it("pass result shows success classes and check mark", () => {
    const html = renderToStaticMarkup(<IssueCriteriaVerified criteria={[C_PASS]} />);
    expect(html).toContain("bg-semantic-success-bg");
    expect(html).toContain("text-semantic-success");
    expect(html).toContain("✓");
  });

  it("fail result shows danger classes and cross mark", () => {
    const html = renderToStaticMarkup(<IssueCriteriaVerified criteria={[C_FAIL]} />);
    expect(html).toContain("bg-semantic-danger-bg");
    expect(html).toContain("✗");
  });

  it("pending-human tag says Você decide", () => {
    const html = renderToStaticMarkup(<IssueCriteriaVerified criteria={[C_HUMAN]} />);
    expect(html).toContain("Você decide");
  });

  it("pending-auto tag says Auto", () => {
    const html = renderToStaticMarkup(<IssueCriteriaVerified criteria={[C_AUTO]} />);
    expect(html).toContain("Auto");
  });
});
