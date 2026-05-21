import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentConversation } from "../components/agent-panel/AgentConversation.js";
import { BreadcrumbBar } from "../components/agent-panel/BreadcrumbBar.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

// M16 PR-C2 — Página do funcionário (modo conversa).
// /agents/:id agora é só a conversa + header com link "Ajustar" → /agents/:id/ajustar.
// O Estúdio (6 abas) saiu desta rota — vive em /agents/:id/ajustar (AgentAjustar.tsx).
// Mode TabBar removido; M16 spec §9 diz "a página É a conversa".

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showAssignTask, setShowAssignTask] = useState(false);

  // M11 skills/memory feed the AgentHeader 🎓 badge.
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
  }, [agent]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <BreadcrumbBar agentId={agent.id} agentName={agent.name} mode="conversa" />
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => {
          // M16 PR-C2: Learning tab moved into /agents/:id/ajustar (PR-C3 reskin).
          // No-op here — Learning content is reachable via the Ajustar button.
        }}
      />
      <AgentConversation agent={agent} />
      {showAssignTask && (
        <IssueFormModal
          companyId={agent.companyId}
          initialAssigneeId={agent.id}
          onClose={() => setShowAssignTask(false)}
        />
      )}
    </div>
  );
};
