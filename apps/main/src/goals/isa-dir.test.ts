import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGoalIsaDir, goalIsaPath, relativeIsaPath, assertSafePathSegment } from "./isa-dir.js";

const tmps: string[] = [];
const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "isa-dir-"));
  tmps.push(d);
  return d;
};

afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("isa-dir", () => {
  it("getGoalIsaDir creates a nested company/goal directory", () => {
    const root = newTmp();
    const dir = getGoalIsaDir(root, "company_1", "goal_1");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(root, "companies", "company_1", "goals", "goal_1"));
  });

  it("goalIsaPath points at isa.md inside the goal directory", () => {
    const root = newTmp();
    expect(goalIsaPath(root, "company_1", "goal_1")).toBe(
      join(root, "companies", "company_1", "goals", "goal_1", "isa.md"),
    );
  });

  it("relativeIsaPath is a stable forward-slash relative string", () => {
    expect(relativeIsaPath("company_1", "goal_1")).toBe("companies/company_1/goals/goal_1/isa.md");
  });

  it("assertSafePathSegment rejects path traversal", () => {
    expect(() => assertSafePathSegment("..", "goal id")).toThrow(/unsafe goal id/);
    expect(() => assertSafePathSegment("a/b", "goal id")).toThrow();
    expect(() => assertSafePathSegment("a.b", "goal id")).toThrow();
    expect(() => assertSafePathSegment("goal_1", "goal id")).not.toThrow();
  });

  it("goalIsaPath rejects an unsafe goal id", () => {
    const root = newTmp();
    expect(() => goalIsaPath(root, "company_1", "../escape")).toThrow();
  });
});
