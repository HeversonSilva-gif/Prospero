import type { AgentRunRow } from "@prospero/shared";

export type RunSession = {
  sessionId: string | null;
  runs: AgentRunRow[];
};

// Groups runs (passed newest-first, as listRunsByAgent returns them) into
// sessions by session_id. Consecutive runs sharing a non-null session_id form
// one group; a null session_id always forms its own single-run group — there
// is no session key to bucket by. An agent runs one session at a time, so
// runs of a session are always contiguous in the sorted list.
export const groupRunsBySession = (runs: AgentRunRow[]): RunSession[] => {
  const sessions: RunSession[] = [];
  for (const run of runs) {
    const last = sessions[sessions.length - 1];
    if (last !== undefined && run.sessionId !== null && last.sessionId === run.sessionId) {
      last.runs.push(run);
    } else {
      sessions.push({ sessionId: run.sessionId, runs: [run] });
    }
  }
  return sessions;
};
