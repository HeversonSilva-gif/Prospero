import { describe, expect, it } from "vitest";
import type { Agent, Issue, Goal } from "@prospero/shared";
import {
  selectActiveAgents,
  selectActiveIssues,
  countIssuesByProject,
  selectInProgressGoals,
} from "./selectors.js";

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "ag",
  companyId: "co",
  name: "A",
  role: "r",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
  ...over,
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "is",
  companyId: "co",
  projectId: null,
  parentId: null,
  title: "T",
  description: null,
  assigneeId: null,
  status: "todo",
  priority: "medium",
  identifier: null,
  issueNumber: null,
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g",
  companyId: "co",
  title: "T",
  description: null,
  level: "company",
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

describe("selectActiveAgents", () => {
  it("includes thinking, working, waiting; excludes idle/paused/terminated/error", () => {
    const agents = [
      agent({ id: "a1", status: "thinking" }),
      agent({ id: "a2", status: "working" }),
      agent({ id: "a3", status: "waiting" }),
      agent({ id: "a4", status: "idle" }),
      agent({ id: "a5", status: "paused" }),
      agent({ id: "a6", status: "terminated" }),
      agent({ id: "a7", status: "error" }),
    ];
    const result = selectActiveAgents(agents);
    expect(result.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("selectActiveIssues", () => {
  it("includes doing + review only", () => {
    const issues = [
      issue({ id: "i1", status: "doing" }),
      issue({ id: "i2", status: "review" }),
      issue({ id: "i3", status: "done" }),
      issue({ id: "i4", status: "todo" }),
      issue({ id: "i5", status: "backlog" }),
      issue({ id: "i6", status: "cancelled" }),
    ];
    const result = selectActiveIssues(issues);
    expect(result.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
  });
});

describe("countIssuesByProject", () => {
  it("counts active issues grouped by projectId; null is its own bucket", () => {
    const issues = [
      issue({ id: "i1", status: "doing", projectId: "p1" }),
      issue({ id: "i2", status: "doing", projectId: "p1" }),
      issue({ id: "i3", status: "review", projectId: "p2" }),
      issue({ id: "i4", status: "done", projectId: "p1" }),
      issue({ id: "i5", status: "doing", projectId: null }),
    ];
    const counts = countIssuesByProject(selectActiveIssues(issues));
    expect(counts).toEqual({ p1: 2, p2: 1, "": 1 });
  });
});

describe("selectInProgressGoals", () => {
  it("returns goals with status in_progress, sorted by updatedAt desc, top 3", () => {
    const goals = [
      goal({ id: "g1", status: "in_progress", updatedAt: 100 }),
      goal({ id: "g2", status: "in_progress", updatedAt: 200 }),
      goal({ id: "g3", status: "in_progress", updatedAt: 50 }),
      goal({ id: "g4", status: "in_progress", updatedAt: 300 }),
      goal({ id: "g5", status: "achieved", updatedAt: 999 }),
      goal({ id: "g6", status: "draft", updatedAt: 999 }),
    ];
    const result = selectInProgressGoals(goals, 3);
    expect(result.map((g) => g.id)).toEqual(["g4", "g2", "g1"]);
  });
});
