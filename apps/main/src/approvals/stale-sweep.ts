// Detects orphaned pending approvals so they can be expired.
//
// An approval is created `pending` and the requesting agent goes `waiting` until
// it is decided. If the decision is lost (the agent's turn ended, it was healed
// back to idle, or the RAM delivery was wiped on restart) the approval stays
// `pending` forever while the agent moves on. That orphan keeps the agent in
// pendingAgentIds(), so the autonomous re-engagement (idle-assignee-wake) treats
// it as "blocked on a decision" and NEVER wakes it — a permanent stall (observed
// 2026-06-05: a 20h-old tool_call approval for an idle agent).
//
// Pure decision: which pending approvals to expire. An approval is orphaned when
// its agent is NOT currently `waiting` (so it isn't actually blocked on it) AND
// the approval has been pending past a TTL (guards the brief race between an agent
// creating an approval and its status flipping to `waiting`). An approval whose
// agent IS waiting is left untouched — that is a legitimate, possibly slow human
// decision.

export type PendingApproval = { id: string; agentId: string; createdAt: number };

export const staleApprovalIdsToExpire = (input: {
  pending: PendingApproval[];
  waitingAgentIds: Set<string>;
  now: number;
  ttlMs: number;
}): string[] => {
  const { pending, waitingAgentIds, now, ttlMs } = input;
  return pending
    .filter((a) => !waitingAgentIds.has(a.agentId)) // agent isn't blocked on it → orphaned
    .filter((a) => now - a.createdAt >= ttlMs) // old enough to be sure (not a fresh race)
    .map((a) => a.id);
};
