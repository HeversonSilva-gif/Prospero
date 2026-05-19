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
};

export type EnforceBudgetContext = {
  companyId: string;
  agentId: string;
  issueId: string | null;
};

export type EnforceBudgetResult =
  | { paused: false }
  | { paused: true; reason: PauseReason; tokens: number; limit: number };

export const checkAndPause = (
  deps: EnforceBudgetDeps,
  ctx: EnforceBudgetContext,
): EnforceBudgetResult => {
  const budgets = deps.budgetsRepo.read();

  // --- M8 global daily cap ---
  const daily = deps.costsRepo.getAgentDailyTotal(ctx.agentId, new Date());
  if (daily.tokens > budgets.maxTokensPerDayPerAgent) {
    const reason: PauseReason = "budget_exceeded_daily";
    deps.pauseAgent(ctx.agentId, reason);
    deps.notifySecurityAlert({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      reason,
      metric: "tokens",
      tokens: daily.tokens,
      limit: budgets.maxTokensPerDayPerAgent,
      issueId: null,
    });
    deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
    return { paused: true, reason, tokens: daily.tokens, limit: budgets.maxTokensPerDayPerAgent };
  }

  // --- M8 global per-issue cap ---
  if (ctx.issueId !== null) {
    const issueTotal = deps.costsRepo.getIssueTotal(ctx.issueId);
    if (issueTotal.tokens > budgets.maxTokensPerIssue) {
      const reason: PauseReason = "budget_exceeded_issue";
      deps.pauseAgent(ctx.agentId, reason);
      deps.notifySecurityAlert({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        metric: "tokens",
        tokens: issueTotal.tokens,
        limit: budgets.maxTokensPerIssue,
        issueId: ctx.issueId,
      });
      deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
      return { paused: true, reason, tokens: issueTotal.tokens, limit: budgets.maxTokensPerIssue };
    }
  }

  // --- M12 PR-E2 per-agent budget ---
  const budget = deps.getBudgetState(ctx.agentId);
  if (budget !== null && (budget.tokensLimit !== null || budget.usdLimit !== null)) {
    const now = new Date();
    const total = deps.costsRepo.getAgentPeriodTotal(ctx.agentId, budget.period, now);
    // USD is only enforced on cost-bearing adapters; OAuth has no real $ cost.
    const costBearing = budget.adapterName.startsWith("claude-api-key");

    const tokenOver = budget.tokensLimit !== null && total.tokens >= budget.tokensLimit;
    const usdOver = costBearing && budget.usdLimit !== null && total.cents >= budget.usdLimit;
    if (tokenOver || usdOver) {
      const reason: PauseReason = "budget_exceeded_agent";
      const tokens = tokenOver ? total.tokens : total.cents;
      const limit = tokenOver ? budget.tokensLimit! : budget.usdLimit!;
      deps.pauseAgent(ctx.agentId, reason);
      deps.notifySecurityAlert({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        metric: tokenOver ? "tokens" : "usd",
        tokens,
        limit,
        issueId: null,
      });
      deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
      return { paused: true, reason, tokens, limit };
    }

    // 80% — one Inbox warning per period, deduped via budget_warned_period.
    const key = periodKey(budget.period, now);
    if (budget.warnedPeriod !== key) {
      const tokenWarn = budget.tokensLimit !== null && total.tokens >= 0.8 * budget.tokensLimit;
      const usdWarn =
        costBearing && budget.usdLimit !== null && total.cents >= 0.8 * budget.usdLimit;
      if (tokenWarn || usdWarn) {
        deps.notifyBudgetWarning({
          companyId: ctx.companyId,
          agentId: ctx.agentId,
          metric: tokenWarn ? "tokens" : "usd",
          used: tokenWarn ? total.tokens : total.cents,
          limit: tokenWarn ? budget.tokensLimit! : budget.usdLimit!,
          period: budget.period,
        });
        deps.markBudgetWarned(ctx.agentId, key);
      }
    }
  }

  return { paused: false };
};
