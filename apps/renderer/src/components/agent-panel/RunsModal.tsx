import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@dashboard-agent/shared";

interface Props {
  agentId: string;
  onClose: () => void;
}

interface RunBlock {
  turns: Message[];
}

export const groupBySession = (messages: Message[]): RunBlock[] => {
  // Bucket consecutive agent-sent messages into blocks separated by user
  // messages. The shared Message type does not carry a session id today, so
  // this contiguity heuristic is the v1 grouping. Future: include sessionId
  // when available and switch to equality bucketing.
  const blocks: RunBlock[] = [];
  let current: RunBlock | null = null;
  for (const m of messages) {
    if (m.senderKind !== "agent") {
      if (current !== null) {
        blocks.push(current);
        current = null;
      }
      continue;
    }
    if (current === null) {
      current = { turns: [m] };
    } else {
      current.turns.push(m);
    }
  }
  if (current !== null) blocks.push(current);
  return blocks;
};

export const RunsModal: FC<Props> = ({ agentId, onClose }) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    void (async () => {
      const msgs = await window.dashboardAgent.messages.listByAgent(agentId);
      setMessages(msgs);
    })();
  }, [agentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blocks = useMemo(() => groupBySession(messages), [messages]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
      <div className="bg-surface-card rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-surface-border flex justify-between items-center">
          <h2 className="text-base font-semibold text-brand-dark">{t("agent.runs.title")}</h2>
          <button type="button" onClick={onClose} className="text-xs text-ink-muted hover:text-ink">
            {t("agent.runs.close")}
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5">
          {blocks.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("agent.runs.empty")}</p>
          ) : (
            blocks.map((block, idx) => (
              <section key={idx} className="mb-4">
                <h3 className="text-xs font-semibold text-ink-muted mb-1">
                  {t("agent.runs.session", { n: idx + 1 })}
                </h3>
                <ul className="space-y-1">
                  {block.turns.map((turn) => {
                    const tools = turn.toolCalls?.length ?? 0;
                    const when = new Date(turn.createdAt).toLocaleTimeString();
                    return (
                      <li
                        key={turn.id}
                        className="text-xs text-ink-soft border-l-2 border-surface-border pl-2"
                      >
                        {t("agent.runs.turn", { when, tools })}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
