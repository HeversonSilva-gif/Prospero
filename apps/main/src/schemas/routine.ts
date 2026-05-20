import { z } from "zod";

// M15 PR-A — Zod validation lives main-side (shared has no zod dep).
// Mirrors packages/shared/src/types/routine.ts.

const ScheduleSpecSchema = z.discriminatedUnion("freq", [
  z.object({
    freq: z.literal("daily"),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("monthly"),
    day: z.number().int().min(1).max(28),
    atMinute: z.number().int().min(0).max(1439),
  }),
  z.object({
    freq: z.literal("interval"),
    everyMinutes: z.number().int().min(1),
  }),
]);

const EventSpecSchema = z.object({
  eventType: z.enum(["goal_achieved", "verification_failed", "issue_done", "agent_recovered"]),
});

const baseFields = {
  companyId: z.string().min(1),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  targetAgentId: z.string().min(1),
  instruction: z.string().min(1).max(4000),
};

// One-of-two-shapes: a `schedule` routine must include scheduleSpec; an
// `event` routine must include eventSpec. discriminatedUnion enforces this.
export const ROUTINE_CREATE_INPUT_SCHEMA = z.discriminatedUnion("triggerType", [
  z.object({
    triggerType: z.literal("schedule"),
    scheduleSpec: ScheduleSpecSchema,
    ...baseFields,
  }),
  z.object({
    triggerType: z.literal("event"),
    eventSpec: EventSpecSchema,
    ...baseFields,
  }),
]);

export type RoutineCreateInput = z.infer<typeof ROUTINE_CREATE_INPUT_SCHEMA>;

// Updates are a partial — every mutable field is optional but `id` is required.
// If scheduleSpec or eventSpec is provided, its shape is fully validated.
export const ROUTINE_UPDATE_INPUT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  scheduleSpec: ScheduleSpecSchema.optional(),
  eventSpec: EventSpecSchema.optional(),
  targetAgentId: z.string().min(1).optional(),
  instruction: z.string().min(1).max(4000).optional(),
});

export type RoutineUpdateInput = z.infer<typeof ROUTINE_UPDATE_INPUT_SCHEMA>;
