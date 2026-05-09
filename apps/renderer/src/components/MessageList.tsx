import type { Message } from "@dashboard-agent/shared";
import { ToolCallCard } from "./ToolCallCard.js";

export const MessageList = ({ messages }: { messages: Message[] }) => (
  <div className="flex-1 overflow-auto px-7 py-6 flex flex-col gap-4">
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
      return (
        <div
          key={m.id}
          className={`flex gap-3 max-w-[85%] ${isUser ? "self-end flex-row-reverse" : ""}`}
        >
          <div
            className={`w-7 h-7 rounded-md text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              isUser ? "bg-ink" : "bg-brand-dark"
            }`}
          >
            {isUser ? "EU" : "CE"}
          </div>
          <div className="space-y-1">
            {m.content !== "" && (
              <div
                className={`px-3.5 py-3 rounded-lg text-sm leading-snug ${
                  isUser ? "bg-brand-bg text-brand-dark" : "bg-surface-soft text-ink"
                }`}
              >
                {m.content}
              </div>
            )}
            {m.toolCalls?.map((tc) => (
              <ToolCallCard key={tc.id} tool={tc} />
            ))}
          </div>
        </div>
      );
    })}
  </div>
);
