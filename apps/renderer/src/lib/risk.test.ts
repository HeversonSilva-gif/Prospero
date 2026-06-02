import { describe, it, expect } from "vitest";
import { riskInfo } from "./risk.js";

describe("riskInfo", () => {
  it("money risk uses the money tone", () => {
    expect(riskInfo("money").classes).toContain("text-risk-money-fg");
    expect(riskInfo("money").classes).toContain("bg-risk-money-bg");
  });
  it("publish risk uses the warn tone", () => {
    expect(riskInfo("publish").classes).toContain("text-risk-warn-fg");
  });
  it("safe risk uses the jade accent", () => {
    expect(riskInfo("safe").classes).toContain("text-brand");
  });
});
