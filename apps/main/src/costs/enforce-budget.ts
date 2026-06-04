// Called after each cost recorder.recordTurn to enforce soft-stop budgets.
// M8: global daily-per-agent + per-issue caps. M12 PR-E2: a per-agent budget
// (token or USD, daily or monthly) layered on top — 80% raises an Inbox
// warning, 100% pauses. The per-agent cap is additive: the global cap is the
// floor, the per-agent cap is a tighter ceiling. Pause is "soft" — the current
// turn already happened; the next enqueue is parked by router.

import type { BudgetPeriod } from "@prospero/shared";
import type { CostsRepository } from "./repository.js";
import type { BudgetsRepository } from "./budgets-repository.js";
import type { AgentBudgetState } from "../agents/repository.js";
import { periodKey } from "./period.js";

export type PauseReason =
  | "budget_exceeded_daily"
  | "budget_exceeded_issue"
  | "budget_exceeded_agent";

export type BudgetWarningInput = {
  companyId: string;
  agentId: string;
  metric: "tokens" | "usd";
  used: number;
  limit: number;
  period: BudgetPeriod;
};

export type EnforceBudgetDeps = {
  costsRepo: CostsRepository;
  budgetsRepo: BudgetsRepository;
  pauseAgent: (agentId: string, reason: PauseReason) => void;
  notifySecurityAlert: (input: {
    companyId: string;
    agentId: string;
    reason: PauseReason;
    metric: "tokens" | "usd";
    tokens: number;
    limit: number;
    issueId: string | null;
  }) => void;
  recordPauseActivity: (input: { companyId: string; agentId: string; reason: PauseReason }) => void;
  getBudgetState: (agentId: string) => AgentBudgetState | null;
  notifyBudgetWarning: (input: BudgetWarningInput) => void;
  markBudgetWarned: (agentId: string, periodKey: string) => void;
  // The CEO is exempt from budget PAUSES (a pause freezes the whole org). When a
  // cap is hit on the CEO this fires instead — a heads-up that the CEO went over
  // budget but kept running. Dedup is the implementation's responsibility.
  notifyCeoOverBudget: (input: {
    companyId: string;
    agentId: string;
    reason: PauseReason;
    metric: "tokens" | "usd";
    tokens: number;
    limit: number;
    issueId: string | null;
  }) => void;
};

export type EnforceBudgetContext = {
  companyId: string;
  agentId: string;
  issueId: string | null;
  // True when this agent is the company CEO. The CEO is never budget-PAUSED —
  // freezing it freezes the org (the reconciler won't wake a paused CEO) — so a
  // cap hit alerts (notifyCeoOverBudget) instead. Defaults to false.
  isCeo?: boolean;
};

export type EnforceBudgetResult =
  | { paused: false }
  | { paused: true; reason: PauseReason; tokens: number; limit: number };

export const checkAndPause = (
  deps: EnforceBudgetDeps,
  ctx: EnforceBudgetContext,
): EnforceBudgetResult => {
  // All token-cap comparisons use billableTokens (input + output + cache_creation),
  // excluding cache_read — re-reading established context is cheap and dominates
  // long-context agents like the CEO; counting it would false-trip the cap.
  const budgets = deps.budgetsRepo.read();

  // Either pause the offender (normal) or — for the CEO — alert and keep going.
  // The CEO must never be frozen by a budget cap: a paused CEO is not re-woken by
  // the reconciler, so the whole org stalls until a human intervenes; and under
  // the Max plan the cap is phantom (the real ceiling is the session rate-limit,
  // which already pauses + auto-resumes everything). Returning {paused:false}
  // short-circuits checkAndPause so the CEO is alerted at most once per call.
  const overCap = (
    reason: PauseReason,
    metric: "tokens" | "usd",
    tokens: number,
    limit: number,
    issueId: string | null,
  ): EnforceBudgetResult => {
    if (ctx.isCeo === true) {
      deps.notifyCeoOverBudget({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        metric,
        tokens,
        limit,
        issueId,
      });
      return { paused: false };
    }
    deps.pauseAgent(ctx.agentId, reason);
    deps.notifySecurityAlert({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      reason,
      metric,
      tokens,
      limit,
      issueId,
    });
    deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
    return { paused: true, reason, tokens, limit };
  };

  // --- M8 global daily cap ---
  const daily = deps.costsRepo.getAgentDailyTotal(ctx.agentId, new Date());
  if (daily.billableTokens > budgets.maxTokensPerDayPerAgent) {
    return overCap(
      "budget_exceeded_daily",
      "tokens",
      daily.billableTokens,
      budgets.maxTokensPerDayPerAgent,
      null,
    );
  }

  // --- M8 global per-issue cap ---
  if (ctx.issueId !== null) {
    const issueTotal = deps.costsRepo.getIssueTotal(ctx.issueId);
    if (issueTotal.billableTokens > budgets.maxTokensPerIssue) {
      return overCap(
        "budget_exceeded_issue",
        "tokens",
        issueTotal.billableTokens,
        budgets.maxTokensPerIssue,
        ctx.issueId,
      );
    }
  }

  // --- M12 PR-E2 per-agent budget ---
  const budget = deps.getBudgetState(ctx.agentId);
  if (budget !== null && (budget.tokensLimit !== null || budget.usdLimit !== null)) {
    const now = new Date();
    const total = deps.costsRepo.getAgentPeriodTotal(ctx.agentId, budget.period, now);
    // USD is only enforced on cost-bearing adapters; OAuth has no real $ cost.
    const costBearing = budget.adapterName.startsWith("claude-api-key");

    const tokenOver = budget.tokensLimit !== null && total.billableTokens >= budget.tokensLimit;
    const usdOver = costBearing && budget.usdLimit !== null && total.cents >= budget.usdLimit;
    if (tokenOver || usdOver) {
      const tokens = tokenOver ? total.billableTokens : total.cents;
      const limit = tokenOver ? budget.tokensLimit! : budget.usdLimit!;
      return overCap("budget_exceeded_agent", tokenOver ? "tokens" : "usd", tokens, limit, null);
    }

    // 80% — one Inbox warning per period, deduped via budget_warned_period.
    const key = periodKey(budget.period, now);
    if (budget.warnedPeriod !== key) {
      const tokenWarn =
        budget.tokensLimit !== null && total.billableTokens >= 0.8 * budget.tokensLimit;
      const usdWarn =
        costBearing && budget.usdLimit !== null && total.cents >= 0.8 * budget.usdLimit;
      if (tokenWarn || usdWarn) {
        deps.notifyBudgetWarning({
          companyId: ctx.companyId,
          agentId: ctx.agentId,
          metric: tokenWarn ? "tokens" : "usd",
          used: tokenWarn ? total.billableTokens : total.cents,
          limit: tokenWarn ? budget.tokensLimit! : budget.usdLimit!,
          period: budget.period,
        });
        deps.markBudgetWarned(ctx.agentId, key);
      }
    }
  }

  return { paused: false };
};
