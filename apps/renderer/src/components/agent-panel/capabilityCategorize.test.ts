import { describe, expect, it } from "vitest";
import { categorizeCapabilities } from "./capabilityCategorize.js";

const ALL_CAPABILITIES = ["read_code", "git_ops", "run_tests", "shell", "write_code"];

describe("categorizeCapabilities", () => {
  it("required = role defaults, all enabled when agent has them", () => {
    const out = categorizeCapabilities({
      agentCapabilities: ["read_code", "git_ops"],
      roleDefaultCapabilities: ["read_code", "git_ops"],
      allCapabilities: ALL_CAPABILITIES,
    });
    expect(out.required).toEqual([
      { id: "read_code", enabled: true },
      { id: "git_ops", enabled: true },
    ]);
    expect(out.optional).toEqual([]);
    expect(out.available).toEqual(["run_tests", "shell", "write_code"]);
  });

  it("optional = agent capability not in role defaults", () => {
    const out = categorizeCapabilities({
      agentCapabilities: ["read_code", "git_ops", "shell"],
      roleDefaultCapabilities: ["read_code", "git_ops"],
      allCapabilities: ALL_CAPABILITIES,
    });
    expect(out.optional).toEqual([{ id: "shell", enabled: true }]);
    expect(out.available).toEqual(["run_tests", "write_code"]);
  });

  it("required marked enabled=false when agent is missing a default", () => {
    const out = categorizeCapabilities({
      agentCapabilities: ["read_code"],
      roleDefaultCapabilities: ["read_code", "git_ops"],
      allCapabilities: ALL_CAPABILITIES,
    });
    expect(out.required).toEqual([
      { id: "read_code", enabled: true },
      { id: "git_ops", enabled: false },
    ]);
  });
});
