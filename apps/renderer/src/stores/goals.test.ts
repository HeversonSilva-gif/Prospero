import { describe, expect, it, beforeEach, vi } from "vitest";
import { useGoalsStore } from "./goals.js";
import type { Goal, GoalWithPlan } from "@prospero/shared";

const ipcMock = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  requestPlan: vi.fn(),
  approvePlan: vi.fn(),
  requestChanges: vi.fn(),
  rejectPlan: vi.fn(),
  narratedResume: vi.fn(),
  narratedRollback: vi.fn(),
};

const mkGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "g_1",
  companyId: "co_1",
  title: "Goal 1",
  description: null,
  level: "task",
  status: "draft",
  parentGoalId: null,
  ownerAgentId: null,
  budgetMaxTokens: null,
  deadline: null,
  successCriteria: null,
  isaPath: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as unknown as {
      window: { prospero: { goals: typeof ipcMock } };
    }
  ).window = {
    prospero: { goals: ipcMock },
  };
  useGoalsStore.setState({ goals: [], detail: null, loaded: false, loading: false });
});

describe("useGoalsStore", () => {
  it("load fetches from IPC and marks loaded", async () => {
    ipcMock.list.mockResolvedValue([mkGoal()]);
    await useGoalsStore.getState().load("co_1");
    expect(ipcMock.list).toHaveBeenCalledWith({ companyId: "co_1" });
    expect(useGoalsStore.getState().loaded).toBe(true);
    expect(useGoalsStore.getState().goals).toHaveLength(1);
  });

  it("load forwards status filter when provided", async () => {
    ipcMock.list.mockResolvedValue([]);
    await useGoalsStore.getState().load("co_1", "planning");
    expect(ipcMock.list).toHaveBeenCalledWith({ companyId: "co_1", status: "planning" });
  });

  it("create inserts new goal at the head of the list", async () => {
    useGoalsStore.setState({ goals: [mkGoal({ id: "g_existing" })] });
    const newGoal = mkGoal({ id: "g_new", title: "New" });
    ipcMock.create.mockResolvedValue(newGoal);
    const result = await useGoalsStore.getState().create({ companyId: "co_1", title: "New" });
    expect(result.id).toBe("g_new");
    expect(useGoalsStore.getState().goals[0]?.id).toBe("g_new");
    expect(useGoalsStore.getState().goals).toHaveLength(2);
  });

  it("loadDetail stores the GoalWithPlan response", async () => {
    const detail: GoalWithPlan = { ...mkGoal({ id: "g_42" }), currentPlan: null, history: [] };
    ipcMock.get.mockResolvedValue(detail);
    await useGoalsStore.getState().loadDetail("g_42");
    expect(useGoalsStore.getState().detail?.id).toBe("g_42");
  });

  it("clearDetail nulls out the detail slot", () => {
    useGoalsStore.setState({
      detail: { ...mkGoal(), currentPlan: null, history: [] },
    });
    useGoalsStore.getState().clearDetail();
    expect(useGoalsStore.getState().detail).toBeNull();
  });

  it("requestPlan refetches detail when goal is currently shown", async () => {
    const detail: GoalWithPlan = { ...mkGoal({ id: "g_5" }), currentPlan: null, history: [] };
    useGoalsStore.setState({ detail });
    ipcMock.requestPlan.mockResolvedValue({ ok: true });
    ipcMock.get.mockResolvedValue({ ...detail, status: "planning" });
    await useGoalsStore.getState().requestPlan("g_5");
    expect(ipcMock.requestPlan).toHaveBeenCalledWith({ goalId: "g_5" });
    expect(ipcMock.get).toHaveBeenCalledWith({ id: "g_5" });
    expect(useGoalsStore.getState().detail?.status).toBe("planning");
  });

  it("approvePlan refetches detail on success and returns result", async () => {
    const detail: GoalWithPlan = {
      ...mkGoal(),
      currentPlan: {
        id: "p_1",
        goalId: "g_1",
        version: 1,
        proposedByAgentId: "a_ceo",
        summary: "x",
        agentsToHire: [],
        issuesToCreate: [],
        estimatedTotalTokens: null,
        estimatedDurationDays: null,
        estimatedCostCents: null,
        risks: [],
        status: "proposed",
        userFeedback: null,
        proposedAt: 1,
        decidedAt: null,
        decidedBy: null,
      },
      history: [],
    };
    useGoalsStore.setState({ detail });
    ipcMock.approvePlan.mockResolvedValue({
      ok: true,
      hiredAgentIds: ["a_1"],
      createdIssueIds: ["i_1"],
    });
    ipcMock.get.mockResolvedValue({ ...detail, status: "in_progress" });
    const r = await useGoalsStore.getState().approvePlan("p_1");
    expect(r.ok).toBe(true);
    expect(ipcMock.get).toHaveBeenCalledWith({ id: "g_1" });
  });

  it("approvePlan does NOT refetch when plan id does not match current detail", async () => {
    const detail: GoalWithPlan = { ...mkGoal(), currentPlan: null, history: [] };
    useGoalsStore.setState({ detail });
    ipcMock.approvePlan.mockResolvedValue({
      ok: true,
      hiredAgentIds: [],
      createdIssueIds: [],
    });
    await useGoalsStore.getState().approvePlan("p_other");
    expect(ipcMock.get).not.toHaveBeenCalled();
  });

  it("rejectPlan forwards reason when provided", async () => {
    ipcMock.rejectPlan.mockResolvedValue({ ok: true });
    await useGoalsStore.getState().rejectPlan("p_1", "not aligned with quarter");
    expect(ipcMock.rejectPlan).toHaveBeenCalledWith({
      planId: "p_1",
      reason: "not aligned with quarter",
    });
  });

  it("rejectPlan omits reason when undefined (strict optional)", async () => {
    ipcMock.rejectPlan.mockResolvedValue({ ok: true });
    await useGoalsStore.getState().rejectPlan("p_1");
    expect(ipcMock.rejectPlan).toHaveBeenCalledWith({ planId: "p_1" });
  });

  it("upsert replaces an existing goal by id", () => {
    useGoalsStore.setState({
      goals: [mkGoal({ id: "g_1", title: "Old" })],
    });
    useGoalsStore.getState().upsert(mkGoal({ id: "g_1", title: "New" }));
    expect(useGoalsStore.getState().goals[0]?.title).toBe("New");
    expect(useGoalsStore.getState().goals).toHaveLength(1);
  });

  it("upsert inserts when goal not present", () => {
    useGoalsStore.setState({ goals: [mkGoal({ id: "g_existing" })] });
    useGoalsStore.getState().upsert(mkGoal({ id: "g_new" }));
    expect(useGoalsStore.getState().goals).toHaveLength(2);
    expect(useGoalsStore.getState().goals[0]?.id).toBe("g_new");
  });

  it("remove clears detail when removed id matches", () => {
    const goal = mkGoal({ id: "g_x" });
    useGoalsStore.setState({
      goals: [goal],
      detail: { ...goal, currentPlan: null, history: [] },
    });
    useGoalsStore.getState().remove("g_x");
    expect(useGoalsStore.getState().goals).toHaveLength(0);
    expect(useGoalsStore.getState().detail).toBeNull();
  });

  it("approvePlan forwards mode='narrated' when provided", async () => {
    ipcMock.approvePlan.mockResolvedValue({
      ok: true,
      hiredAgentIds: [],
      createdIssueIds: [],
    });
    await useGoalsStore.getState().approvePlan("p_1", { mode: "narrated" });
    expect(ipcMock.approvePlan).toHaveBeenCalledWith({ planId: "p_1", mode: "narrated" });
  });

  it("narratedResume forwards goalId and refetches detail when shown", async () => {
    const detail: GoalWithPlan = {
      ...mkGoal({ id: "g_n" }),
      currentPlan: null,
      history: [],
    };
    useGoalsStore.setState({ detail });
    ipcMock.narratedResume.mockResolvedValue({ ok: true });
    ipcMock.get.mockResolvedValue({ ...detail, status: "approved" });
    await useGoalsStore.getState().narratedResume("g_n");
    expect(ipcMock.narratedResume).toHaveBeenCalledWith({ goalId: "g_n" });
    expect(ipcMock.get).toHaveBeenCalledWith({ id: "g_n" });
  });

  it("narratedRollback forwards goalId", async () => {
    ipcMock.narratedRollback.mockResolvedValue({ aborted: true });
    await useGoalsStore.getState().narratedRollback("g_x");
    expect(ipcMock.narratedRollback).toHaveBeenCalledWith({ goalId: "g_x" });
  });
});
