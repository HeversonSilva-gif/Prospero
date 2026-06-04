// Runtime heal for stuck `waiting` zombies.
//
// An agent goes to `waiting` when it is blocked on an approval. Normally the
// decision is delivered and the agent resumes. But if that delivery is lost (the
// re-engage marker / router queue is RAM-only and wiped on restart, or the
// resolved decision never reaches the agent), the agent stays `waiting` forever.
// `resetStuckAgents` heals this — but only at BOOT; the runtime heal
// (healErroredAgents) covers only `error`. A long-running app therefore strands
// such an agent until the next restart, AND the zombie can mask the reconciler's
// "team stalled" signal (it looks engaged), so the CEO is never re-woken.
//
// This is the pure decision: which `waiting` agents are stuck and safe to reset
// back to idle. Safe = their blocker is already resolved (no pending approval)
// AND they've been waiting past a grace period (so a just-delivered decision in
// flight this tick is not raced back to idle).

export type WaitingAgent = { id: string; updatedAt: number };

export const stuckWaitingAgentIds = (input: {
  waiting: WaitingAgent[];
  pendingApprovalAgentIds: Set<string>;
  now: number;
  staleMs: number;
}): string[] => {
  const { waiting, pendingApprovalAgentIds, now, staleMs } = input;
  return waiting
    .filter((a) => !pendingApprovalAgentIds.has(a.id)) // still blocked → leave it
    .filter((a) => now - a.updatedAt >= staleMs) // entered waiting too recently → don't race
    .map((a) => a.id);
};
