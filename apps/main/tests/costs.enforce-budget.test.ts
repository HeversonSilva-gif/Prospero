import { describe, expect, it, vi } from "vitest";
import { checkAndPause } from "../src/costs/enforce-budget.js";
import type { EnforceBudgetDeps } from "../src/costs/enforce-budget.js";
import { periodKey } from "../src/costs/period.js";

const makeDeps = (overrides: Partial<EnforceBudgetDeps> = {}): EnforceBudgetDeps => ({
  costsRepo: {
    insert: vi.fn(),
    getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
    hasAgentRowsForDay: vi.fn().mockReturnValue(false),
    listRunsByAgent: vi.fn().mockReturnValue([]),
    getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
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
  getBudgetState: vi.fn().mockReturnValue(null),
  notifyBudgetWarning: vi.fn(),
  markBudgetWarned: vi.fn(),
  ...overrides,
});

const ctx = { companyId: "co_1", agentId: "agent_x", issueId: null as string | null };

describe("checkAndPause — global M8 caps (unchanged)", () => {
  it("no-ops when daily and per-issue are under limits", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 500, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, { ...ctx, issueId: "iss_1" });
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
  });

  it("pauses + alerts when daily exceeds cap", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_daily");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");
  });

  it("pauses when per-issue exceeds cap (daily fine)", () => {
    const deps = makeDeps({
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 600, cents: 1 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, { ...ctx, issueId: "iss_1" });
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_issue");
  });
});

describe("checkAndPause — per-agent budget", () => {
  it("no-ops when the agent has no per-agent limits", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock access
    expect(deps.costsRepo.getAgentPeriodTotal).not.toHaveBeenCalled();
  });

  it("pauses with budget_exceeded_agent when the token cap is hit", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 1000, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_agent");
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_agent");
    expect(deps.notifySecurityAlert).toHaveBeenCalledTimes(1);
  });

  it("warns once at 80% and records the period key", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.notifyBudgetWarning).toHaveBeenCalledTimes(1);
    expect(deps.markBudgetWarned).toHaveBeenCalledWith("agent_x", periodKey("daily", new Date()));
  });

  it("does not re-warn when warnedPeriod already matches the current period", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: periodKey("daily", new Date()),
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    checkAndPause(deps, ctx);
    expect(deps.notifyBudgetWarning).not.toHaveBeenCalled();
  });

  it("re-warns after a period rollover (stale warnedPeriod)", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: "2020-01-01",
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 850, cents: 0 }),
      },
    });
    checkAndPause(deps, ctx);
    expect(deps.notifyBudgetWarning).toHaveBeenCalledTimes(1);
  });

  it("does NOT enforce the USD cap on an OAuth adapter", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: 100,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 999 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.notifyBudgetWarning).not.toHaveBeenCalled();
  });

  it("enforces the USD cap on a claude-api-key adapter", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: null,
        usdLimit: 100,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-api-key-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 100 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) expect(r.reason).toBe("budget_exceeded_agent");
  });

  it("pauses once with the token metric when both token and USD caps are hit", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: 100,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-api-key-local",
      }),
      costsRepo: {
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 1000, cents: 100 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) {
      expect(r.reason).toBe("budget_exceeded_agent");
      expect(r.tokens).toBe(1000); // token metric wins, not cents
      expect(r.limit).toBe(1000);
    }
    expect(deps.pauseAgent).toHaveBeenCalledTimes(1); // exactly one pause
    expect(deps.notifySecurityAlert).toHaveBeenCalledTimes(1);
  });
});
