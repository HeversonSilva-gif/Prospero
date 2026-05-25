import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Message, MessageKind } from "@prospero/shared";
import { ToolCallCard } from "./ToolCallCard.js";
import { AgentActivityIndicator } from "./AgentActivityIndicator.js";
import { MarkdownContent } from "./MarkdownContent.js";

type Props = {
  messages: Message[];
  agents: Agent[];
  // The agent we're waiting on in this conversation (CEO in Pedir algo, the
  // open agent in the studio). When it's thinking/working, a live indicator is
  // shown so a quiet turn doesn't read as frozen.
  activeAgent?: Agent | null;
};

const initials = (name: string): string => name.slice(0, 2).toUpperCase();

const KIND_STYLES: Record<Exclude<MessageKind, "message">, string> = {
  proposal: "bg-amber-100 text-amber-900 border-amber-300",
  question: "bg-sky-100 text-sky-900 border-sky-300",
  confirmation: "bg-emerald-100 text-emerald-900 border-emerald-300",
  observation: "bg-slate-100 text-slate-700 border-slate-300",
};

export const MessageList = ({ messages, agents, activeAgent }: Props) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // Auto-scroll to bottom whenever the message list grows, its last message
  // changes, or the activity indicator appears/changes — so the live status is
  // visible without manual scrolling.
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  const activeStatus = activeAgent?.status ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastId, activeStatus]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-6 flex flex-col gap-4">
      {messages.map((m) => {
        if (m.senderKind === "system") {
          return (
            <div
              key={m.id}
              className="self-center text-xs text-ink-soft bg-surface-soft px-3 py-1 rounded-full border border-surface-border"
            >
              {m.content}
            </div>
          );
        }
        const isUser = m.senderKind === "user";
        const sender = m.senderId !== null ? agentsById.get(m.senderId) : undefined;
        const avatar = isUser ? "EU" : sender ? initials(sender.name) : "??";
        const name = isUser ? "Você" : (sender?.name ?? "Agent");
        return (
          <div
            key={m.id}
            className={`flex gap-3 max-w-[85%] ${isUser ? "self-end flex-row-reverse" : ""}`}
          >
            <div
              className={`w-7 h-7 rounded-md text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                isUser ? "bg-ink" : "bg-brand-dark"
              }`}
              title={name}
            >
              {avatar}
            </div>
            <div className="space-y-1">
              {!isUser && (
                <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold flex items-center gap-1.5">
                  <span>{name}</span>
                  {m.kind !== "message" && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${KIND_STYLES[m.kind]}`}
                    >
                      {t(`message.kind.${m.kind}`)}
                    </span>
                  )}
                </div>
              )}
              {m.content !== "" && (
                <div
                  className={`px-3.5 py-3 rounded-lg text-sm ${
                    isUser ? "bg-brand-bg text-brand-dark" : "bg-surface-soft text-ink"
                  }`}
                >
                  <MarkdownContent content={m.content} isUser={isUser} />
                </div>
              )}
              {m.toolCalls?.map((tc) => (
                <ToolCallCard key={tc.id} tool={tc} />
              ))}
            </div>
          </div>
        );
      })}
      <AgentActivityIndicator agent={activeAgent} />
    </div>
  );
};
