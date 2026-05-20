import { create } from "zustand";
import type { Agent, AgentStats, AgentStatus, TrustTier } from "@prospero/shared";

type State = {
  agents: Agent[];
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  applyAgentStatus: (agentId: string, status: AgentStatus) => void;
  applyCurrentAction: (agentId: string, action: string | null) => void;
  applySessionId: (agentId: string, sessionId: string | null) => void;
  applyTrustTier: (agentId: string, tier: TrustTier) => void;
  setAllowedProjects: (agentId: string, projectIds: string[]) => Promise<void>;
  setModel: (agentId: string, model: string) => Promise<void>;
  setRole: (
    agentId: string,
    roleTemplateId: string,
    opts?: { preserveModel?: boolean },
  ) => Promise<void>;
  setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<void>;
  setReportsTo: (agentId: string, reportsTo: string | null) => Promise<void>;
  setAdapter: (agentId: string, adapterName: string) => Promise<void>;
  fetchStats: (agentId: string) => Promise<AgentStats>;
  setMode: (agentId: string, mode: "supervised" | "auto") => Promise<void>;
  setAlwaysOn: (agentId: string, alwaysOn: boolean) => Promise<void>;
  setCapabilities: (agentId: string, capabilities: string[]) => Promise<void>;
  setBudget: (
    agentId: string,
    tokensLimit: number | null,
    usdLimit: number | null,
    period: "daily" | "monthly",
  ) => Promise<void>;
  setPermissions: (agentId: string, canHire: boolean, canAssign: boolean) => Promise<void>;
  pause: (agentId: string, reason?: string) => Promise<void>;
  resume: (agentId: string) => Promise<{ ok: true; drained: number }>;
  terminate: (agentId: string, reason?: string) => Promise<void>;
  wakeUp: (agentId: string) => Promise<void>;
  resetSession: (agentId: string) => Promise<void>;
  hireFromUi: (payload: {
    company_id: string;
    name: string;
    role: string;
    system_prompt: string;
    mode?: "supervised" | "auto";
    reports_to?: string;
    role_template_id?: string;
    location?: "local" | "remote";
  }) => Promise<Agent>;
};

const reloadAgentsForCompany = async (
  set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void,
  companyId: string,
): Promise<void> => {
  const list = await window.prospero.agents.list(companyId);
  set({ agents: list });
};

export const useAgentsStore = create<State>((set, get) => ({
  agents: [],
  loaded: false,
  load: async (companyId) => {
    const list = await window.prospero.agents.list(companyId);
    set({ agents: list, loaded: true });
  },
  applyAgentStatus: (agentId, status) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, status } : a)),
    })),
  applyCurrentAction: (agentId, action) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, currentAction: action } : a)),
    })),
  applySessionId: (agentId, sessionId) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, claudeSessionId: sessionId } : a)),
    })),
  applyTrustTier: (agentId, tier) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, trustTier: tier } : a)),
    })),
  setAllowedProjects: async (agentId, projectIds) => {
    await window.prospero.agents.setAllowedProjects(agentId, projectIds);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, allowedProjects: projectIds } : a)),
    }));
  },
  setModel: async (agentId, model) => {
    await window.prospero.agents.setModel(agentId, model);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setRole: async (agentId, roleTemplateId, opts) => {
    await window.prospero.agents.setRole(agentId, roleTemplateId, opts);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setSystemPrompt: async (agentId, systemPrompt) => {
    await window.prospero.agents.setSystemPrompt(agentId, systemPrompt);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, systemPrompt } : a)),
    }));
  },
  setReportsTo: async (agentId, reportsTo) => {
    await window.prospero.agents.setReportsTo(agentId, reportsTo);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setAdapter: async (agentId, adapterName) => {
    await window.prospero.agents.setAdapter(agentId, adapterName);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, adapterName } : a)),
    }));
  },
  fetchStats: async (agentId) => window.prospero.agents.stats(agentId),
  setMode: async (agentId, mode) => {
    await window.prospero.agents.setMode(agentId, mode);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setAlwaysOn: async (agentId, alwaysOn) => {
    await window.prospero.agents.setAlwaysOn(agentId, alwaysOn);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, alwaysOn } : a)),
    }));
  },
  setCapabilities: async (agentId, capabilities) => {
    await window.prospero.agents.setCapabilities(agentId, capabilities);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, capabilities } : a)),
    }));
  },
  setBudget: async (agentId, tokensLimit, usdLimit, period) => {
    await window.prospero.agents.setBudget(agentId, tokensLimit, usdLimit, period);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, budgetTokensLimit: tokensLimit, budgetUsdLimit: usdLimit, budgetPeriod: period }
          : a,
      ),
    }));
  },
  setPermissions: async (agentId, canHire, canAssign) => {
    await window.prospero.agents.setPermissions(agentId, canHire, canAssign);
    // set-permissions re-spawns (clears the session) — reload the roster.
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  pause: async (agentId, reason) => {
    await window.prospero.agents.pause(agentId, reason);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, status: "paused", pausedAt: Date.now(), pauseReason: reason ?? null }
          : a,
      ),
    }));
  },
  resume: async (agentId) => {
    const result = await window.prospero.agents.resume(agentId);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId ? { ...a, status: "idle", pausedAt: null, pauseReason: null } : a,
      ),
    }));
    return result;
  },
  terminate: async (agentId, reason) => {
    await window.prospero.agents.terminate(agentId, reason);
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId ? { ...a, status: "terminated", terminatedAt: Date.now() } : a,
      ),
    }));
  },
  wakeUp: async (agentId) => {
    await window.prospero.agents.wakeUp(agentId);
  },
  resetSession: async (agentId) => {
    await window.prospero.agents.resetSession(agentId);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  hireFromUi: async (payload) => {
    const created = await window.prospero.agents.hireFromUi(payload);
    set((s) => ({ agents: [...s.agents, created] }));
    return created;
  },
}));
