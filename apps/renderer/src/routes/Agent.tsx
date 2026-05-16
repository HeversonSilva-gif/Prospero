import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  Message,
  PermissionRequest,
  PermissionResolution,
  Skill,
  Memory,
} from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { ApprovalCard } from "../components/ApprovalCard.js";
import { MessageList } from "../components/MessageList.js";
import { DelegationsPanel } from "../components/DelegationsPanel.js";
import { LearningPanel } from "../components/agent-panel/LearningPanel.js";
import { Composer } from "../components/Composer.js";
import { AgentConfigPanel } from "../components/agent-panel/AgentConfigPanel.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { RunsModal } from "../components/agent-panel/RunsModal.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

type Tab = "chat" | "delegations" | "learning";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const agents = useAgentsStore((s) => s.agents);
  const [messages, setMessages] = useState<Message[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PermissionRequest[]>([]);
  const [tab, setTab] = useState<Tab>("chat");
  const [showAssignTask, setShowAssignTask] = useState(false);
  const [showRuns, setShowRuns] = useState(false);

  // Load all messages for this agent across all threads
  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const all = await window.prospero.messages.listByAgent(agent.id);
      setMessages(all);
    })();
  }, [agent]);

  // Load the agent's M11 skills + memory entries. Re-fetched whenever the
  // Learning tab is (re-)opened so it reflects what the agent has captured.
  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const [s, m] = await Promise.all([
        window.prospero.learning.listSkills(agent.id),
        window.prospero.learning.listMemories(agent.id),
      ]);
      setSkills(s);
      setMemories(m);
    })();
  }, [agent, tab]);

  // Subscribe to agent events and refetch messages on new message-append
  useEffect(() => {
    if (agent === undefined) return;
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "message-append") {
        void (async () => {
          const all = await window.prospero.messages.listByAgent(agent.id);
          setMessages(all);
        })();
      }
    });
    return off;
  }, [agent]);

  // Subscribe to permission requests for this agent
  useEffect(() => {
    const unsub = window.prospero.permissions.onRequest((req) => {
      if (agent !== undefined && req.agentId === agent.id) {
        setPendingApprovals((prev) => [...prev, req]);
      }
    });
    return unsub;
  }, [agent]);

  const { chatMessages, delegationMessages } = useMemo(() => {
    const chat: Message[] = [];
    const delegation: Message[] = [];
    for (const m of messages) {
      const parts = m.threadParticipants;
      // Threads without participants metadata or that include "user" are user-facing.
      if (parts === undefined || parts.includes("user")) {
        chat.push(m);
      } else {
        delegation.push(m);
      }
    }
    return { chatMessages: chat, delegationMessages: delegation };
  }, [messages]);

  const resolve = (req: PermissionRequest, allow: boolean) => {
    const resolution: PermissionResolution = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "User rejected" };
    void window.prospero.permissions.resolve(req.toolUseId, resolution);
    setPendingApprovals((prev) => prev.filter((r) => r.toolUseId !== req.toolUseId));
  };

  const onSend = async (content: string) => {
    if (agent === undefined) return;
    await window.prospero.agents.sendMessage(agent.id, content);
    // The agent event subscription above handles refetching messages after send.
  };

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col min-w-0">
        <AgentHeader
          agent={agent}
          onAssignTask={() => setShowAssignTask(true)}
          onOpenRuns={() => setShowRuns(true)}
          skillCount={skills.length}
          memoryCount={memories.length}
          onOpenLearning={() => setTab("learning")}
        />
        <div className="flex border-b border-surface-border px-6">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === "chat"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.chat")}
          </button>
          <button
            type="button"
            onClick={() => setTab("delegations")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
              tab === "delegations"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.delegations")}
            {delegationMessages.length > 0 && (
              <span className="text-[10px] bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded-full">
                {delegationMessages.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("learning")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === "learning"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.learning")}
          </button>
        </div>
        {tab === "chat" && <MessageList messages={chatMessages} agents={agents} />}
        {tab === "delegations" && (
          <DelegationsPanel
            messages={delegationMessages}
            currentAgentId={agent.id}
            agents={agents}
          />
        )}
        {tab === "learning" && (
          <LearningPanel agentId={agent.id} skills={skills} memories={memories} />
        )}
        {pendingApprovals.map((req) => (
          <ApprovalCard
            key={req.toolUseId}
            request={req}
            onResolve={(allow) => resolve(req, allow)}
          />
        ))}
        <Composer onSubmit={(text) => void onSend(text)} />
      </div>
      <AgentConfigPanel agent={agent} />

      {showAssignTask && (
        <IssueFormModal
          companyId={agent.companyId}
          initialAssigneeId={agent.id}
          onClose={() => setShowAssignTask(false)}
        />
      )}
      {showRuns && <RunsModal agentId={agent.id} onClose={() => setShowRuns(false)} />}
    </div>
  );
};
