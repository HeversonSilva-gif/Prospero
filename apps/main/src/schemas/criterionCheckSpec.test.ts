import { describe, it, expect } from "vitest";
import { criterionCheckSpecSchema } from "./criterionCheckSpec.js";

describe("criterionCheckSpecSchema", () => {
  it("accepts a command spec", () => {
    const parsed = criterionCheckSpecSchema.parse({
      checkType: "command",
      command: "pnpm test",
      expectedExitCode: 0,
      timeoutMs: 600000,
    });
    expect(parsed.checkType).toBe("command");
  });

  it("accepts a metric spec", () => {
    const parsed = criterionCheckSpecSchema.parse({
      checkType: "metric",
      tool: "ads_get_insights",
      params: { campaignId: "x" },
      field: "data.cpa",
      operator: "lt",
      threshold: 50,
    });
    expect(parsed.checkType).toBe("metric");
  });

  it("accepts an artifact_exists spec", () => {
    const parsed = criterionCheckSpecSchema.parse({
      checkType: "artifact_exists",
      artifactKind: "file_path",
    });
    expect(parsed.checkType).toBe("artifact_exists");
  });

  it("rejects an unknown checkType", () => {
    expect(() => criterionCheckSpecSchema.parse({ checkType: "bogus" })).toThrow();
  });

  it("rejects a command spec missing its command", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({ checkType: "command", expectedExitCode: 0, timeoutMs: 1 }),
    ).toThrow();
  });
});
