import { describe, expect, it } from "vitest";
import { categorizeSkills } from "./skillCategorize.js";

const ALL_SKILLS = ["read_code", "git_ops", "run_tests", "shell", "write_code"];

describe("categorizeSkills", () => {
  it("required = role defaults, all enabled when agent has them", () => {
    const out = categorizeSkills({
      agentSkills: ["read_code", "git_ops"],
      roleDefaultSkills: ["read_code", "git_ops"],
      allSkills: ALL_SKILLS,
    });
    expect(out.required).toEqual([
      { id: "read_code", enabled: true },
      { id: "git_ops", enabled: true },
    ]);
    expect(out.optional).toEqual([]);
    expect(out.available).toEqual(["run_tests", "shell", "write_code"]);
  });

  it("optional = agent skill not in role defaults", () => {
    const out = categorizeSkills({
      agentSkills: ["read_code", "git_ops", "shell"],
      roleDefaultSkills: ["read_code", "git_ops"],
      allSkills: ALL_SKILLS,
    });
    expect(out.optional).toEqual([{ id: "shell", enabled: true }]);
    expect(out.available).toEqual(["run_tests", "write_code"]);
  });

  it("required marked enabled=false when agent is missing a default", () => {
    const out = categorizeSkills({
      agentSkills: ["read_code"],
      roleDefaultSkills: ["read_code", "git_ops"],
      allSkills: ALL_SKILLS,
    });
    expect(out.required).toEqual([
      { id: "read_code", enabled: true },
      { id: "git_ops", enabled: false },
    ]);
  });
});
