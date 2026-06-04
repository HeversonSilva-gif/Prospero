export type Sender = {
  kind: "user" | "agent" | "routine" | "approval";
  id: string | null;
  name: string;
};

type State = {
  currentTurnThreadId: string | null;
  queue: Array<{
    threadId: string;
    content: string;
    sender: Sender;
    messageId: string | null;
  }>;
  // M11 PR-F2: a memory nudge to prepend to this agent's next turn, or null.
  pendingNudge: string | null;
  // Compaction task-state seed to prepend to this agent's next turn, or null.
  pendingSeed: string | null;
};

export type RouterOptions = {
  writeStdin: (agentId: string, content: string, messageId: string | null) => void;
  /** Returns true when the agent has a live adapter that can accept input now. */
  hasLiveAdapter: (agentId: string) => boolean;
  /** Called when a message is held for an agent with no live adapter, so the
   *  scheduler can spawn/drain immediately instead of waiting for the next tick. */
  requestDrain?: () => void;
  /** Persist a durable copy of the agent's parked compaction seed (or null to
   *  clear it on consume) so it survives a process restart. The router's `states`
   *  map is in-RAM, so without this a restart after a compaction loses the
   *  "[CONTEXT COMPACTED] where you left off" seed and the respawn starts blind
   *  (audit I8). Optional — omitted in tests / non-persisting contexts. */
  persistSeed?: (agentId: string, seed: string | null) => void;
};

export type Router = {
  enqueue(
    agentId: string,
    threadId: string,
    content: string,
    sender: Sender,
    messageId: string | null,
  ): void;
  /** Flush one held message to a newly-spawned agent. Call right after a spawn succeeds. */
  deliverQueued(agentId: string): void;
  /** True when the agent has an in-flight turn OR messages waiting in the queue. */
  hasPendingWork(agentId: string): boolean;
  /** All agent ids (in insertion order) that have pending work. */
  listPendingAgentIds(): string[];
  onTurnComplete(agentId: string): void;
  getCurrentThread(agentId: string): string | null;
  // M11 PR-F2: park a nudge to ride along with the agent's next turn.
  setPendingNudge(agentId: string, nudge: string): void;
  // Park a compaction seed to ride along with the agent's next turn.
  setPendingSeed(agentId: string, seed: string): void;
  // Park a recall seed ONLY when no seed is already parked (compaction has priority).
  setPendingSeedIfAbsent(agentId: string, seed: string): void;
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
  const consumePending = (agentId: string, s: State, content: string): string => {
    let out = content;
    if (s.pendingNudge !== null) {
      out = `${s.pendingNudge}\n\n${out}`;
      s.pendingNudge = null;
    }
    if (s.pendingSeed !== null) {
      out = `${s.pendingSeed}\n\n${out}`;
      s.pendingSeed = null;
      opts.persistSeed?.(agentId, null); // consumed → clear the durable copy
    }
    return out;
  };

  return {
    enqueue(agentId, threadId, content, sender, messageId) {
      const s = ensure(agentId);
      const formatted = formatSender(sender, content);
      if (s.currentTurnThreadId === null && opts.hasLiveAdapter(agentId)) {
        s.currentTurnThreadId = threadId;
        opts.writeStdin(agentId, consumePending(agentId, s, formatted), messageId);
      } else {
        s.queue.push({ threadId, content: formatted, sender, messageId });
        if (!opts.hasLiveAdapter(agentId)) opts.requestDrain?.();
      }
    },
    deliverQueued(agentId) {
      const s = ensure(agentId);
      if (s.currentTurnThreadId === null && s.queue.length > 0 && opts.hasLiveAdapter(agentId)) {
        const next = s.queue.shift()!;
        s.currentTurnThreadId = next.threadId;
        opts.writeStdin(agentId, consumePending(agentId, s, next.content), next.messageId);
      }
    },
    hasPendingWork(agentId) {
      const s = states.get(agentId);
      if (s === undefined) return false;
      return s.currentTurnThreadId !== null || s.queue.length > 0;
    },
    listPendingAgentIds() {
      const result: string[] = [];
      for (const [id, s] of states) {
        if (s.currentTurnThreadId !== null || s.queue.length > 0) {
          result.push(id);
        }
      }
      return result;
    },
    onTurnComplete(agentId) {
      const s = ensure(agentId);
      const next = s.queue.shift();
      if (next === undefined) {
        s.currentTurnThreadId = null;
      } else {
        s.currentTurnThreadId = next.threadId;
        opts.writeStdin(agentId, consumePending(agentId, s, next.content), next.messageId);
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
      opts.persistSeed?.(agentId, seed);
    },
    setPendingSeedIfAbsent(agentId, seed) {
      const s = ensure(agentId);
      if (s.pendingSeed === null) {
        s.pendingSeed = seed;
        opts.persistSeed?.(agentId, seed);
      }
    },
  };
};
