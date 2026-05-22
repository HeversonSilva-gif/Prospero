export type ApprovalKind =
  | "tool_call"
  | "code_review"
  | "hire_confirm"
  | "budget_override"
  | "goal_plan"
  | "manager_request";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRoute = "ceo" | "user";

export type ManagerTopic = "hire" | "fire" | "budget" | "unblock" | "approach" | "other";

export type ManagerRequestPayload = {
  topic: ManagerTopic;
  summary: string;
  thread_id: string;
  data?: Record<string, unknown>;
};

export type Approval = {
  id: string;
  agentId: string | null;
  kind: ApprovalKind;
  payloadJson: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: number;
  resolvedAt: number | null;
  routedTo: ApprovalRoute | null;
  escalatedAt: number | null;
};

export type ToolCallPayload = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
};
