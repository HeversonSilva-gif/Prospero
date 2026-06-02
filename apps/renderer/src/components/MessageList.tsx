import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Attachment, Message, MessageKind } from "@prospero/shared";
import { FoldedActivity } from "./FoldedActivity.js";
import { AgentActivityIndicator } from "./AgentActivityIndicator.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { AttachmentChip } from "./AttachmentChip.js";

// Default window: render only the last N messages to keep the initial mount
// snappy. Long threads (2k+ messages) previously froze the renderer because
// every row instantiates MarkdownContent and ToolCallCard synchronously.
const DEFAULT_WINDOW = 200;

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

type RowProps = {
  message: Message;
  senderName: string;
  senderInitials: string;
};

// Memoized row so streaming a new message only renders the new row + the
// auto-scroll effect, not the entire history.
const MessageRow = memo(({ message, senderName, senderInitials }: RowProps) => {
  const { t } = useTranslation();
  const m = message;

  if (m.senderKind === "system") {
    return (
      <div className="self-center text-xs text-ink-soft bg-surface-soft px-3 py-1 rounded-full border border-surface-border">
        {m.content}
      </div>
    );
  }

  const isUser = m.senderKind === "user";
  const avatar = isUser ? "EU" : senderInitials;
  const name = isUser ? "Você" : senderName;

  return (
    <div className={`flex gap-3 max-w-[85%] ${isUser ? "self-end flex-row-reverse" : ""}`}>
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
        {m.attachments !== undefined && m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {m.attachments.map((a: Attachment) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                mode="sent"
                onOpen={() => void window.prospero.attachments.open(a.id)}
              />
            ))}
          </div>
        )}
        {m.toolCalls !== null && m.toolCalls.length > 0 && <FoldedActivity tools={m.toolCalls} />}
      </div>
    </div>
  );
});
MessageRow.displayName = "MessageRow";

export const MessageList = ({ messages, agents, activeAgent }: Props) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [showAll, setShowAll] = useState(false);

  const hiddenCount =
    !showAll && messages.length > DEFAULT_WINDOW ? messages.length - DEFAULT_WINDOW : 0;
  const visible = useMemo(
    () => (hiddenCount > 0 ? messages.slice(-DEFAULT_WINDOW) : messages),
    [messages, hiddenCount],
  );

  // Auto-scroll to bottom whenever the message list grows, its last message
  // changes, or the activity indicator appears/changes — so the live status is
  // visible without manual scrolling.
  const lastId = visible.length > 0 ? visible[visible.length - 1]!.id : null;
  const activeStatus = activeAgent?.status ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [visible.length, lastId, activeStatus]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-6 flex flex-col gap-4">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-center text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded border border-surface-border hover:text-ink"
        >
          {t("message.loadOlder", { count: hiddenCount })}
        </button>
      )}
      {visible.map((m) => {
        const sender = m.senderId !== null ? agentsById.get(m.senderId) : undefined;
        const senderName = sender?.name ?? "Agent";
        const senderInitials = sender ? initials(sender.name) : "??";
        return (
          <MessageRow
            key={m.id}
            message={m}
            senderName={senderName}
            senderInitials={senderInitials}
          />
        );
      })}
      <AgentActivityIndicator agent={activeAgent} />
    </div>
  );
};
