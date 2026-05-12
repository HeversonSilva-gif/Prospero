export type ApprovalKind =
  | "tool_call"
  | "code_review"
  | "hire_confirm"
  | "budget_override"
  | "goal_plan";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

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
};

export type ToolCallPayload = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
};
