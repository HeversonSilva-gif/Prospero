import { create } from "zustand";
import type { Agent, AgentStats, AgentStatus } from "@dashboard-agent/shared";

type State = {
  agents: Agent[];
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  applyAgentStatus: (agentId: string, status: AgentStatus) => void;
  applyCurrentAction: (agentId: string, action: string | null) => void;
  applySessionId: (agentId: string, sessionId: string | null) => void;
  setAllowedProjects: (agentId: string, projectIds: string[]) => Promise<void>;
  setModel: (agentId: string, model: string) => Promise<void>;
  setRole: (
    agentId: string,
    roleTemplateId: string,
    opts?: { preserveModel?: boolean },
  ) => Promise<void>;
  setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<void>;
  setReportsTo: (agentId: string, reportsTo: string | null) => Promise<void>;
  fetchStats: (agentId: string) => Promise<AgentStats>;
};

const reloadAgentsForCompany = async (
  set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void,
  companyId: string,
): Promise<void> => {
  const list = await window.dashboardAgent.agents.list(companyId);
  set({ agents: list });
};

export const useAgentsStore = create<State>((set, get) => ({
  agents: [],
  loaded: false,
  load: async (companyId) => {
    const list = await window.dashboardAgent.agents.list(companyId);
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
  setAllowedProjects: async (agentId, projectIds) => {
    await window.dashboardAgent.agents.setAllowedProjects(agentId, projectIds);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, allowedProjects: projectIds } : a)),
    }));
  },
  setModel: async (agentId, model) => {
    await window.dashboardAgent.agents.setModel(agentId, model);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setRole: async (agentId, roleTemplateId, opts) => {
    await window.dashboardAgent.agents.setRole(agentId, roleTemplateId, opts);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  setSystemPrompt: async (agentId, systemPrompt) => {
    await window.dashboardAgent.agents.setSystemPrompt(agentId, systemPrompt);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, systemPrompt } : a)),
    }));
  },
  setReportsTo: async (agentId, reportsTo) => {
    await window.dashboardAgent.agents.setReportsTo(agentId, reportsTo);
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent !== undefined) await reloadAgentsForCompany(set, agent.companyId);
  },
  fetchStats: async (agentId) => window.dashboardAgent.agents.stats(agentId),
}));
