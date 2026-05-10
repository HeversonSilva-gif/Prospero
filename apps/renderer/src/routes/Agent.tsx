import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Message, PermissionRequest, PermissionResolution } from "@dashboard-agent/shared";
import { useAgentsStore } from "../stores/agents.js";
import { ApprovalCard } from "../components/ApprovalCard.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PermissionRequest[]>([]);

  // Load all messages for this agent across all threads
  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const all = await window.dashboardAgent.messages.listByAgent(agent.id);
      setMessages(all);
    })();
  }, [agent]);

  // Subscribe to agent events and refetch messages on new message-append
  useEffect(() => {
    if (agent === undefined) return;
    const off = window.dashboardAgent.agents.onEvent((ev) => {
      if (ev.kind === "message-append") {
        void (async () => {
          const all = await window.dashboardAgent.messages.listByAgent(agent.id);
          setMessages(all);
        })();
      }
    });
    return off;
  }, [agent]);

  // Subscribe to permission requests for this agent
  useEffect(() => {
    const unsub = window.dashboardAgent.permissions.onRequest((req) => {
      if (agent !== undefined && req.agentId === agent.id) {
        setPendingApprovals((prev) => [...prev, req]);
      }
    });
    return unsub;
  }, [agent]);

  const resolve = (req: PermissionRequest, allow: boolean) => {
    const resolution: PermissionResolution = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "User rejected" };
    void window.dashboardAgent.permissions.resolve(req.toolUseId, resolution);
    setPendingApprovals((prev) => prev.filter((r) => r.toolUseId !== req.toolUseId));
  };

  const onSend = async (content: string) => {
    if (agent === undefined) return;
    await window.dashboardAgent.agents.sendMessage(agent.id, content);
    // The agent event subscription above handles refetching messages after send.
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
      {pendingApprovals.map((req) => (
        <ApprovalCard
          key={req.toolUseId}
          request={req}
          onResolve={(allow) => resolve(req, allow)}
        />
      ))}
      <Composer onSubmit={(text) => void onSend(text)} />
    </div>
  );
};
