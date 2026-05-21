import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentStudio, type StudioTab } from "../components/agent-panel/AgentStudio.js";
import { BreadcrumbBar } from "../components/agent-panel/BreadcrumbBar.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

// M16 PR-C2 — /agents/:id/ajustar — placeholder. Renderiza AgentStudio
// (6 abas existentes). PR-C3 vai substituir AgentStudio pelo layout
// novo de 5 abas (Identidade · Instruções · Habilidades · Comportamento · Histórico).

export const AgentAjustar = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [studioTab, setStudioTab] = useState<StudioTab>("config");
  const [showAssignTask, setShowAssignTask] = useState(false);

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
  }, [agent, studioTab]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <BreadcrumbBar agentId={agent.id} agentName={agent.name} mode="ajustar" />
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => setStudioTab("learning")}
      />
      <AgentStudio
        agent={agent}
        tab={studioTab}
        onTab={setStudioTab}
        skills={skills}
        memories={memories}
      />
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
