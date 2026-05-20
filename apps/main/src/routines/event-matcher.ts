import type { ActivityEventRow, EventSpec, Routine, RoutineEventType } from "@prospero/shared";

// M15 PR-A — pure function that filters event-routines whose eventType
// matches a given activity row. Mirrors derivation/dispatcher.ts#jobForActivity
// but does not look at agentId (a routine cares about the event, not the actor).

export const routinesForActivity = (row: ActivityEventRow, eventRoutines: Routine[]): Routine[] =>
  eventRoutines.filter((r) => matchesEvent(r.eventSpec, row));

const matchesEvent = (spec: EventSpec | null, row: ActivityEventRow): boolean => {
  if (spec === null) return false;
  return rowMatchesEventType(spec.eventType, row);
};

const rowMatchesEventType = (eventType: RoutineEventType, row: ActivityEventRow): boolean => {
  if (eventType === "goal_achieved") {
    return row.action === "goal.status_changed" && row.payload["to"] === "achieved";
  }
  if (eventType === "verification_failed") {
    return row.action === "verification.failed";
  }
  if (eventType === "issue_done") {
    return row.action === "issue.status_changed" && row.payload["to"] === "done";
  }
  if (eventType === "agent_recovered") {
    return row.action === "agent.recovered";
  }
  // Exhaustiveness — if a new RoutineEventType is added, this won't compile.
  const _exhaustive: never = eventType;
  return _exhaustive;
};
