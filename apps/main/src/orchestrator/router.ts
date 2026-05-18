export type Sender = { kind: "user" | "agent"; id: string | null; name: string };

type State = {
  currentTurnThreadId: string | null;
  queue: Array<{ threadId: string; content: string; sender: Sender }>;
  // M11 PR-F2: a memory nudge to prepend to this agent's next turn, or null.
  pendingNudge: string | null;
};

export type RouterOptions = {
  writeStdin: (agentId: string, content: string) => void;
};

export type Router = {
  enqueue(agentId: string, threadId: string, content: string, sender: Sender): void;
  onTurnComplete(agentId: string): void;
  getCurrentThread(agentId: string): string | null;
  // M11 PR-F2: park a nudge to ride along with the agent's next turn.
  setPendingNudge(agentId: string, nudge: string): void;
};

const formatSender = (sender: Sender, content: string): string =>
  `[from: ${sender.name}] ${content}`;

export const createRouter = (opts: RouterOptions): Router => {
  const states = new Map<string, State>();

  const ensure = (agentId: string): State => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { currentTurnThreadId: null, queue: [], pendingNudge: null };
      states.set(agentId, s);
    }
    return s;
  };

  // Prepends and consumes a parked nudge, if any.
  const consumeNudge = (s: State, content: string): string => {
    if (s.pendingNudge === null) return content;
    const out = `${s.pendingNudge}\n\n${content}`;
    s.pendingNudge = null;
    return out;
  };

  return {
    enqueue(agentId, threadId, content, sender) {
      const s = ensure(agentId);
      const formatted = formatSender(sender, content);
      if (s.currentTurnThreadId === null) {
        s.currentTurnThreadId = threadId;
        opts.writeStdin(agentId, consumeNudge(s, formatted));
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
        opts.writeStdin(agentId, consumeNudge(s, next.content));
      }
    },
    getCurrentThread(agentId) {
      return ensure(agentId).currentTurnThreadId;
    },
    setPendingNudge(agentId, nudge) {
      ensure(agentId).pendingNudge = nudge;
    },
  };
};
