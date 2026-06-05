import type Database from "better-sqlite3";
import { resolveModelPreset } from "../agents/model-presets.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalPlansRepository } from "./plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { resolveRoleTitle } from "../agents/role-title.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createIssueCriteriaRepository } from "./issue-criteria-repository.js";
import { createSettingsRepository } from "../settings/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { executePlanNarrated } from "./executor-narrated.js";
import { resolvePlanAssignee } from "./resolve-assignee.js";
import {
  isCeoAgent,
  type AgentToHire,
  type IssueToCreate,
  type ExecutePlanResult,
} from "@prospero/shared";

export type ExecuteOptions = {
  includeAgentIndexes?: Set<number>;
  includeIssueIndexes?: Set<number>;
};

export type ExecuteResult = ExecutePlanResult;

const topoSortAgents = (agents: AgentToHire[]): AgentToHire[] => {
  const byIndex = new Map(agents.map((a) => [a.index, a]));
  const visited = new Set<number>();
  const out: AgentToHire[] = [];
  const visit = (a: AgentToHire): void => {
    if (visited.has(a.index)) return;
    visited.add(a.index);
    if (a.reportsToIndex !== "CEO") {
      const parent = byIndex.get(a.reportsToIndex);
      if (parent) visit(parent);
    }
    out.push(a);
  };
  for (const a of agents) visit(a);
  return out;
};

const topoSortIssues = (issues: IssueToCreate[]): IssueToCreate[] => {
  const byIndex = new Map(issues.map((i) => [i.index, i]));
  const visited = new Set<number>();
  const out: IssueToCreate[] = [];
  const visit = (i: IssueToCreate): void => {
    if (visited.has(i.index)) return;
    visited.add(i.index);
    for (const dep of i.dependsOnIndexes) {
      const parent = byIndex.get(dep);
      if (parent) visit(parent);
    }
    out.push(i);
  };
  for (const i of issues) visit(i);
  return out;
};

const filterByIndex = <T extends { index: number }>(items: T[], include?: Set<number>): T[] =>
  include === undefined ? items : items.filter((i) => include.has(i.index));

