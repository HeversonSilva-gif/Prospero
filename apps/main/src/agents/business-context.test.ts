import { describe, it, expect } from "vitest";
import { buildBusinessContext, BUSINESS_CONTEXT_CAP } from "./business-context.js";

describe("buildBusinessContext", () => {
  it("assembles company name, X handle, and TELOS into one block", () => {
    const out = buildBusinessContext({
      companyName: "BeanBox",
      xHandle: "@beanbox",
      telos: "## Mission\n\nSell single-origin coffee subscriptions.",
    });
    expect(out).toContain("# This business");
    expect(out).toContain("BeanBox");
    expect(out).toContain("@beanbox");
    expect(out).toContain("Sell single-origin coffee subscriptions");
    expect(out).toContain("TELOS");
  });

  it("returns an empty string when nothing is known", () => {
    expect(buildBusinessContext({ companyName: null, xHandle: null, telos: null })).toBe("");
  });

  it("degrades gracefully when only the TELOS is missing", () => {
    const out = buildBusinessContext({ companyName: "BeanBox", xHandle: null, telos: null });
    expect(out).toContain("BeanBox");
    expect(out).not.toContain("TELOS");
  });

  it("caps the TELOS body length", () => {
    const out = buildBusinessContext({
      companyName: null,
      xHandle: null,
      telos: "x".repeat(BUSINESS_CONTEXT_CAP + 500),
    });
    // The block has a fixed header + the capped telos; assert the telos slice is capped.
    expect(out.length).toBeLessThan(BUSINESS_CONTEXT_CAP + 200);
  });
});
