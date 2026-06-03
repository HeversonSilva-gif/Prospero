import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelDropdown } from "./ModelDropdown.js";

// Audit 2026-06-03 Inteligência & Contexto I3: the Opus option must offer the
// current id (claude-opus-4-8), never the stale claude-opus-4-7.
describe("ModelDropdown", () => {
  const noop = (): void => {};

  it("offers Opus 4.8 and never the stale 4.7", () => {
    const html = renderToStaticMarkup(<ModelDropdown value="claude-sonnet-4-6" onChange={noop} />);
    expect(html).toContain('value="claude-opus-4-8"');
    expect(html).not.toContain('value="claude-opus-4-7"');
  });

  it("offers the current Sonnet and Haiku presets", () => {
    const html = renderToStaticMarkup(<ModelDropdown value="claude-sonnet-4-6" onChange={noop} />);
    expect(html).toContain('value="claude-sonnet-4-6"');
    expect(html).toContain('value="claude-haiku-4-5-20251001"');
  });

  it("renders a legacy 4.7 value via the Custom input (not a dropdown option)", () => {
    const html = renderToStaticMarkup(<ModelDropdown value="claude-opus-4-7" onChange={noop} />);
    // Falls through to Custom: value is preserved in the text input, not lost.
    expect(html).not.toContain('<option value="claude-opus-4-7"');
    expect(html).toContain('value="claude-opus-4-7"');
  });
});
