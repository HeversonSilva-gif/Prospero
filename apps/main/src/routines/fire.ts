import type { Agent, FireReason, Routine } from "@prospero/shared";
import type { RecordActivityInput } from "../activity/recorder.js";
import type { Sender } from "../orchestrator/router.js";

// M15 PR-A — `fireRoutine` is the only place that "wakes" an agent on behalf
// of a routine. Deps are injected so we can unit-test without electron/router.
// On skip, we record `routine.skipped` with one of two reasons (matches the
// Vitrine-Matinal copy in M14 PR-C):
//   - agent_unavailable: agent gone, terminated, or user-paused.
//   - budget_paused:     agent paused specifically by the budget enforcer.

export interface FireRoutineDeps {
  getAgent: (id: string) => Agent | null;
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
  recordActivity: (input: RecordActivityInput) => void;
}

export const fireRoutine = (routine: Routine, reason: FireReason, deps: FireRoutineDeps): void => {
  const skip = (skipReason: "agent_unavailable" | "budget_paused", detail?: string): void => {
    deps.recordActivity({
      companyId: routine.companyId,
      actor: { kind: "system" },
      action: "routine.skipped",
      entityKind: "routine",
      entityId: routine.id,
      agentId: routine.targetAgentId,
      payload: detail === undefined ? { reason: skipReason } : { reason: skipReason, detail },
    });
  };

  const agent = deps.getAgent(routine.targetAgentId);

  if (agent === null || agent.status === "terminated") {
    skip("agent_unavailable", agent === null ? "missing" : "terminated");
    return;
  }
  if (agent.status === "paused") {
    if (agent.pauseReason === "budget_exceeded_agent") {
      skip("budget_paused");
    } else {
      skip("agent_unavailable", "paused");
    }
    return;
  }

  deps.ensureAgentRunner(agent);
  deps.enqueue(agent.id, deps.primaryThreadId(agent.id), routine.instruction, {
    kind: "routine",
    id: routine.id,
    name: `Routine: ${routine.name}`,
  });
  deps.recordActivity({
    companyId: routine.companyId,
    actor: { kind: "system" },
    action: "routine.fired",
    entityKind: "routine",
    entityId: routine.id,
    agentId: agent.id,
    payload: { reason },
  });
};
