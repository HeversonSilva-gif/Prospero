export type InboxKind =
  | "approval"
  | "completed"
  | "suggestion"
  | "error"
  | "security_alert"
  | "goal_proposed"
  | "goal_executing"
  | "goal_error"
  | "agent_unresponsive"
  | "skill_candidate_pending"
  | "skill_promotion_requested"
  | "goal_retrospective_ready"
  | "memory_review_needed"
  | "org_proposed"
  | "budget_warning"
  | "verification_failed"
  | "verification_review"
  | "security_zone_blocked"
  | "trust_promotion_suggested"
  | "auto_mode_expired"
  | "manager_request"
  | "ceo_decision"
  | "skill_consolidation_proposed"
  | "business_proposed"
  | "sale";

export type InboxItem = {
  id: string;
  companyId: string;
  kind: InboxKind;
  actorId: string | null;
  title: string;
  preview: string | null;
  payloadJson: string | null;
  requiresAction: boolean;
  approvalId: string | null;
  readAt: number | null;
  createdAt: number;
};
