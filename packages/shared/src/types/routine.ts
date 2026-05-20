// M15 — Routine: an agent target + an instruction, fired on a schedule or on
// a fixed activity event. The shared layer is type-only (no zod — see lesson
// project_m7_6_lessons); zod input validation lives in apps/main/src/schemas.

export type RoutineTriggerType = "schedule" | "event";

export type ScheduleSpec =
  | { freq: "daily"; atMinute: number }
  | { freq: "weekly"; weekday: number; atMinute: number }
  | { freq: "monthly"; day: number; atMinute: number }
  | { freq: "interval"; everyMinutes: number };

export type RoutineEventType =
  | "goal_achieved"
  | "verification_failed"
  | "issue_done"
  | "agent_recovered";

export interface EventSpec {
  eventType: RoutineEventType;
}

export interface Routine {
  id: string;
  companyId: string;
  name: string;
  enabled: boolean;
  triggerType: RoutineTriggerType;
  scheduleSpec: ScheduleSpec | null;
  nextFireAt: number | null;
  eventSpec: EventSpec | null;
  targetAgentId: string;
  instruction: string;
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type FireReason = "scheduled" | "catchup" | "event" | "manual";
