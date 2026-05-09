import { create } from "zustand";
import type { Agent, AgentStatus } from "@dashboard-agent/shared";

type State = {
  agents: Agent[];
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  applyStatus: (agentId: string, status: AgentStatus, currentAction: string | null) => void;
};

export const useAgentsStore = create<State>((set) => ({
  agents: [],
  loaded: false,
  load: async (companyId) => {
    const list = await window.dashboardAgent.agents.list(companyId);
    set({ agents: list, loaded: true });
  },
  applyStatus: (agentId, status, currentAction) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, status, currentAction } : a)),
    })),
}));
