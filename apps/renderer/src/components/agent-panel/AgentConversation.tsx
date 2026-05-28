import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  isCeoAgent,
  type Agent,
  type Message,
  type PermissionRequest,
  type PermissionResolution,
} from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { ApprovalCard } from "../ApprovalCard.js";
import { MessageList } from "../MessageList.js";
import { DelegationsPanel } from "../DelegationsPanel.js";
import { OrgPlanProposedBanner } from "../OrgPlanProposedBanner.js";
import { RichComposer, type RichComposerHandle } from "../RichComposer.js";
import { AttachmentDropOverlay } from "../AttachmentDropOverlay.js";
import { TabBar } from "../ui/index.js";

type SubTab = "chat" | "delegations";
type Props = { agent: Agent };

export const AgentConversation: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PermissionRequest[]>([]);
  const [sub, setSub] = useState<SubTab>("chat");
  const composerRef = useRef<RichComposerHandle | null>(null);

  useEffect(() => {
    void (async () => {
      const all = await window.prospero.messages.listByAgent(agent.id);
      setMessages(all);
    })();
  }, [agent.id]);

  // Live updates: append directly from the event. Re-fetching the full list on
  // every append used to freeze the chat once a thread crossed ~1k messages —
  // each agent turn fires several appends, each one re-rendering the whole
  // list. The backend now stamps `threadParticipants` on broadcast messages so
  // the chat/delegation split below still works without a refetch.
  useEffect(() => {
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "message-append" && ev.agentId === agent.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === ev.message.id)) return prev;
          return [...prev, ev.message];
        });
      }
    });
    return off;
  }, [agent.id]);

  useEffect(() => {
    const unsub = window.prospero.permissions.onRequest((req) => {
      if (req.agentId === agent.id) {
        setPendingApprovals((prev) => [...prev, req]);
      }
    });
    return unsub;
  }, [agent.id]);

  const { chatMessages, delegationMessages } = useMemo(() => {
    const chat: Message[] = [];
    const delegation: Message[] = [];
    for (const m of messages) {
      const parts = m.threadParticipants;
      if (parts === undefined || parts.includes("user")) chat.push(m);
      else delegation.push(m);
    }
    return { chatMessages: chat, delegationMessages: delegation };
  }, [messages]);

  const resolve = (req: PermissionRequest, allow: boolean): void => {
    const resolution: PermissionResolution = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "User rejected" };
    void window.prospero.permissions.resolve(req.toolUseId, resolution);
    setPendingApprovals((prev) => prev.filter((r) => r.toolUseId !== req.toolUseId));
  };

  const onSend = async (content: string, attachmentIds: string[]): Promise<void> => {
    await window.prospero.agents.sendMessage({ agentId: agent.id, content, attachmentIds });
  };

  return (
    <AttachmentDropOverlay onDrop={(files) => void composerRef.current?.addFiles(files)}>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-2">
          <TabBar
            variant="segmented"
            active={sub}
            onSelect={(id) => setSub(id as SubTab)}
            tabs={[
              { id: "chat", label: t("agent.tabs.chat") },
              {
                id: "delegations",
                label: t("agent.tabs.delegations"),
                badge: delegationMessages.length,
              },
            ]}
          />
        </div>
        {sub === "chat" && isCeoAgent(agent) && <OrgPlanProposedBanner />}
        {sub === "chat" ? (
          <MessageList
            messages={chatMessages}
            agents={agents}
            activeAgent={agents.find((a) => a.id === agent.id) ?? agent}
          />
        ) : (
          <DelegationsPanel
            messages={delegationMessages}
            currentAgentId={agent.id}
            agents={agents}
          />
        )}
        {pendingApprovals.map((req) => (
          <ApprovalCard
            key={req.toolUseId}
            request={req}
            onResolve={(allow) => resolve(req, allow)}
          />
        ))}
        <RichComposer
          ref={composerRef}
          onSubmit={(text, attachmentIds) => void onSend(text, attachmentIds)}
        />
      </div>
    </AttachmentDropOverlay>
  );
};