export const executePlanAtomic = (
  db: Database.Database,
  planId: string,
  options: ExecuteOptions = {},
): ExecuteResult => {
  const plansRepo = createGoalPlansRepository(db);
  const goalsRepo = createGoalsRepository(db);
  const recorder = tryGetRecorder();
  const agentsRepo = createAgentsRepository(db, recorder);
  const issuesRepo = createIssuesRepository(db, recorder);
  const criteriaRepo = createGoalCriteriaRepository(db);
  const issueCriteriaRepo = createIssueCriteriaRepository(db);
  const linkIssueGoalStmt = db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?");
  const setOwnerStmt = db.prepare(
    "UPDATE goals SET owner_agent_id = ? WHERE id = ? AND owner_agent_id IS NULL",
  );

  try {
    return db.transaction((): ExecuteResult => {
      const plan = plansRepo.getById(planId);
      if (!plan || plan.status !== "proposed") {
        throw Object.assign(new Error(`plan ${planId} is not in 'proposed' state`), {
          step: "load-plan",
        });
      }
      const goal = goalsRepo.getById(plan.goalId);
      if (!goal || goal.status !== "proposed") {
        throw Object.assign(new Error(`goal ${plan.goalId} is not in 'proposed' state`), {
          step: "load-goal",
        });
      }

      const filteredAgents = filterByIndex(plan.agentsToHire, options.includeAgentIndexes);
      const filteredIssues = filterByIndex(plan.issuesToCreate, options.includeIssueIndexes);

      const allAgents = agentsRepo.listByCompany(goal.companyId);
      const ceo = allAgents.find(isCeoAgent);
      if (!ceo) {
        throw Object.assign(new Error(`no CEO for company ${goal.companyId}`), {
          step: "lookup-ceo",
        });
      }

      const sortedAgents = topoSortAgents(filteredAgents);
      const indexToAgentId = new Map<number, string>();

      for (const a of sortedAgents) {
        let reportsToId: string | null;
        if (a.reportsToIndex === "CEO") {
          reportsToId = ceo.id;
        } else {
          const resolved = indexToAgentId.get(a.reportsToIndex);
          if (resolved === undefined) {
            throw Object.assign(
              new Error(
                `agent index ${a.index} reports_to_index ${a.reportsToIndex} unresolved (likely excluded by filter)`,
              ),
              { step: "resolve-reports-to" },
            );
          }
          reportsToId = resolved;
        }
        const created = agentsRepo.create({
          companyId: goal.companyId,
          name: a.name,
          // Human role title, NOT the raw template id — matches applyOrgPlan and
          // prevents confusing "role_xxxx" duplicate-looking rows (audit Wave 4).
          role: resolveRoleTitle(db, a.roleTemplateId),
          systemPrompt: a.personaSummary,
          mode: "supervised",
          alwaysOn: false,
          model: resolveModelPreset(a.model),
          capabilities: a.capabilities,
          templateId: a.roleTemplateId,
        });
        if (reportsToId !== null) {
          agentsRepo.setReportsTo(created.id, reportsToId);
        }
        indexToAgentId.set(a.index, created.id);
      }

      const sortedIssues = topoSortIssues(filteredIssues);
      const indexToIssueId = new Map<number, string>();

      for (const issue of sortedIssues) {
        let assigneeId: string;
        try {
          assigneeId = resolvePlanAssignee(issue.assigneeIndex, {
            ceoId: ceo.id,
            companyId: goal.companyId,
            freshHire: (i) => indexToAgentId.get(i),
            // Reuse the already-loaded roster — no extra query per issue.
            existingAgent: (id) => {
              const found = allAgents.find((a) => a.id === id);
              return found === undefined
                ? null
                : { companyId: found.companyId, terminatedAt: found.terminatedAt };
            },
          });
        } catch (err) {
          throw Object.assign(new Error(`issue index ${issue.index}: ${(err as Error).message}`), {
            step: "resolve-assignee",
          });
        }
        const created = issuesRepo.create(
          {
            companyId: goal.companyId,
            projectId: null,
            title: issue.title,
            description: issue.description,
            priority: issue.priority,
            assigneeId,
            parentId: null,
            createdBy: ceo.id,
          },
          { actorKind: "user", actorId: null },
        );
        linkIssueGoalStmt.run(goal.id, created.id);
        // M13: link the ISCs this issue advances. Skip ids that don't belong to
        // this goal (a stale criterion id must not abort plan execution).
        for (const criterionId of issue.advancesCriteria ?? []) {
          const criterion = criteriaRepo.getById(criterionId);
          if (criterion !== null && criterion.goalId === goal.id) {
            issueCriteriaRepo.link(created.id, criterionId);
          }
        }
        indexToIssueId.set(issue.index, created.id);
      }

      // C3 (audit 2026-06-03): give the goal an owner (the CEO, the accountable
      // orchestrator) when it starts. Without this the main work path left
      // owner_agent_id null, killing trust tracking AND the success retrospective
      // (the dispatcher drops owner-less goal.status_changed activities).
      setOwnerStmt.run(ceo.id, goal.id);
      plansRepo.markApproved(planId, { decidedBy: "user" });
      goalsRepo.updateStatus(goal.id, "approved");
      goalsRepo.updateStatus(goal.id, "in_progress");

      const hiredAgentIds = [...indexToAgentId.values()];
      const createdIssueIds = [...indexToIssueId.values()];

      recorder?.recordActivity({
        companyId: goal.companyId,
        actor: { kind: "user" },
        action: "goal.plan_approved",
        entityKind: "goal",
        entityId: goal.id,
        payload: {
          planId,
          version: plan.version,
          hiredAgentIds,
          createdIssueIds,
          approvedBy: "user",
        },
      });

      return { ok: true, hiredAgentIds, createdIssueIds };
    })();
  } catch (e) {
    const err = e as Error & { step?: string };
    return { ok: false, error: err.message, failedAtStep: err.step ?? "unknown" };
  }
};

// M8.6 — Dispatcher. Routes to atomic (M8.5, default) or narrated (M8.6, opt-in)
// based on opts.mode + Settings.executorMode. Narrated branch requires the
// orchestrator dep (enqueue CEO turn).
export type DispatchOptions = ExecuteOptions & {
  mode?: "atomic" | "narrated";
  narrated?: {
    orchestrator: {
      enqueueExecuteRequest: (ceoId: string, prompt: string) => { threadId: string };
    };
  };
};

export const executePlan = (
  db: Database.Database,
  planId: string,
  options: DispatchOptions = {},
): ExecuteResult => {
  // Resolve mode: explicit override > settings default > "atomic".
  const mode = options.mode ?? createSettingsRepository(db).getExecutorMode();
  if (mode === "narrated") {
    if (options.narrated === undefined) {
      return {
        ok: false,
        error: "narrated mode requires options.narrated.orchestrator",
        failedAtStep: "dispatch",
      };
    }
    return executePlanNarrated(db, planId, options, options.narrated);
  }
  return executePlanAtomic(db, planId, options);
};
