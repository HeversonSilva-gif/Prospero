import { describe, expect, it } from "vitest";
import type { Agent } from "@prospero/shared";
import { layoutTree } from "./layoutTree.js";

const mkAgent = (id: string, reportsTo: string | null): Agent => ({
  id,
  companyId: "c1",
  name: id,
  role: "r",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
});

describe("layoutTree", () => {
  it("returns single node at depth=0 for a lone CEO", () => {
    const out = layoutTree([mkAgent("ceo", null)]);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]!.id).toBe("ceo");
    expect(out.nodes[0]!.depth).toBe(0);
  });

  it("places direct children at depth=1 with distinct x", () => {
    const out = layoutTree([mkAgent("ceo", null), mkAgent("eng1", "ceo"), mkAgent("eng2", "ceo")]);
    const ceo = out.nodes.find((n) => n.id === "ceo")!;
    const eng1 = out.nodes.find((n) => n.id === "eng1")!;
    const eng2 = out.nodes.find((n) => n.id === "eng2")!;
    expect(ceo.depth).toBe(0);
    expect(eng1.depth).toBe(1);
    expect(eng2.depth).toBe(1);
    expect(eng1.y).toBeGreaterThan(ceo.y);
    expect(eng1.x).not.toBe(eng2.x);
  });

  it("treats orphans (reportsTo points nowhere) as roots", () => {
    const out = layoutTree([mkAgent("orphan", "ghost")]);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]!.depth).toBe(0);
  });

  it("handles a multi-level chain", () => {
    const out = layoutTree([mkAgent("a", null), mkAgent("b", "a"), mkAgent("c", "b")]);
    expect(out.nodes.find((n) => n.id === "c")!.depth).toBe(2);
  });

  it("returns empty result for empty input", () => {
    const out = layoutTree([]);
    expect(out.nodes).toEqual([]);
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
  });

  it("includes all agents in result even when graph has multiple roots", () => {
    const out = layoutTree([mkAgent("r1", null), mkAgent("r2", null), mkAgent("child", "r1")]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["child", "r1", "r2"]);
  });
});
