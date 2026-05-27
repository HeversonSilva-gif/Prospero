import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionModal } from "./DecisionModal.js";

const noop = (): void => {};

describe("DecisionModal", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <DecisionModal
        open={false}
        onClose={noop}
        header={<span>header</span>}
        sections={[]}
        actions={<span>actions</span>}
      />,
    );
    expect(html).toBe("");
  });

  it("renders slot content when open", () => {
    const html = renderToStaticMarkup(
      <DecisionModal
        open={true}
        onClose={noop}
        header={<span>modal-header</span>}
        sections={[<p key="s">modal-section</p>]}
        actions={<span>modal-actions</span>}
      />,
    );
    expect(html).toContain("modal-header");
    expect(html).toContain("modal-section");
    expect(html).toContain("modal-actions");
  });
});
