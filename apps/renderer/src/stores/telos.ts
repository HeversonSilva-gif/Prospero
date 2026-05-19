import { create } from "zustand";
import type { TelosDraft, TelosInterviewAnswers } from "@prospero/shared";

// Authoring state for the active company's TELOS. The /telos route loads it
// per company; load() resets state. Mirrors the shape of useIsaStore.

type State = {
  companyId: string | null;
  body: string | null;
  loading: boolean;
  synthesizing: boolean;
  draft: TelosDraft | null;
  error: string | null;
  load: (companyId: string) => Promise<void>;
  save: (body: string) => Promise<boolean>;
  synthesize: (answers: TelosInterviewAnswers) => Promise<void>;
  applyDraft: () => Promise<void>;
  discardDraft: () => void;
};

export const useTelosStore = create<State>((set, get) => ({
  companyId: null,
  body: null,
  loading: false,
  synthesizing: false,
  draft: null,
  error: null,

  load: async (companyId) => {
    set({ companyId, loading: true, error: null, draft: null });
    try {
      const res = await window.prospero.telos.get({ companyId });
      set({ body: res.body, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  save: async (body) => {
    const { companyId } = get();
    if (companyId === null) return false;
    // Optimistic — the editor reflects the user's text immediately; a failed
    // save is retried on the next keystroke via debounced autosave.
    set({ body, error: null });
    try {
      await window.prospero.telos.save({ companyId, body });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  synthesize: async (answers) => {
    const { companyId } = get();
    if (companyId === null) return;
    set({ synthesizing: true, error: null });
    try {
      const draft = await window.prospero.telos.synthesize({ companyId, answers });
      set({ draft, synthesizing: false });
    } catch (err) {
      set({ synthesizing: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  applyDraft: async () => {
    const { companyId, draft } = get();
    if (companyId === null || draft === null) return;
    const ok = await get().save(draft.telos);
    if (!ok) return;
    set({ draft: null });
    await get().load(companyId);
  },

  discardDraft: () => set({ draft: null }),
}));
