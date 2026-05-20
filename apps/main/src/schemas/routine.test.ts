import { describe, it, expect } from "vitest";
import { ROUTINE_CREATE_INPUT_SCHEMA, ROUTINE_UPDATE_INPUT_SCHEMA } from "./routine.js";

describe("ROUTINE_CREATE_INPUT_SCHEMA", () => {
  const baseSchedule = {
    companyId: "c1",
    name: "Standup",
    enabled: true,
    triggerType: "schedule" as const,
    scheduleSpec: { freq: "daily" as const, atMinute: 540 },
    targetAgentId: "a1",
    instruction: "Run standup",
  };
  const baseEvent = {
    companyId: "c1",
    name: "Watch goals",
    enabled: true,
    triggerType: "event" as const,
    eventSpec: { eventType: "goal_achieved" as const },
    targetAgentId: "a1",
    instruction: "React",
  };

  it("accepts a valid schedule input", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse(baseSchedule);
    expect(r.success).toBe(true);
  });

  it("accepts a valid event input", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse(baseEvent);
    expect(r.success).toBe(true);
  });

  it("rejects schedule without scheduleSpec", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: undefined,
    });
    expect(r.success).toBe(false);
  });

  it("rejects event without eventSpec", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseEvent,
      eventSpec: undefined,
    });
    expect(r.success).toBe(false);
  });

  it("rejects scheduleSpec with atMinute out of [0, 1440)", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "daily", atMinute: 1440 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects weekly with weekday out of [0,6]", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "weekly", weekday: 7, atMinute: 540 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects monthly with day=0 or day>28", () => {
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
        ...baseSchedule,
        scheduleSpec: { freq: "monthly", day: 0, atMinute: 540 },
      }).success,
    ).toBe(false);
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
        ...baseSchedule,
        scheduleSpec: { freq: "monthly", day: 29, atMinute: 540 },
      }).success,
    ).toBe(false);
  });

  it("rejects interval with everyMinutes < 1", () => {
    const r = ROUTINE_CREATE_INPUT_SCHEMA.safeParse({
      ...baseSchedule,
      scheduleSpec: { freq: "interval", everyMinutes: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty name and empty instruction", () => {
    expect(ROUTINE_CREATE_INPUT_SCHEMA.safeParse({ ...baseSchedule, name: "" }).success).toBe(
      false,
    );
    expect(
      ROUTINE_CREATE_INPUT_SCHEMA.safeParse({ ...baseSchedule, instruction: "" }).success,
    ).toBe(false);
  });
});

describe("ROUTINE_UPDATE_INPUT_SCHEMA", () => {
  it("accepts a partial patch with just enabled", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({ id: "r1", enabled: false });
    expect(r.success).toBe(true);
  });

  it("requires an id", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({ enabled: false });
    expect(r.success).toBe(false);
  });

  it("when scheduleSpec is provided, validates its shape", () => {
    const r = ROUTINE_UPDATE_INPUT_SCHEMA.safeParse({
      id: "r1",
      scheduleSpec: { freq: "daily", atMinute: 9999 },
    });
    expect(r.success).toBe(false);
  });
});
