// Called after each cost recorder.recordTurn to enforce soft-stop budgets.
// Daily-per-agent and per-issue caps each trigger pause + Inbox alert +
// activity log. Daily wins precedence so the user sees the more global
// signal first. Pause is "soft" — the current turn already happened; the
// next enqueue is what gets parked by router (M7.6 enqueueOrPark).

import type { CostsRepository } from "./repository.js";
import type { BudgetsRepository } from "./budgets-repository.js";

export type PauseReason = "budget_exceeded_daily" | "budget_exceeded_issue";

export type EnforceBudgetDeps = {
  costsRepo: CostsRepository;
  budgetsRepo: BudgetsRepository;
  pauseAgent: (agentId: string, reason: PauseReason) => void;
  notifySecurityAlert: (input: {
    companyId: string;
    agentId: string;
    reason: PauseReason;
    tokens: number;
    limit: number;
    issueId: string | null;
  }) => void;
  recordPauseActivity: (input: { companyId: string; agentId: string; reason: PauseReason }) => void;
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

  const daily = deps.costsRepo.getAgentDailyTotal(ctx.agentId, new Date());
  if (daily.tokens > budgets.maxTokensPerDayPerAgent) {
    const reason: PauseReason = "budget_exceeded_daily";
    deps.pauseAgent(ctx.agentId, reason);
    deps.notifySecurityAlert({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      reason,
      tokens: daily.tokens,
      limit: budgets.maxTokensPerDayPerAgent,
      issueId: null,
    });
    deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
    return {
      paused: true,
      reason,
      tokens: daily.tokens,
      limit: budgets.maxTokensPerDayPerAgent,
    };
  }

  if (ctx.issueId !== null) {
    const issueTotal = deps.costsRepo.getIssueTotal(ctx.issueId);
    if (issueTotal.tokens > budgets.maxTokensPerIssue) {
      const reason: PauseReason = "budget_exceeded_issue";
      deps.pauseAgent(ctx.agentId, reason);
      deps.notifySecurityAlert({
        companyId: ctx.companyId,
        agentId: ctx.agentId,
        reason,
        tokens: issueTotal.tokens,
        limit: budgets.maxTokensPerIssue,
        issueId: ctx.issueId,
      });
      deps.recordPauseActivity({ companyId: ctx.companyId, agentId: ctx.agentId, reason });
      return {
        paused: true,
        reason,
        tokens: issueTotal.tokens,
        limit: budgets.maxTokensPerIssue,
      };
    }
  }

  return { paused: false };
};
