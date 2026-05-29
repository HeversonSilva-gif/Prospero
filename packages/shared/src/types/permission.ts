export type PermissionRequest = {
  toolUseId: string;
  agentId: string;
  toolName: string;
  toolInput: unknown;
};

export type PermissionResolution =
  | { behavior: "allow"; decidedBy?: string }
  | { behavior: "deny"; message: string; decidedBy?: string }
  // Written by the scheduler to reclaim a slot from an agent that has been
  // blocked on this approval long enough (the v0.1.37 slot-starvation fix). The
  // agent's request_permission RETURNS (turn ends cleanly, no kill mid-call) but
  // the approval stays PENDING — when it is later decided for real, the agent is
  // re-engaged and the action re-runs. `deferred` is never a user/CEO decision.
  | { behavior: "deferred"; decidedBy?: string };
