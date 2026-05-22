// Zod payload schemas — one per ActivityAction.
// The `satisfies Record<ActivityAction, z.ZodTypeAny>` guarantees at typecheck
// time that every action has a schema; adding a new action to ACTIVITY_ACTIONS
// without a schema here is a compile error.

import { z } from "zod";
import type { ActivityAction } from "@prospero/shared";

const stringId = z.string().min(1);

export const ActivityPayloads = {
  // Agent (13)
  "agent.hired": z.object({
    name: z.string(),
    role: z.string(),
    model: z.string().optional(),
  }),
  "agent.role_changed": z.object({ from: z.string(), to: z.string() }),
  "agent.model_changed": z.object({ from: z.string(), to: z.string() }),
  "agent.mode_changed": z.object({
    from: z.enum(["supervised", "auto"]),
    to: z.enum(["supervised", "auto"]),
  }),
  "agent.always_on_changed": z.object({
    from: z.boolean(),
    to: z.boolean(),
  }),
  "agent.persona_edited": z.object({ summary: z.string().optional() }),
  "agent.capabilities_changed": z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
  "agent.reports_to_changed": z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  "agent.allowed_projects_changed": z.object({ projects: z.array(z.string()) }),
  "agent.paused": z.object({ reason: z.string().optional() }),
  "agent.resumed": z.object({}),
  "agent.terminated": z.object({ reason: z.string().optional() }),
  "agent.recovered": z.object({ issueId: z.string().nullable().optional() }),

  // Issue (5)
  "issue.created": z.object({
    identifier: z.string(),
    title: z.string(),
    assigneeAgentId: stringId.nullable(),
  }),
  "issue.status_changed": z.object({ from: z.string(), to: z.string() }),
  "issue.assignee_changed": z.object({
    from: stringId.nullable(),
    to: stringId.nullable(),
  }),
  "issue.priority_changed": z.object({ from: z.string(), to: z.string() }),
  "issue.comment_added": z.object({
    commentId: stringId,
    preview: z.string().optional(),
  }),
  "issue.commented": z.object({
    commentId: stringId,
    length: z.number().int().nonnegative(),
  }),
  "issue.unlocked_by_deps": z.object({
    unlockedBy: stringId,
  }),

  // Approval (6) — +3 from manager request feature
  "approval.requested": z.object({
    kind: z.string(),
    toolName: z.string().optional(),
  }),
  "approval.escalated": z.object({
    approvalId: z.string(),
    reason: z.enum(["ceo_choice", "timeout", "rule", "restart", "no_ceo"]),
  }),
  "approval.approved": z.object({
    approvalId: stringId,
    note: z.string().optional(),
  }),
  "approval.rejected": z.object({
    approvalId: stringId,
    note: z.string().optional(),
  }),
  "manager_request.created": z.object({
    approvalId: z.string(),
    topic: z.string(),
    routedTo: z.enum(["ceo", "user"]),
  }),
  "manager_request.decided": z.object({
    approvalId: z.string(),
    decision: z.enum(["approved", "rejected"]),
    decidedBy: z.string(),
  }),

  // Project (3)
  "project.created": z.object({ name: z.string() }),
  "project.updated": z.object({ patch: z.record(z.unknown()) }),
  "project.deleted": z.object({ name: z.string() }),

  // Goal (6) — M8.5 wires real payloads
  "goal.created": z.object({
    title: z.string(),
    level: z.enum(["company", "team", "agent", "task"]),
    parentGoalId: z.string().nullable().optional(),
  }),
  "goal.plan_proposed": z.object({
    planId: stringId,
    version: z.number().int().positive(),
    agentsCount: z.number().int().nonnegative(),
    issuesCount: z.number().int().nonnegative(),
    estimatedCostCents: z.number().int().nullable().optional(),
  }),
  "goal.plan_approved": z.object({
    planId: stringId,
    version: z.number().int().positive(),
    hiredAgentIds: z.array(stringId),
    createdIssueIds: z.array(stringId),
    approvedBy: z.enum(["user", "system", "ceo-narrated"]),
  }),
  "goal.plan_rejected": z.object({
    planId: stringId,
    version: z.number().int().positive(),
    reason: z.enum(["rejected", "superseded"]),
    userFeedback: z.string().nullable().optional(),
  }),
  "goal.status_changed": z.object({
    from: z.string(),
    to: z.string(),
    reason: z.string().nullable().optional(),
  }),
  "goal.subgoal_recorded": z.object({
    childGoalId: stringId,
    recordedByAgentId: stringId,
  }),
  "goal.narrated_step": z.object({
    step: z.enum(["hire", "issue", "comment"]),
    planIndex: z.number().int().nonnegative(),
    agentId: stringId.optional(),
    issueId: stringId.optional(),
  }),

  // Session / Cost (3)
  "session.started": z.object({}),
  "session.ended": z.object({ durationMs: z.number().int().optional() }),
  "cost.day_summary": z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalUsd: z.number(),
  }),

  // Company (2)
  "company.created": z.object({ name: z.string() }),
  "company.updated": z.object({ patch: z.record(z.unknown()) }),

  // Verification (1) — M13 PR-D dispatcher trigger
  "verification.failed": z.object({
    goalId: stringId,
    failedCriteria: z.array(stringId),
  }),

  // Security (1) — M13 PR-E containment zone blocked
  "security.zone_blocked": z.object({
    attemptedPath: z.string(),
    zoneKind: z.enum(["company", "agent", "shared", "system"]),
    reason: z.string(),
  }),

  // Trust (4) — M14 PR-A trust ladder
  "trust.promoted": z.object({
    fromTier: z.enum(["novato", "confiavel", "autonomo"]),
    toTier: z.enum(["novato", "confiavel", "autonomo"]),
    reason: z.string(),
  }),
  "trust.demoted": z.object({
    fromTier: z.enum(["novato", "confiavel", "autonomo"]),
    toTier: z.enum(["novato", "confiavel", "autonomo"]),
    reason: z.string(),
  }),
  "trust.promotion_suggested": z.object({
    fromTier: z.enum(["novato", "confiavel", "autonomo"]),
    toTier: z.enum(["novato", "confiavel", "autonomo"]),
    reason: z.string(),
    inboxItemId: z.string(),
  }),
  "trust.readonly_autoapproved": z.object({
    toolName: z.string(),
    inputHash: z.string().optional(),
  }),

  // Routine (2) — M15 PR-A
  "routine.fired": z.object({
    reason: z.enum(["scheduled", "catchup", "event", "manual"]),
  }),
  "routine.skipped": z.object({
    reason: z.enum(["agent_unavailable", "budget_paused"]),
    detail: z.string().optional(),
  }),
} satisfies Record<ActivityAction, z.ZodTypeAny>;
