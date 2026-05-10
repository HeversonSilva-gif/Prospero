export type Sender = { kind: "user" | "agent"; id: string | null; name: string };

type State = {
  currentTurnThreadId: string | null;
  queue: Array<{ threadId: string; content: string; sender: Sender }>;
};

export type RouterOptions = {
  writeStdin: (agentId: string, content: string) => void;
};

export type Router = {
  enqueue(agentId: string, threadId: string, content: string, sender: Sender): void;
  onTurnComplete(agentId: string): void;
  getCurrentThread(agentId: string): string | null;
};

const formatSender = (sender: Sender, content: string): string =>
  `[from: ${sender.name}] ${content}`;

export const createRouter = (opts: RouterOptions): Router => {
  const states = new Map<string, State>();

  const ensure = (agentId: string): State => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { currentTurnThreadId: null, queue: [] };
      states.set(agentId, s);
    }
    return s;
  };

  return {
    enqueue(agentId, threadId, content, sender) {
      const s = ensure(agentId);
      const formatted = formatSender(sender, content);
      if (s.currentTurnThreadId === null) {
        s.currentTurnThreadId = threadId;
        opts.writeStdin(agentId, formatted);
      } else {
        s.queue.push({ threadId, content: formatted, sender });
      }
    },
    onTurnComplete(agentId) {
      const s = ensure(agentId);
      const next = s.queue.shift();
      if (next === undefined) {
        s.currentTurnThreadId = null;
      } else {
        s.currentTurnThreadId = next.threadId;
        opts.writeStdin(agentId, next.content);
      }
    },
    getCurrentThread(agentId) {
      return ensure(agentId).currentTurnThreadId;
    },
  };
};
