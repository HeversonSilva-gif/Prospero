import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAgentsStore } from "./agents.js";
import type { Agent } from "@prospero/shared";

const sampleAgent = (over: Partial<Agent> = {}): Agent => ({
  id: "agent_1",
  companyId: "co_1",
  name: "CEO",
  role: "CEO",
  systemPrompt: "x".repeat(20),
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  ...over,
});

const setupWindow = (overrides: Record<string, unknown> = {}) => {
  const agentsApi = {
    list: vi.fn(() => Promise.resolve([sampleAgent()])),
    setMode: vi.fn(() => Promise.resolve({ ok: true })),
    setAlwaysOn: vi.fn(() => Promise.resolve({ ok: true })),
    setCapabilities: vi.fn(() => Promise.resolve({ ok: true })),
    pause: vi.fn(() => Promise.resolve({ ok: true })),
    resume: vi.fn(() => Promise.resolve({ ok: true, drained: 0 })),
    terminate: vi.fn(() => Promise.resolve({ ok: true })),
    wakeUp: vi.fn(() => Promise.resolve({ ok: true })),
    resetSession: vi.fn(() => Promise.resolve({ ok: true })),
    hireFromUi: vi.fn(() => Promise.resolve(sampleAgent({ id: "agent_new" }))),
    ...overrides,
  };
  (globalThis as { window?: unknown }).window = { prospero: { agents: agentsApi } };
  return agentsApi;
};

describe("agents store — lifecycle actions", () => {
  beforeEach(() => {
    useAgentsStore.setState({ agents: [sampleAgent()], loaded: true });
  });

  it("setMode calls IPC and reloads agents", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().setMode("agent_1", "auto");
    expect(api.setMode).toHaveBeenCalledWith("agent_1", "auto");
    expect(api.list).toHaveBeenCalled();
  });

  it("setAlwaysOn patches local state without reload", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().setAlwaysOn("agent_1", true);
    expect(api.setAlwaysOn).toHaveBeenCalledWith("agent_1", true);
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.alwaysOn).toBe(true);
  });

  it("setCapabilities patches local state with new array", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().setCapabilities("agent_1", ["read_code", "git_ops"]);
    expect(api.setCapabilities).toHaveBeenCalledWith("agent_1", ["read_code", "git_ops"]);
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.capabilities).toEqual(["read_code", "git_ops"]);
  });

  it("pause sets status='paused' locally + records pauseReason", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().pause("agent_1", "manual");
    expect(api.pause).toHaveBeenCalledWith("agent_1", "manual");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.status).toBe("paused");
    expect(a.pauseReason).toBe("manual");
  });

  it("resume sets status='idle' locally + clears pauseReason", async () => {
    useAgentsStore.setState({
      agents: [sampleAgent({ status: "paused", pauseReason: "x", pausedAt: 1 })],
    });
    const api = setupWindow();
    const result = await useAgentsStore.getState().resume("agent_1");
    expect(api.resume).toHaveBeenCalledWith("agent_1");
    expect(result.drained).toBe(0);
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.status).toBe("idle");
    expect(a.pauseReason).toBeNull();
  });

  it("terminate sets status='terminated' locally", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().terminate("agent_1", "fired");
    expect(api.terminate).toHaveBeenCalledWith("agent_1", "fired");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.status).toBe("terminated");
  });

  it("wakeUp calls IPC (no state mutation)", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().wakeUp("agent_1");
    expect(api.wakeUp).toHaveBeenCalledWith("agent_1");
  });

  it("resetSession calls IPC and reloads agents", async () => {
    const api = setupWindow();
    await useAgentsStore.getState().resetSession("agent_1");
    expect(api.resetSession).toHaveBeenCalledWith("agent_1");
    expect(api.list).toHaveBeenCalled();
  });

  it("hireFromUi calls IPC and returns the new agent", async () => {
    const api = setupWindow();
    const created = await useAgentsStore.getState().hireFromUi({
      company_id: "co_1",
      name: "BackendEng",
      role: "BackendEng",
      system_prompt: "x".repeat(20),
    });
    expect(api.hireFromUi).toHaveBeenCalled();
    expect(created.id).toBe("agent_new");
  });
});
