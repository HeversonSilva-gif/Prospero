import type Database from "better-sqlite3";
import type { ExecutePlanResult, ExecutionState } from "@dashboard-agent/shared";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { formatGoalExecuteRequest } from "./format-execute-request.js";
import type { ExecuteOptions } from "./executor.js";

export type NarratedDeps = {
  orchestrator: {
    enqueueExecuteRequest: (ceoId: string, prompt: string) => { threadId: string };
  };
};

// Initiates a narrated execution loop: transitions the goal to 'approved',
// persists execution state, and enqueues a CEO turn carrying the
// [GOAL_EXECUTE_REQUEST] payload. The actual hire/create/comment work is
// done asynchronously by the CEO via MCP tools (hire_agent_for_plan,
// create_issue_for_plan, comment_on_issue, finalize_goal_execution).
//
// Returns {ok:true, executionStarted:true, hiredAgentIds:[], createdIssueIds:[]}
// immediately — empty arrays because the loop has not yet run. Caller
// distinguishes "started" from "complete" via goal.status (approved → in_progress).
export const executePlanNarrated = (
  db: Database.Database,
  planId: string,
  options: ExecuteOptions,
  deps: NarratedDeps,
): ExecutePlanResult => {
  try {
    const plansRepo = createGoalPlansRepository(db);
    const goalsRepo = createGoalsRepository(db);
    const agentsRepo = createAgentsRepository(db);

    const plan = plansRepo.getById(planId);
    if (plan === null || plan.status !== "proposed") {
      return {
        ok: false,
        error: `plan ${planId} is not in 'proposed' state`,
        failedAtStep: "load-plan",
      };
    }
    const goal = goalsRepo.getById(plan.goalId);
    if (goal === null || goal.status !== "proposed") {
      return {
        ok: false,
        error: `goal ${plan.goalId} is not in 'proposed' state`,
        failedAtStep: "load-goal",
      };
    }
    const ceo = agentsRepo
      .listByCompany(goal.companyId)
      .find((a) => a.templateId === "ceo" || a.role === "ceo");
    if (ceo === undefined) {
      return {
        ok: false,
        error: `no CEO for company ${goal.companyId}`,
        failedAtStep: "lookup-ceo",
      };
    }

    goalsRepo.updateStatus(goal.id, "approved");

    const prompt = formatGoalExecuteRequest(goal, plan);
    const { threadId } = deps.orchestrator.enqueueExecuteRequest(ceo.id, prompt);

    const state: ExecutionState = {
      planId,
      mode: "narrated",
      includeAgentIndexes:
        options.includeAgentIndexes !== undefined
          ? [...options.includeAgentIndexes].sort((a, b) => a - b)
          : null,
      includeIssueIndexes:
        options.includeIssueIndexes !== undefined
          ? [...options.includeIssueIndexes].sort((a, b) => a - b)
          : null,
      agentIndexToId: {},
      issueIndexToId: {},
      step: "starting",
      startedAt: Date.now(),
      ceoId: ceo.id,
      threadId,
    };
    goalsRepo.setExecutionState(goal.id, state);

    return { ok: true, hiredAgentIds: [], createdIssueIds: [] };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.message, failedAtStep: "narrated-init" };
  }
};
