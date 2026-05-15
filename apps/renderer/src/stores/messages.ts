import { create } from "zustand";
import type { Message, ToolCallView } from "@prospero/shared";

type State = {
  byThreadId: Record<string, Message[]>;
  load: (companyId: string, participants: string[]) => Promise<string | null>;
  append: (message: Message) => void;
  patchToolCallResult: (threadId: string, toolCallId: string, result: string) => void;
};

export const useMessagesStore = create<State>((set) => ({
  byThreadId: {},
  load: async (companyId, participants) => {
    const list = await window.prospero.messages.list(companyId, participants);
    if (list.length === 0) return null;
    const threadId = list[0]!.threadId;
    set((s) => ({ byThreadId: { ...s.byThreadId, [threadId]: list } }));
    return threadId;
  },
  append: (message) =>
    set((s) => {
      const existing = s.byThreadId[message.threadId] ?? [];
      return { byThreadId: { ...s.byThreadId, [message.threadId]: [...existing, message] } };
    }),
  patchToolCallResult: (threadId, toolCallId, result) =>
    set((s) => {
      const list = s.byThreadId[threadId];
      if (list === undefined) return s;
      const updated: Message[] = list.map((m) => {
        if (m.toolCalls === null) return m;
        const next: ToolCallView[] = m.toolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, status: "success" as const, result } : tc,
        );
        return { ...m, toolCalls: next };
      });
      return { byThreadId: { ...s.byThreadId, [threadId]: updated } };
    }),
}));
