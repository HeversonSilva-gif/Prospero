import { describe, expect, it, beforeEach, vi } from "vitest";
import type { OrgPlan } from "@prospero/shared";
import { useOrgPlanStore } from "./orgPlan.js";

const ipcMock = {
  getCurrent: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
};

const plan: OrgPlan = {
  id: "orgplan_1",
  companyId: "c1",
  proposedByAgentId: "ceo",
  summary: "s",
  roles: [],
  agents: [],
  status: "proposed",
  userFeedback: null,
  proposedAt: 0,
  decidedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: { prospero: { orgPlan: typeof ipcMock } } }).window = {
    prospero: { orgPlan: ipcMock },
  };
  useOrgPlanStore.setState({ plan: null, loaded: false });
});

describe("useOrgPlanStore", () => {
  it("load fetches the current plan", async () => {
    ipcMock.getCurrent.mockResolvedValue(plan);
    await useOrgPlanStore.getState().load();
    expect(useOrgPlanStore.getState().plan?.id).toBe("orgplan_1");
    expect(useOrgPlanStore.getState().loaded).toBe(true);
  });

  it("approve calls the IPC with the plan id and returns the result", async () => {
    useOrgPlanStore.setState({ plan, loaded: true });
    ipcMock.approve.mockResolvedValue({ ok: true, createdRoleIds: ["r"], hiredAgentIds: ["a"] });
    const result = await useOrgPlanStore.getState().approve({ includeRoleIndexes: [0] });
    expect(ipcMock.approve).toHaveBeenCalledWith({
      orgPlanId: "orgplan_1",
      includeRoleIndexes: [0],
    });
    expect(result.ok).toBe(true);
  });

  it("reject calls the IPC and clears the plan", async () => {
    useOrgPlanStore.setState({ plan, loaded: true });
    ipcMock.reject.mockResolvedValue({ ok: true });
    await useOrgPlanStore.getState().reject("not now");
    expect(ipcMock.reject).toHaveBeenCalledWith({ orgPlanId: "orgplan_1", reason: "not now" });
    expect(useOrgPlanStore.getState().plan).toBeNull();
  });
});
