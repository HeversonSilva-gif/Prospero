import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip } from "./Chip.js";

describe("Chip", () => {
  it("renders children text", () => {
    const html = renderToStaticMarkup(<Chip variant="brand">Plano de org</Chip>);
    expect(html).toContain("Plano de org");
  });

  it("brand variant applies bg-brand-bg class", () => {
    const html = renderToStaticMarkup(<Chip variant="brand">test</Chip>);
    expect(html).toContain("bg-brand-bg");
    expect(html).toContain("text-brand");
  });

  it("goal variant applies semantic-warning classes", () => {
    const html = renderToStaticMarkup(<Chip variant="goal">test</Chip>);
    expect(html).toContain("text-semantic-warning");
  });
});
