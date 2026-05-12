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
  | "goal";

// Runtime list — drives exhaustive Zod schema coverage in apps/main.
export const ACTIVITY_ACTIONS = [
  // Agent (12)
  "agent.hired",
  "agent.role_changed",
  "agent.model_changed",
  "agent.mode_changed",
  "agent.always_on_changed",
  "agent.persona_edited",
  "agent.skills_changed",
  "agent.reports_to_changed",
  "agent.allowed_projects_changed",
  "agent.paused",
  "agent.resumed",
  "agent.terminated",
  // Issue (5)
  "issue.created",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.priority_changed",
  "issue.comment_added",
  // Approval (3)
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  // Project (3)
  "project.created",
  "project.updated",
  "project.deleted",
  // Goal (4) — defined, not emitted until M8.5
  "goal.created",
  "goal.plan_proposed",
  "goal.plan_approved",
  "goal.status_changed",
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
