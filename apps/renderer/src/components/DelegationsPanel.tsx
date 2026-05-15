import { useMemo, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Message } from "@prospero/shared";
import { ToolCallCard } from "./ToolCallCard.js";

type Props = {
  messages: Message[];
  currentAgentId: string;
  agents: Agent[];
};

const initials = (name: string): string => name.slice(0, 2).toUpperCase();

const formatTime = (ts: number, locale: string): string =>
  new Date(ts).toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

// Group delegation messages (threads where current agent talks to another
// agent, no user participant) by the other agent. Shows each thread as a
// chronological log with clear direction (→ outgoing / ← incoming) and
// timestamps per message.
export const DelegationsPanel: FC<Props> = ({ messages, currentAgentId, agents }) => {
  const { t, i18n } = useTranslation();
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const currentAgent = agentsById.get(currentAgentId);

  const groups = useMemo(() => {
    const byOther = new Map<string, Message[]>();
    for (const m of messages) {
      const parts = m.threadParticipants ?? [];
      const other = parts.find((p) => p !== currentAgentId);
      if (other === undefined) continue;
      const list = byOther.get(other) ?? [];
      list.push(m);
      byOther.set(other, list);
    }
    return Array.from(byOther.entries()).map(([otherId, msgs]) => ({
      otherId,
      otherAgent: agentsById.get(otherId),
      messages: msgs,
    }));
  }, [messages, currentAgentId, agentsById]);

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-ink-muted">
        {t("agent.delegations.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {groups.map((g) => {
        const otherName = g.otherAgent?.name ?? g.otherId;
        return (
          <details key={g.otherId} open className="border-b border-surface-border last:border-b-0">
            <summary className="px-7 py-3 cursor-pointer bg-surface-soft hover:bg-surface-border text-sm font-semibold text-brand-dark flex items-center gap-2">
              <span className="text-[10px] uppercase text-ink-soft">
                {t("agent.delegations.threadWith")}
              </span>
              <span>{otherName}</span>
              <span className="ml-auto text-[10px] text-ink-muted font-normal">
                {t("agent.delegations.messageCount", { count: g.messages.length })}
              </span>
            </summary>
            <div className="px-7 py-4 flex flex-col gap-3">
              {g.messages.map((m) => {
                const isOutgoing = m.senderId === currentAgentId;
                const sender = m.senderId !== null ? agentsById.get(m.senderId) : undefined;
                const senderName = sender?.name ?? "?";
                const arrow = isOutgoing ? "→" : "←";
                const counterpartName = isOutgoing ? otherName : (currentAgent?.name ?? "Você");
                const headerLabel = isOutgoing
                  ? `${senderName} ${arrow} ${counterpartName}`
                  : `${senderName} ${arrow} ${counterpartName}`;
                return (
                  <div key={m.id} className={`flex gap-3 ${isOutgoing ? "" : "flex-row-reverse"}`}>
                    <div
                      className={`w-7 h-7 rounded-md text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                        isOutgoing ? "bg-brand-dark" : "bg-ink"
                      }`}
                      title={senderName}
                    >
                      {initials(senderName)}
                    </div>
                    <div className={`flex-1 max-w-[80%] ${isOutgoing ? "" : "text-right"}`}>
                      <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold flex items-center gap-2">
                        <span>{headerLabel}</span>
                        <span className="text-ink-muted normal-case font-normal">
                          {formatTime(m.createdAt, i18n.language)}
                        </span>
                      </div>
                      {m.content !== "" && (
                        <div
                          className={`mt-1 inline-block px-3.5 py-3 rounded-lg text-sm leading-snug text-left ${
                            isOutgoing ? "bg-brand-bg text-brand-dark" : "bg-surface-soft text-ink"
                          }`}
                        >
                          {m.content}
                        </div>
                      )}
                      {(m.toolCalls ?? []).map((tc) => (
                        <div key={tc.id} className="mt-1 text-left">
                          <ToolCallCard tool={tc} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
};
