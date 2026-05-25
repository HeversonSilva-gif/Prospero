export type Sender = {
  kind: "user" | "agent" | "routine" | "approval";
  id: string | null;
  name: string;
};

type State = {
  currentTurnThreadId: string | null;
  queue: Array<{ threadId: string; content: string; sender: Sender }>;
  // M11 PR-F2: a memory nudge to prepend to this agent's next turn, or null.
  pendingNudge: string | null;
  // Compaction task-state seed to prepend to this agent's next turn, or null.
  pendingSeed: string | null;
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
  // Park a compaction seed to ride along with the agent's next turn.
  setPendingSeed(agentId: string, seed: string): void;
};

const formatSender = (sender: Sender, content: string): string =>
  `[from: ${sender.name}] ${content}`;

export const createRouter = (opts: RouterOptions): Router => {
  const states = new Map<string, State>();

  const ensure = (agentId: string): State => {
    let s = states.get(agentId);
    if (s === undefined) {
      s = { currentTurnThreadId: null, queue: [], pendingNudge: null, pendingSeed: null };
      states.set(agentId, s);
    }
    return s;
  };

  // Prepends and consumes a parked seed (first) and nudge, if any.
  const consumePending = (s: State, content: string): string => {
    let out = content;
    if (s.pendingNudge !== null) {
      out = `${s.pendingNudge}\n\n${out}`;
      s.pendingNudge = null;
    }
    if (s.pendingSeed !== null) {
      out = `${s.pendingSeed}\n\n${out}`;
      s.pendingSeed = null;
    }
    return out;
  };

  return {
    enqueue(agentId, threadId, content, sender) {
      const s = ensure(agentId);
      const formatted = formatSender(sender, content);
      if (s.currentTurnThreadId === null) {
        s.currentTurnThreadId = threadId;
        opts.writeStdin(agentId, consumePending(s, formatted));
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
        opts.writeStdin(agentId, consumePending(s, next.content));
      }
    },
    getCurrentThread(agentId) {
      return ensure(agentId).currentTurnThreadId;
    },
    setPendingNudge(agentId, nudge) {
      ensure(agentId).pendingNudge = nudge;
    },
    setPendingSeed(agentId, seed) {
      ensure(agentId).pendingSeed = seed;
    },
  };
};
