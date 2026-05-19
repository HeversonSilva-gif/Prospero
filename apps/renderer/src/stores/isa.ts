import { create } from "zustand";
import type {
  CriterionCheckSpec,
  CriterionCheckType,
  CriterionKind,
  CriterionStatus,
  GoalCriterion,
  IsaDraft,
  UpdateCriterionInput,
} from "@prospero/shared";

// Authoring state for one goal's ISA. The panel mounts per goal; load() resets
// everything for the new goal id. Mirrors the single-entity shape of the
// `detail` slice in useGoalsStore.

type NewCriterion = {
  statement: string;
  kind: CriterionKind;
  checkType: CriterionCheckType | null;
  checkSpec: CriterionCheckSpec | null;
};

type State = {
  goalId: string | null;
  body: string;
  criteria: GoalCriterion[];
  loading: boolean;
  generating: boolean;
  draft: IsaDraft | null;
  error: string | null;
  load: (goalId: string) => Promise<void>;
  save: (body: string) => Promise<boolean>;
  generate: () => Promise<void>;
  applyDraft: () => Promise<void>;
  discardDraft: () => void;
  addCriterion: (input: NewCriterion) => Promise<void>;
  updateCriterion: (id: string, patch: UpdateCriterionInput) => Promise<void>;
  removeCriterion: (id: string) => Promise<void>;
  judgeCriterion: (id: string, verdict: CriterionStatus) => Promise<void>;
};

export const useIsaStore = create<State>((set, get) => ({
  goalId: null,
  body: "",
  criteria: [],
  loading: false,
  generating: false,
  draft: null,
  error: null,

  load: async (goalId) => {
    set({ goalId, loading: true, error: null, draft: null });
    try {
      const res = await window.prospero.isa.get({ goalId });
      set({ body: res.body, criteria: res.criteria, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  save: async (body) => {
    const { goalId } = get();
    if (goalId === null) return false;
    // Optimistic — the editor reflects the user's text immediately; a failed
    // save is retried on the next keystroke via debounced autosave.
    set({ body, error: null });
    try {
      await window.prospero.isa.save({ goalId, body });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  generate: async () => {
    const { goalId } = get();
    if (goalId === null) return;
    set({ generating: true, error: null });
    try {
      const draft = await window.prospero.isa.generate({ goalId });
      set({ draft, generating: false });
    } catch (err) {
      set({ generating: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  applyDraft: async () => {
    const { goalId, draft } = get();
    if (goalId === null || draft === null) return;
    const ok = await get().save(draft.isa);
    if (!ok) return;
    try {
      for (const c of draft.criteria) {
        await window.prospero.isa.criterionCreate({
          goalId,
          statement: c.statement,
          kind: c.kind,
          checkType: c.checkType ?? null,
        });
      }
      set({ draft: null });
      await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  discardDraft: () => set({ draft: null }),

  addCriterion: async (input) => {
    const { goalId } = get();
    if (goalId === null) return;
    try {
      await window.prospero.isa.criterionCreate({ goalId, ...input });
      await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // Wired end-to-end (IPC + handler) but has no UI consumer in M13 PR-A —
  // the criterion edit affordance lands with the PR-B verification work.
  updateCriterion: async (id, patch) => {
    const { goalId } = get();
    try {
      await window.prospero.isa.criterionUpdate({ id, patch });
      if (goalId !== null) await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  removeCriterion: async (id) => {
    const { goalId } = get();
    try {
      await window.prospero.isa.criterionDelete({ id });
      if (goalId !== null) await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  judgeCriterion: async (id, verdict) => {
    const { goalId } = get();
    try {
      await window.prospero.isa.criterionJudge({ criterionId: id, verdict });
      if (goalId !== null) await get().load(goalId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
