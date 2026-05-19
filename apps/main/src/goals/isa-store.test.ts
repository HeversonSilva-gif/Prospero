import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Goal } from "@prospero/shared";
import { getIsaSection, validateIsa } from "@prospero/shared";
import { ensureIsa, readIsa, writeIsa, isaExists } from "./isa-store.js";
import { goalIsaPath } from "./isa-dir.js";

const tmps: string[] = [];
const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "isa-store-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const makeGoal = (over: Partial<Goal> = {}): Goal => ({
  id: "goal_1",
  companyId: "company_1",
  title: "Launch",
  description: null,
  level: "task",
  status: "draft",
  parentGoalId: null,
  ownerAgentId: null,
  budgetMaxTokens: null,
  deadline: null,
  successCriteria: null,
  isaPath: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("isa-store", () => {
  it("ensureIsa materializes a skeleton isa.md on first access", () => {
    const root = newTmp();
    const goal = makeGoal();
    ensureIsa(root, goal);
    expect(existsSync(goalIsaPath(root, "company_1", "goal_1"))).toBe(true);
    expect(validateIsa(readIsa(root, goal)).ok).toBe(true);
  });

  it("ensureIsa seeds the Vision section from successCriteria", () => {
    const root = newTmp();
    const goal = makeGoal({ successCriteria: "Users can sign up in under a minute." });
    ensureIsa(root, goal);
    expect(getIsaSection(readIsa(root, goal), "Vision")).toBe(
      "Users can sign up in under a minute.",
    );
  });

  it("ensureIsa is idempotent — it never clobbers an edited file", () => {
    const root = newTmp();
    const goal = makeGoal();
    writeIsa(root, goal, "# edited\n");
    ensureIsa(root, goal);
    expect(readFileSync(goalIsaPath(root, "company_1", "goal_1"), "utf8")).toBe("# edited\n");
  });

  it("isaExists reflects materialization", () => {
    const root = newTmp();
    const goal = makeGoal();
    expect(isaExists(root, "company_1", "goal_1")).toBe(false);
    ensureIsa(root, goal);
    expect(isaExists(root, "company_1", "goal_1")).toBe(true);
  });
});
