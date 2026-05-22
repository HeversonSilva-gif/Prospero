// Activity Stream types (M7.7) — shared contracts.
// Zod payload schemas live in apps/main/src/activity/schemas.ts (renderer
// does not need runtime validators; shared has no zod dep).

export type ActorKind = "user" | "agent" | "system";

export type Actor = { kind: "user" } | { kind: "agent"; id: string } | { kind: "system" };

export type EntityKind =
  | "agent"
  | "issue"
  | "project"
  | "approval"
  | "session"
  | "company"
  | "goal"
  | "routine";

// Runtime list — drives exhaustive Zod schema coverage in apps/main.
export const ACTIVITY_ACTIONS = [
  // Agent (13)
  "agent.hired",
  "agent.role_changed",
  "agent.model_changed",
  "agent.mode_changed",
  "agent.always_on_changed",
  "agent.persona_edited",
  "agent.capabilities_changed",
  "agent.reports_to_changed",
  "agent.allowed_projects_changed",
  "agent.paused",
  "agent.resumed",
  "agent.terminated",
  "agent.recovered",
  // Issue (7) — +2 from M8.6
  "issue.created",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.priority_changed",
  "issue.comment_added",
  "issue.commented",
  "issue.unlocked_by_deps",
  // Approval (6) — +3 from manager request feature
  "approval.requested",
  "approval.escalated",
  "approval.approved",
  "approval.rejected",
  "manager_request.created",
  "manager_request.decided",
  // Project (3)
  "project.created",
  "project.updated",
  "project.deleted",
  // Goal (7) — +1 from M8.6 narrated step
  "goal.created",
  "goal.plan_proposed",
  "goal.plan_approved",
  "goal.plan_rejected",
  "goal.status_changed",
  "goal.subgoal_recorded",
  "goal.narrated_step",
  // Verification (1) — M13 PR-D; dispatcher trigger
  "verification.failed",
  // Security (1) — M13 PR-E; containment zone blocked
  "security.zone_blocked",
  // Trust (4) — M14 PR-A trust ladder
  "trust.promoted",
  "trust.demoted",
  "trust.promotion_suggested",
  "trust.readonly_autoapproved",
  // Routine (2) — M15 PR-A
  "routine.fired",
  "routine.skipped",
  // Session / Cost (3) — session.* optional in PR-A; cost.day_summary depends M8
  "session.started",
  "session.ended",
  "cost.day_summary",
  // Company (2)
  "company.created",
  "company.updated",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEventRow {
  id: string;
  companyId: string;
  actorKind: ActorKind;
  actorId: string | null;
  action: ActivityAction;
  entityKind: EntityKind;
  entityId: string;
  agentId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface ActivityQueryFilters {
  actorKind?: ActorKind;
  action?: ActivityAction;
  entityKind?: EntityKind;
  entityId?: string;
  agentId?: string;
  sinceMs?: number;
  untilMs?: number;
}

export interface ActivityQueryParams {
  companyId: string;
  filters?: ActivityQueryFilters;
  cursor?: { beforeCreatedAt: number; beforeId: string };
  limit?: number;
}
