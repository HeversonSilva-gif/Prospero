import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../stores/agents.js";
import { useMessagesStore } from "../stores/messages.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const loadMessages = useMessagesStore((s) => s.load);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messages = useMessagesStore((s) =>
    threadId === null ? [] : (s.byThreadId[threadId] ?? []),
  );

  useEffect(() => {
    if (agent === undefined) return;
    void loadMessages(agent.companyId, ["user", agent.id]).then((tid) => {
      if (tid !== null) setThreadId(tid);
    });
  }, [agent, loadMessages]);

  const onSend = async (content: string) => {
    if (agent === undefined) return;
    const userMsg = await window.dashboardAgent.agents.sendMessage(agent.id, content);
    if (threadId === null) setThreadId(userMsg.threadId);
    // The global onEvent listener (in App.tsx) handles message-append broadcast,
    // so we don't double-append here.
  };

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="px-6 py-3.5 border-b border-surface-border flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-md bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center text-[13px] font-bold">
          {agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-bold text-[15px] text-brand-dark">{agent.name}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {agent.role} · {agent.status}
          </div>
        </div>
      </header>
      <MessageList messages={messages} />
      <Composer onSubmit={(text) => void onSend(text)} />
    </div>
  );
};
