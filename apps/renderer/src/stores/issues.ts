import { create } from "zustand";
import type { Issue, IssueDetail, IssueStatus, IssuePriority } from "@dashboard-agent/shared";

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
};

export const useIssuesStore = create<State>((set, get) => ({
  issues: [],
  detail: null,
  loaded: false,
  load: async (companyId) => {
    const issues = await window.dashboardAgent.issues.list({ companyId });
    set({ issues, loaded: true });
  },
  loadDetail: async (id) => {
    const detail = await window.dashboardAgent.issues.get(id);
    set({ detail });
  },
  clearDetail: () => set({ detail: null }),
  create: async (input) => {
    const i = await window.dashboardAgent.issues.create(input);
    set((s) => ({ issues: [i, ...s.issues] }));
    return i;
  },
  update: async (input) => {
    const next = await window.dashboardAgent.issues.update(input);
    if (next === null) return;
    set((s) => ({
      issues: s.issues.map((i) => (i.id === next.id ? next : i)),
      detail: s.detail?.issue.id === next.id ? { ...s.detail, issue: next } : s.detail,
    }));
  },
  delete: async (id) => {
    await window.dashboardAgent.issues.delete(id);
    set((s) => ({ issues: s.issues.filter((i) => i.id !== id) }));
  },
  addComment: async (issueId, content) => {
    await window.dashboardAgent.issues.addComment(issueId, content);
    if (get().detail?.issue.id === issueId) await get().loadDetail(issueId);
  },
  optimisticStatus: (id, status) =>
    set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, status } : i)) })),
}));
