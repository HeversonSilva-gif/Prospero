import { describe, it, expect, vi } from "vitest";
import type { Agent, Routine } from "@prospero/shared";
import { fireRoutine, type FireRoutineDeps } from "./fire.js";

const routine: Routine = {
  id: "r1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 100,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "Run standup",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const liveAgent = (overrides: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    companyId: "c1",
    name: "Bob",
    role: "engineer",
    systemPrompt: "",
    model: "claude-sonnet-4-6",
    status: "idle",
    mode: "supervised",
    alwaysOn: false,
    capabilities: [],
    trustTier: "novato",
    autoModeSetAt: null,
    pauseReason: null,
    ...overrides,
  }) as Agent;

const makeDeps = (overrides: Partial<FireRoutineDeps> = {}): FireRoutineDeps => ({
  getAgent: () => liveAgent(),
  ensureAgentRunner: vi.fn(),
  enqueue: vi.fn(),
  primaryThreadId: () => "thread-1",
  recordActivity: vi.fn(),
  ...overrides,
});

describe("fireRoutine", () => {
  it("happy path — enqueues with kind 'routine' and records routine.fired", () => {
    const deps = makeDeps();
    fireRoutine(routine, "scheduled", deps);
    expect(deps.ensureAgentRunner).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      "a1",
      "thread-1",
      "Run standup",
      expect.objectContaining({ kind: "routine", id: "r1", name: "Routine: Standup" }),
    );
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.fired",
        entityId: "r1",
        payload: { reason: "scheduled" },
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent missing", () => {
    const deps = makeDeps({ getAgent: () => null });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent terminated", () => {
    const deps = makeDeps({ getAgent: () => liveAgent({ status: "terminated" }) });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("skips with 'budget_paused' when agent budget-paused", () => {
    const deps = makeDeps({
      getAgent: () => liveAgent({ status: "paused", pauseReason: "budget_exceeded_agent" }),
    });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ reason: "budget_paused" }),
      }),
    );
  });

  it("skips with 'agent_unavailable' when agent user-paused", () => {
    const deps = makeDeps({
      getAgent: () => liveAgent({ status: "paused", pauseReason: "user requested" }),
    });
    fireRoutine(routine, "scheduled", deps);
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "routine.skipped",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: expect.objectContaining({ reason: "agent_unavailable" }),
      }),
    );
  });

  it("forwards manual reason in payload", () => {
    const deps = makeDeps();
    fireRoutine(routine, "manual", deps);
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { reason: "manual" } }),
    );
  });
});
