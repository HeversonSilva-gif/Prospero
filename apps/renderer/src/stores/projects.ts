import { create } from "zustand";
import type { Project, ProjectPathStatus } from "@prospero/shared";

type State = {
  projects: Project[];
  pathStatuses: Record<string, ProjectPathStatus>;
  selectedId: string | null;
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  refreshPaths: (companyId: string) => Promise<void>;
  create: (input: {
    companyId: string;
    name: string;
    path: string;
    color: string;
  }) => Promise<Project>;
  update: (input: { id: string; name?: string; path?: string; color?: string }) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setIcon: (id: string, icon: string | null) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  select: (id: string | null) => void;
};

export const useProjectsStore = create<State>((set) => ({
  projects: [],
  pathStatuses: {},
  selectedId: null,
  loaded: false,
  load: async (companyId) => {
    const projects = await window.prospero.projects.list(companyId);
    const pathStatuses = await window.prospero.projects.checkPaths(companyId);
    set((s) => ({
      projects,
      pathStatuses,
      loaded: true,
      selectedId: s.selectedId ?? projects[0]?.id ?? null,
    }));
  },
  refreshPaths: async (companyId) => {
    const pathStatuses = await window.prospero.projects.checkPaths(companyId);
    set({ pathStatuses });
  },
  create: async (input) => {
    const p = await window.prospero.projects.create(input);
    set((s) => ({ projects: [...s.projects, p], selectedId: p.id }));
    return p;
  },
  update: async (input) => {
    const next = await window.prospero.projects.update(input);
    if (next === null) return;
    set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
  },
  delete: async (id) => {
    await window.prospero.projects.delete(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      const selectedId = s.selectedId === id ? (projects[0]?.id ?? null) : s.selectedId;
      return { projects, selectedId };
    });
  },
  setIcon: async (id, icon) => {
    await window.prospero.projects.setIcon(id, icon);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, icon } : p)),
    }));
  },
  archive: async (id) => {
    await window.prospero.projects.archive(id);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, archivedAt: Date.now() } : p)),
    }));
  },
  unarchive: async (id) => {
    await window.prospero.projects.unarchive(id);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, archivedAt: null } : p)),
    }));
  },
  select: (id) => set({ selectedId: id }),
}));
