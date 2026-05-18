import { create } from "zustand";
import type { RoleDetail, RoleTemplate } from "@prospero/shared";

type RoleSummary = RoleTemplate & { agentCount: number };

export type CreateRoleInput = {
  name: string;
  description: string;
  icon: string | null;
  defaultModel: string;
  defaultCapabilities: string[];
};

export type UpdateRoleInput = {
  id: string;
  name?: string;
  description?: string;
  icon?: string | null;
  defaultModel?: string;
  defaultCapabilities?: string[];
};

type State = {
  roles: RoleSummary[];
  selectedId: string | null;
  selectedDetail: RoleDetail | null;
  selectedCharter: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
  create: (input: CreateRoleInput) => Promise<RoleTemplate>;
  update: (input: UpdateRoleInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clone: (id: string) => Promise<RoleTemplate>;
  saveCharter: (id: string, body: string) => Promise<void>;
};

export const useRolesStore = create<State>((set, get) => ({
  roles: [],
  selectedId: null,
  selectedDetail: null,
  selectedCharter: null,
  loaded: false,

  load: async () => {
    const list = await window.prospero.roles.list();
    set({ roles: list, loaded: true });
    const current = get().selectedId;
    if (current !== null && list.some((r) => r.id === current)) {
      await get().select(current);
    } else if (list.length > 0) {
      await get().select(list[0]!.id);
    } else {
      set({ selectedId: null, selectedDetail: null, selectedCharter: null });
    }
  },

  select: async (id) => {
    set({ selectedId: id, selectedDetail: null, selectedCharter: null });
    const [detail, charter] = await Promise.all([
      window.prospero.roles.get(id),
      window.prospero.roles.getCharter(id),
    ]);
    set({ selectedDetail: detail, selectedCharter: charter.body });
  },

  create: async (input) => {
    const role = await window.prospero.roles.create(input);
    await get().load();
    await get().select(role.id);
    return role;
  },

  update: async (input) => {
    await window.prospero.roles.update(input);
    await get().load();
  },

  remove: async (id) => {
    await window.prospero.roles.delete(id);
    if (get().selectedId === id) {
      set({ selectedId: null });
    }
    await get().load();
  },

  clone: async (id) => {
    const role = await window.prospero.roles.clone(id);
    await get().load();
    await get().select(role.id);
    return role;
  },

  saveCharter: async (id, body) => {
    await window.prospero.roles.saveCharter(id, body);
    if (get().selectedId === id) {
      set({ selectedCharter: body });
    }
  },
}));
