import { describe, expect, it, vi } from "vitest";
import { checkAndPause } from "../src/costs/enforce-budget.js";
import type { EnforceBudgetDeps } from "../src/costs/enforce-budget.js";

const makeDeps = (overrides: Partial<EnforceBudgetDeps> = {}): EnforceBudgetDeps => ({
  costsRepo: {
    insert: vi.fn(),
    getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    hasAgentRowsForDay: vi.fn().mockReturnValue(false),
    listRunsByAgent: vi.fn().mockReturnValue([]),
  },
  budgetsRepo: {
    read: vi.fn().mockReturnValue({
      maxTokensPerDayPerAgent: 1000,
      maxTokensPerIssue: 500,
      rateLimitWindowTokens: 100000,
      rateLimitWindowHours: 5,
    }),
    write: vi.fn(),
    resetDefaults: vi.fn(),
  },
  pauseAgent: vi.fn(),
  notifySecurityAlert: vi.fn(),
  recordPauseActivity: vi.fn(),
  ...overrides,
});

describe("checkAndPause", () => {
  it("no-ops when daily and per-issue are under limits", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 500, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
    expect(deps.notifySecurityAlert).not.toHaveBeenCalled();
  });

  it("pauses + alerts when daily exceeds cap", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: null,
    });
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");
    expect(deps.notifySecurityAlert).toHaveBeenCalledTimes(1);
    expect(deps.recordPauseActivity).toHaveBeenCalledTimes(1);
  });

  it("pauses + alerts when per-issue exceeds cap (even if daily is fine)", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 600, cents: 1 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_issue");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_issue");
  });

  it("skips per-issue check when issueId is null", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: null,
    });
    expect(r.paused).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock access
    expect(deps.costsRepo.getIssueTotal).not.toHaveBeenCalled();
  });

  it("daily check takes precedence when both are over", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 99 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 9999, cents: 99 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
      } as unknown as EnforceBudgetDeps["costsRepo"],
    });
    const r = checkAndPause(deps, {
      companyId: "co_1",
      agentId: "agent_x",
      issueId: "iss_1",
    });
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledTimes(1);
  });
});
