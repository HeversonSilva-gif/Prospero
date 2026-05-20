import { describe, it, expect } from "vitest";
import type { ActivityEventRow, Routine, RoutineEventType } from "@prospero/shared";
import { routinesForActivity } from "./event-matcher.js";

const baseRow = (
  action: ActivityEventRow["action"],
  payload: Record<string, unknown> = {},
): ActivityEventRow => ({
  id: "act_1",
  companyId: "c1",
  actorKind: "agent",
  actorId: "a1",
  action,
  entityKind: "goal",
  entityId: "g1",
  agentId: "a1",
  payload,
  createdAt: Date.now(),
});

const routine = (eventType: RoutineEventType, enabled = true): Routine => ({
  id: `r-${eventType}`,
  companyId: "c1",
  name: eventType,
  enabled,
  triggerType: "event",
  scheduleSpec: null,
  nextFireAt: null,
  eventSpec: { eventType },
  targetAgentId: "a1",
  instruction: "x",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("routinesForActivity", () => {
  it("matches goal_achieved via goal.status_changed to=achieved", () => {
    const row = baseRow("goal.status_changed", { to: "achieved" });
    const result = routinesForActivity(row, [routine("goal_achieved"), routine("issue_done")]);
    expect(result.map((r) => r.eventSpec?.eventType)).toEqual(["goal_achieved"]);
  });

  it("does NOT match goal_achieved when goal.status_changed to=other", () => {
    const row = baseRow("goal.status_changed", { to: "planning" });
    const result = routinesForActivity(row, [routine("goal_achieved")]);
    expect(result).toEqual([]);
  });

  it("matches verification_failed via verification.failed action", () => {
    const row = baseRow("verification.failed", { goalId: "g1", failedCriteria: [] });
    const result = routinesForActivity(row, [routine("verification_failed")]);
    expect(result).toHaveLength(1);
  });

  it("matches issue_done via issue.status_changed to=done", () => {
    const row = baseRow("issue.status_changed", { to: "done" });
    const result = routinesForActivity(row, [routine("issue_done"), routine("goal_achieved")]);
    expect(result.map((r) => r.eventSpec?.eventType)).toEqual(["issue_done"]);
  });

  it("matches agent_recovered via agent.recovered", () => {
    const row = baseRow("agent.recovered");
    const result = routinesForActivity(row, [routine("agent_recovered")]);
    expect(result).toHaveLength(1);
  });

  it("returns empty for an unrelated action", () => {
    const row = baseRow("agent.hired", { name: "Bob", role: "engineer" });
    const result = routinesForActivity(row, [
      routine("goal_achieved"),
      routine("verification_failed"),
      routine("issue_done"),
      routine("agent_recovered"),
    ]);
    expect(result).toEqual([]);
  });
});
