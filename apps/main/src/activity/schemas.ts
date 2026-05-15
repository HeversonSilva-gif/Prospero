// Zod payload schemas — one per ActivityAction.
// The `satisfies Record<ActivityAction, z.ZodTypeAny>` guarantees at typecheck
// time that every action has a schema; adding a new action to ACTIVITY_ACTIONS
// without a schema here is a compile error.

import { z } from "zod";
import type { ActivityAction } from "@prospero/shared";

const stringId = z.string().min(1);

export const ActivityPayloads = {
  // Agent (10)
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

  // Approval (3)
  "approval.requested": z.object({
    kind: z.string(),
    toolName: z.string().optional(),
  }),
  "approval.approved": z.object({
    approvalId: stringId,
    note: z.string().optional(),
  }),
  "approval.rejected": z.object({
    approvalId: stringId,
    note: z.string().optional(),
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
} satisfies Record<ActivityAction, z.ZodTypeAny>;
