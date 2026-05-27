import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionActions } from "./DecisionActions.js";

const noop = (): void => {};

describe("DecisionActions", () => {
  it("renders default button labels", () => {
    const html = renderToStaticMarkup(<DecisionActions onApprove={noop} onReject={noop} />);
    expect(html).toContain("Aprovar e executar");
    expect(html).toContain("Rejeitar");
  });

  it("renders custom approve label", () => {
    const html = renderToStaticMarkup(
      <DecisionActions onApprove={noop} onReject={noop} approveLabel="Executar agora" />,
    );
    expect(html).toContain("Executar agora");
  });

  it("renders estimate labels and values", () => {
    const html = renderToStaticMarkup(
      <DecisionActions
        onApprove={noop}
        onReject={noop}
        estimates={[{ label: "Custo", value: "~$2.50" }]}
      />,
    );
    expect(html).toContain("Custo");
    expect(html).toContain("~$2.50");
  });
});
