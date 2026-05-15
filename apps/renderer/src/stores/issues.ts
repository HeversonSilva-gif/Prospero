import { create } from "zustand";
import type { Issue, IssueDetail, IssueStatus, IssuePriority } from "@prospero/shared";

type State = {
  issues: Issue[];
  detail: IssueDetail | null;
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  clearDetail: () => void;
  create: (input: {
    companyId: string;
    projectId: string | null;
    title: string;
    description?: string | null;
    assigneeId?: string | null;
    priority?: IssuePriority;
    parentId?: string | null;
  }) => Promise<Issue>;
  update: (input: {
    id: string;
    title?: string;
    description?: string | null;
    status?: IssueStatus;
    assigneeId?: string | null;
    priority?: IssuePriority;
    parentId?: string | null;
  }) => Promise<void>;
  delete: (id: string) => Promise<void>;
  addComment: (issueId: string, content: string) => Promise<void>;
  optimisticStatus: (id: string, status: IssueStatus) => void;
  /** Replace one issue in the array without rebuilding the whole list. */
  replace: (issue: Issue) => void;
  /** Remove one issue from the array by id. */
  remove: (id: string) => void;
  /** Insert (or update if exists) a single issue, used after backend reports a created event. */
  upsert: (issue: Issue) => void;
};

export const useIssuesStore = create<State>((set, get) => ({
  issues: [],
  detail: null,
  loaded: false,
  load: async (companyId) => {
    const issues = await window.prospero.issues.list({ companyId });
    set({ issues, loaded: true });
  },
  loadDetail: async (id) => {
    const detail = await window.prospero.issues.get(id);
    set({ detail });
  },
  clearDetail: () => set({ detail: null }),
  create: async (input) => {
    const i = await window.prospero.issues.create(input);
    set((s) => ({ issues: [i, ...s.issues] }));
    return i;
  },
  update: async (input) => {
    const next = await window.prospero.issues.update(input);
    if (next === null) return;
    set((s) => ({
      issues: s.issues.map((i) => (i.id === next.id ? next : i)),
      detail: s.detail?.issue.id === next.id ? { ...s.detail, issue: next } : s.detail,
    }));
  },
  delete: async (id) => {
    await window.prospero.issues.delete(id);
    set((s) => ({ issues: s.issues.filter((i) => i.id !== id) }));
  },
  addComment: async (issueId, content) => {
    await window.prospero.issues.addComment(issueId, content);
    if (get().detail?.issue.id === issueId) await get().loadDetail(issueId);
  },
  optimisticStatus: (id, status) =>
    set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, status } : i)) })),
  replace: (issue) =>
    set((s) => ({
      issues: s.issues.map((i) => (i.id === issue.id ? issue : i)),
      detail: s.detail?.issue.id === issue.id ? { ...s.detail, issue } : s.detail,
    })),
  remove: (id) =>
    set((s) => ({
      issues: s.issues.filter((i) => i.id !== id),
      detail: s.detail?.issue.id === id ? null : s.detail,
    })),
  upsert: (issue) =>
    set((s) =>
      s.issues.some((i) => i.id === issue.id)
        ? { issues: s.issues.map((i) => (i.id === issue.id ? issue : i)) }
        : { issues: [issue, ...s.issues] },
    ),
}));
