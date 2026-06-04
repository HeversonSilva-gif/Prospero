import { describe, expect, it, vi } from "vitest";
import { checkAndPause } from "../src/costs/enforce-budget.js";
import type { EnforceBudgetDeps } from "../src/costs/enforce-budget.js";
import { periodKey } from "../src/costs/period.js";

const makeDeps = (overrides: Partial<EnforceBudgetDeps> = {}): EnforceBudgetDeps => ({
  costsRepo: {
    getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
    insert: vi.fn(),
    getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
    getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
    hasAgentRowsForDay: vi.fn().mockReturnValue(false),
    listRunsByAgent: vi.fn().mockReturnValue([]),
    getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
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
  notifyCeoOverBudget: vi.fn(),
  ...overrides,
});

// A costsRepo whose daily total is over the 1000-token test cap.
const overDailyCosts = () => ({
  getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
  insert: vi.fn(),
  getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 1500, billableTokens: 1500, cents: 5 }),
  getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
  hasAgentRowsForDay: vi.fn().mockReturnValue(false),
  listRunsByAgent: vi.fn().mockReturnValue([]),
  getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
});

const ctx = { companyId: "co_1", agentId: "agent_x", issueId: null as string | null };

describe("checkAndPause — global M8 caps (unchanged)", () => {
  it("no-ops when daily and per-issue are under limits", () => {
    const deps = makeDeps({
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 500, billableTokens: 500, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 100, billableTokens: 100, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, { ...ctx, issueId: "iss_1" });
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
  });

  it("pauses + alerts when daily exceeds cap", () => {
    const deps = makeDeps({
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1500, billableTokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 100, billableTokens: 100, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 600, billableTokens: 600, cents: 1 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1000, billableTokens: 1000, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 850, billableTokens: 850, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 850, billableTokens: 850, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 850, billableTokens: 850, cents: 0 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 999 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 100 }),
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
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1000, billableTokens: 1000, cents: 100 }),
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

describe("checkAndPause — CEO exemption (never freeze the org)", () => {
  // Pausing the CEO on budget freezes the whole org (the reconciler won't wake a
  // paused CEO), and under the Max plan the cap is phantom anyway. So the CEO is
  // never paused on budget — it gets a deduped alert and keeps running. The Max
  // rate-limit remains the ultimate backstop.
  const ceoCtx = {
    companyId: "co_1",
    agentId: "agent_ceo",
    issueId: null as string | null,
    isCeo: true,
  };

  it("alerts but does NOT pause the CEO when the daily cap is exceeded", () => {
    const deps = makeDeps({ costsRepo: overDailyCosts() });
    const r = checkAndPause(deps, ceoCtx);
    expect(r.paused).toBe(false);

    expect(deps.pauseAgent).not.toHaveBeenCalled();

    expect(deps.recordPauseActivity).not.toHaveBeenCalled();

    expect(deps.notifySecurityAlert).not.toHaveBeenCalled();

    expect(deps.notifyCeoOverBudget).toHaveBeenCalledTimes(1);

    expect(deps.notifyCeoOverBudget).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "budget_exceeded_daily", agentId: "agent_ceo" }),
    );
  });

  it("alerts but does NOT pause the CEO when the per-agent cap is exceeded", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1000, billableTokens: 1000, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ceoCtx);
    expect(r.paused).toBe(false);

    expect(deps.pauseAgent).not.toHaveBeenCalled();

    expect(deps.notifyCeoOverBudget).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "budget_exceeded_agent" }),
    );
  });

  it("alerts the CEO only once even when multiple caps are exceeded (daily short-circuits)", () => {
    const deps = makeDeps({
      getBudgetState: vi.fn().mockReturnValue({
        tokensLimit: 1000,
        usdLimit: null,
        period: "daily",
        warnedPeriod: null,
        adapterName: "claude-oauth-local",
      }),
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1500, billableTokens: 1500, cents: 5 }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi
          .fn()
          .mockReturnValue({ tokens: 1000, billableTokens: 1000, cents: 0 }),
      },
    });
    checkAndPause(deps, ceoCtx);

    expect(deps.notifyCeoOverBudget).toHaveBeenCalledTimes(1);
  });

  it("a NON-CEO over the daily cap still pauses (exemption is CEO-only)", () => {
    const deps = makeDeps({ costsRepo: overDailyCosts() });
    const r = checkAndPause(deps, { ...ctx, isCeo: false });
    expect(r.paused).toBe(true);

    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");

    expect(deps.notifyCeoOverBudget).not.toHaveBeenCalled();
  });
});

describe("checkAndPause — cache_read regression (CEO false-pause)", () => {
  // The CEO re-reads a large context every turn (~629K cache_read/turn).
  // Before the fix, cache_read inflated `tokens` and false-tripped the daily cap.
  // After the fix, caps use `billableTokens` (input+output+cache_creation only).

  it("REGRESSION: huge cache_read but low billableTokens — must NOT pause on daily cap", () => {
    // Simulate: tokens >> cap (old bug: would pause), but billableTokens < cap (new: no pause).
    // Test budget cap is 1000 (from makeDeps default).
    const deps = makeDeps({
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({
          tokens: 11_600_000, // includes ~11M cache_read — would have false-tripped old cap
          billableTokens: 500, // only real work — under the 1000-token test cap
          cents: 3100,
        }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(false);
    expect(deps.pauseAgent).not.toHaveBeenCalled();
  });

  it("pauses when billableTokens (not cache_read) actually exceeds the daily cap", () => {
    // Simulate: billableTokens genuinely over the 2M cap, cache_read irrelevant
    const deps = makeDeps({
      costsRepo: {
        getCompanyTotalSince: vi.fn().mockReturnValue({ cents: 0 }),
        insert: vi.fn(),
        getAgentDailyTotal: vi.fn().mockReturnValue({
          tokens: 13_000_000,
          billableTokens: 2_100_000, // over the 1000-token cap used in test budgets
          cents: 8000,
        }),
        getIssueTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
        hasAgentRowsForDay: vi.fn().mockReturnValue(false),
        listRunsByAgent: vi.fn().mockReturnValue([]),
        getAgentPeriodTotal: vi.fn().mockReturnValue({ tokens: 0, billableTokens: 0, cents: 0 }),
      },
    });
    const r = checkAndPause(deps, ctx);
    expect(r.paused).toBe(true);
    if (r.paused) {
      expect(r.reason).toBe("budget_exceeded_daily");
      expect(r.tokens).toBe(2_100_000); // reports billableTokens, not total
    }
    expect(deps.pauseAgent).toHaveBeenCalledWith("agent_x", "budget_exceeded_daily");
  });
});
