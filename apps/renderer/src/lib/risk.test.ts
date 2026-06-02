import { describe, it, expect } from "vitest";
import { riskInfo } from "./risk.js";

describe("riskInfo", () => {
  it("money risk uses the money tone", () => {
    expect(riskInfo("money").labelKey).toBe("decisoes.risk.money");
    expect(riskInfo("money").classes).toContain("text-risk-money-fg");
    expect(riskInfo("money").classes).toContain("bg-risk-money-bg");
  });
  it("publish risk uses the warn tone", () => {
    expect(riskInfo("publish").labelKey).toBe("decisoes.risk.publish");
    expect(riskInfo("publish").classes).toContain("text-risk-warn-fg");
    expect(riskInfo("publish").classes).toContain("bg-risk-warn-bg");
  });
  it("safe risk uses the jade accent", () => {
    expect(riskInfo("safe").labelKey).toBe("decisoes.risk.safe");
    expect(riskInfo("safe").classes).toContain("text-brand");
    expect(riskInfo("safe").classes).toContain("bg-brand-bg");
  });
});
