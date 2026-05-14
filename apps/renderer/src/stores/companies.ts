import { create } from "zustand";
import type { Company } from "@dashboard-agent/shared";

type State = {
  companies: Company[];
  activeId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<Company>;
  delete: (id: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
};

export const useCompaniesStore = create<State>((set, get) => ({
  companies: [],
  activeId: null,
  loaded: false,

  load: async () => {
    const [companies, settings] = await Promise.all([
      window.dashboardAgent.companies.list(),
      window.dashboardAgent.settings.get(),
    ]);
    const persistedId = settings.activeCompanyId;
    const validPersisted =
      persistedId !== null && companies.some((c) => c.id === persistedId) ? persistedId : null;
    const activeId = validPersisted ?? companies[0]?.id ?? null;
    set({ companies, activeId, loaded: true });
  },

  create: async (name) => {
    const created = await window.dashboardAgent.companies.create(name);
    set((s) => ({ companies: [...s.companies, created] }));
    await get().setActive(created.id);
    return created;
  },

  delete: async (id) => {
    await window.dashboardAgent.companies.delete(id);
    const remaining = get().companies.filter((c) => c.id !== id);
    const wasActive = get().activeId === id;
    set({ companies: remaining });
    if (wasActive) {
      const nextActive = remaining[0]?.id ?? null;
      await get().setActive(nextActive);
    }
  },

  setActive: async (id) => {
    await window.dashboardAgent.settings.update({ activeCompanyId: id });
    set({ activeId: id });
  },
}));
