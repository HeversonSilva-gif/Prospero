import { describe, it, expect } from "vitest";
import { criterionCheckSpecSchema } from "./criterionCheckSpec.js";

describe("criterionCheckSpecSchema", () => {
  it("accepts and returns a command spec unchanged", () => {
    const input = {
      checkType: "command",
      command: "pnpm test",
      expectedExitCode: 0,
      timeoutMs: 600000,
    };
    expect(criterionCheckSpecSchema.parse(input)).toEqual(input);
  });

  it("accepts and returns a metric spec unchanged", () => {
    const input = {
      checkType: "metric",
      tool: "ads_get_insights",
      params: { campaignId: "x" },
      field: "data.cpa",
      operator: "lt",
      threshold: 50,
    };
    expect(criterionCheckSpecSchema.parse(input)).toEqual(input);
  });

  it("accepts and returns an artifact_exists spec unchanged", () => {
    const input = { checkType: "artifact_exists", artifactKind: "file_path" };
    expect(criterionCheckSpecSchema.parse(input)).toEqual(input);
  });

  it("rejects an unknown checkType", () => {
    expect(() => criterionCheckSpecSchema.parse({ checkType: "bogus" })).toThrow();
  });

  it("rejects a command spec missing its command", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({ checkType: "command", expectedExitCode: 0, timeoutMs: 1 }),
    ).toThrow();
  });

  it("rejects a command spec with an empty command", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({
        checkType: "command",
        command: "",
        expectedExitCode: 0,
        timeoutMs: 1000,
      }),
    ).toThrow();
  });

  it("rejects a command spec with a non-positive timeoutMs", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({
        checkType: "command",
        command: "x",
        expectedExitCode: 0,
        timeoutMs: 0,
      }),
    ).toThrow();
  });

  it("rejects a command spec exceeding the max timeoutMs", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({
        checkType: "command",
        command: "x",
        expectedExitCode: 0,
        timeoutMs: 3_600_001,
      }),
    ).toThrow();
  });

  it("rejects a metric spec with an invalid operator", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({
        checkType: "metric",
        tool: "t",
        params: {},
        field: "f",
        operator: "ne",
        threshold: 1,
      }),
    ).toThrow();
  });

  it("rejects an artifact_exists spec with an invalid artifactKind", () => {
    expect(() =>
      criterionCheckSpecSchema.parse({ checkType: "artifact_exists", artifactKind: "blob" }),
    ).toThrow();
  });
});
