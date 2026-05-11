import { create } from "zustand";
import type { RoleDetail, RoleTemplate } from "@dashboard-agent/shared";

type RoleSummary = RoleTemplate & { agentCount: number };

type State = {
  roles: RoleSummary[];
  selectedId: string | null;
  selectedDetail: RoleDetail | null;
  loaded: boolean;
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
};

export const useRolesStore = create<State>((set, get) => ({
  roles: [],
  selectedId: null,
  selectedDetail: null,
  loaded: false,

  load: async () => {
    const list = await window.dashboardAgent.roles.list();
    set({ roles: list, loaded: true });
    if (get().selectedId === null && list.length > 0) {
      await get().select(list[0]!.id);
    }
  },

  select: async (id) => {
    set({ selectedId: id });
    const detail = await window.dashboardAgent.roles.get(id);
    set({ selectedDetail: detail });
  },
}));
