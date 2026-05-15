import { describe, expect, it } from "vitest";
import type { Goal } from "@prospero/shared";
import { buildGoalTree } from "./goalsTree.js";

const mk = (id: string, parent: string | null = null): Goal => ({
  id,
  companyId: "co_1",
  title: id,
  description: null,
  level: "task",
  status: "draft",
  parentGoalId: parent,
  ownerAgentId: null,
  budgetMaxTokens: null,
  deadline: null,
  successCriteria: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("buildGoalTree", () => {
  it("returns an empty array for an empty input", () => {
    expect(buildGoalTree([])).toEqual([]);
  });

  it("returns all goals as roots when none have a parent", () => {
    const tree = buildGoalTree([mk("a"), mk("b"), mk("c")]);
    expect(tree).toHaveLength(3);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests children under their parents", () => {
    const tree = buildGoalTree([mk("root"), mk("child", "root"), mk("grand", "child")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe("root");
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.id).toBe("child");
    expect(tree[0]?.children[0]?.children[0]?.id).toBe("grand");
  });

  it("promotes goals with unknown parentGoalId to roots (no orphan drop)", () => {
    const tree = buildGoalTree([mk("a", "missing_parent"), mk("b")]);
    expect(tree).toHaveLength(2);
    const ids = tree.map((n) => n.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("supports siblings under the same parent", () => {
    const tree = buildGoalTree([mk("p"), mk("c1", "p"), mk("c2", "p")]);
    expect(tree[0]?.children).toHaveLength(2);
  });
});
