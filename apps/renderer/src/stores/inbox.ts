import { create } from "zustand";
import type { InboxItem } from "@prospero/shared";

type State = {
  items: InboxItem[];
  unread: number;
  load: (companyId: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  subscribe: (companyId: string) => () => void;
};

export const useInboxStore = create<State>((set, get) => ({
  items: [],
  unread: 0,
  load: async (companyId) => {
    const items = await window.prospero.inbox.list(companyId);
    const unread = items.filter((i) => i.readAt === null).length;
    set({ items, unread });
  },
  markRead: async (id) => {
    await window.prospero.inbox.markRead(id);
    set((s) => {
      const items = s.items.map((i) => (i.id === id ? { ...i, readAt: Date.now() } : i));
      const unread = items.filter((i) => i.readAt === null).length;
      return { items, unread };
    });
  },
  subscribe: (companyId) => {
    const off = window.prospero.inbox.onUpdate(() => {
      void get().load(companyId);
    });
    return off;
  },
}));
