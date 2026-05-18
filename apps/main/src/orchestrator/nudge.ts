// M11 PR-F2: the memory nudge — a fallback that reminds an agent to capture or
// consolidate knowledge when the auto-derivation pipeline (PR-D) has been quiet.
//
// A nudge is a one-line hint the orchestrator prepends to the agent's NEXT turn
// (via the router's pendingNudge slot). Two triggers:
//   - work volume: TURN_THRESHOLD turns OR TOOL_THRESHOLD cumulative tool calls
//     since the last nudge — the agent has done enough that something is worth
//     saving as a skill or memory.
//   - memory pressure: the agent's declarative memory is near its prompt cap —
//     a one-time-per-session consolidation hint.
//
// The counters are per-agent and per claude-process session: the orchestrator
// calls clear() on session-init so a fresh process starts from zero.

// Turns since the last nudge before the work-volume hint fires.
export const TURN_THRESHOLD = 30;
// Cumulative tool calls since the last nudge before the work-volume hint fires.
export const TOOL_THRESHOLD = 25;

export const NUDGE_SKILL_HINT =
  "[memory note] You've completed a fair amount of work since the last " +
  "checkpoint. If any of it is a reusable procedure worth repeating, save it " +
  "with skill_create. If it is a durable fact worth remembering, use memory_add.";

export const NUDGE_CONSOLIDATION_HINT =
  "[memory note] Your declarative memory is nearly full. Consolidate it before " +
  "adding more: drop stale entries with memory_remove, or merge overlapping ones.";

export type NudgeInput = {
  // Distinct tool calls in the turn that just completed.
  toolUseCount: number;
  // True when the agent's rendered declarative memory is past 90% of its cap.
  memoryNearFull: boolean;
};

export type NudgeTracker = {
  // Records one completed turn; returns a hint to inject into the agent's next
  // turn, or null. Resets the work counters when the work-volume hint fires.
  recordTurn(agentId: string, input: NudgeInput): string | null;
  // Forgets an agent's counters — call on session-init (fresh claude process).
  clear(agentId: string): void;
};

type AgentNudgeState = {
  turns: number;
  tools: number;
  consolidationSent: boolean;
};

export const createNudgeTracker = (): NudgeTracker => {
  const states = new Map<string, AgentNudgeState>();

  const ensure = (agentId: string): AgentNudgeState => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { turns: 0, tools: 0, consolidationSent: false };
      states.set(agentId, s);
    }
    return s;
  };

  return {
    recordTurn(agentId, input) {
      const s = ensure(agentId);
      s.turns += 1;
      s.tools += Math.max(0, input.toolUseCount);

      // Memory pressure wins, and only fires once per session.
      if (input.memoryNearFull && !s.consolidationSent) {
        s.consolidationSent = true;
        return NUDGE_CONSOLIDATION_HINT;
      }

      if (s.turns >= TURN_THRESHOLD || s.tools >= TOOL_THRESHOLD) {
        s.turns = 0;
        s.tools = 0;
        return NUDGE_SKILL_HINT;
      }
      return null;
    },
    clear(agentId) {
      states.delete(agentId);
    },
  };
};
