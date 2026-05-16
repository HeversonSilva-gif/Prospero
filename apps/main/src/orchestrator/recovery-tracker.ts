// Tracks, per agent, whether the agent's last run ended in a terminal error.
// M11: the orchestrator marks an agent errored on spawn error / non-zero exit;
// the next successful turn-complete "consumes" the flag and emits an
// `agent.recovered` activity. In-process state — one tracker per app process.
export type RecoveryTracker = {
  markErrored(agentId: string): void;
  // Returns true exactly once if the agent was errored, and clears the flag.
  consumeRecovery(agentId: string): boolean;
};

export const createRecoveryTracker = (): RecoveryTracker => {
  const errored = new Set<string>();
  return {
    markErrored(agentId) {
      errored.add(agentId);
    },
    consumeRecovery(agentId) {
      if (!errored.has(agentId)) return false;
      errored.delete(agentId);
      return true;
    },
  };
};
