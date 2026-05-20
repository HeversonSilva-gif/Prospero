import { create } from "zustand";
import type { Routine } from "@prospero/shared";

interface RoutinesState {
  routines: Routine[] | null;
  loading: boolean;
  error: string | null;
  load: (companyId: string) => Promise<void>;
  getById: (id: string) => Routine | null;
  create: (input: unknown) => Promise<Routine>;
  update: (input: unknown) => Promise<Routine>;
  delete: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;
}

const errString = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const useRoutinesStore = create<RoutinesState>((set, get) => ({
  routines: null,
  loading: false,
  error: null,

  async load(companyId) {
    set({ loading: true, error: null });
    try {
      const list = await window.prospero.routines.list({ companyId });
      set({ routines: list, loading: false });
    } catch (err) {
      set({ loading: false, error: errString(err) });
    }
  },

  getById(id) {
    const list = get().routines;
    if (list === null) return null;
    return list.find((r) => r.id === id) ?? null;
  },

  async create(input) {
    try {
      const created = await window.prospero.routines.create({ input });
      set((s) => ({ routines: s.routines === null ? [created] : [...s.routines, created] }));
      return created;
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async update(input) {
    try {
      const updated = await window.prospero.routines.update({ input });
      set((s) => ({
        routines:
          s.routines === null
            ? [updated]
            : s.routines.map((r) => (r.id === updated.id ? updated : r)),
      }));
      return updated;
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async delete(id) {
    try {
      await window.prospero.routines.delete({ id });
      set((s) => ({
        routines: s.routines === null ? null : s.routines.filter((r) => r.id !== id),
      }));
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async runNow(id) {
    try {
      await window.prospero.routines.runNow({ id });
    } catch (err) {
      set({ error: errString(err) });
      throw err;
    }
  },

  async toggleEnabled(id) {
    const before = get().routines;
    if (before === null) return;
    const target = before.find((r) => r.id === id);
    if (target === undefined) return;
    const next = !target.enabled;

    // Optimistic flip.
    set({
      routines: before.map((r) => (r.id === id ? { ...r, enabled: next } : r)),
    });

    try {
      await window.prospero.routines.update({ input: { id, enabled: next } });
    } catch (err) {
      // Revert.
      set({ routines: before, error: errString(err) });
    }
  },
}));
