import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { BreadcrumbBar } from "../components/agent-panel/BreadcrumbBar.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";
import { TabBar } from "../components/ui/index.js";
import { IdentidadeTab } from "../components/agent-panel/IdentidadeTab.js";
import { InstructionsTab } from "../components/agent-panel/InstructionsTab.js";
import { HabilidadesTab } from "../components/agent-panel/HabilidadesTab.js";
import { ConfigTab } from "../components/agent-panel/ConfigTab.js";
import { HistoricoTab } from "../components/agent-panel/HistoricoTab.js";

// M16 PR-C3 — /agents/:id/ajustar com 5 abas M16:
// Identidade · Instruções · Habilidades · Comportamento · Histórico.
// AgentStudio.tsx (M12 PR-F) foi deletado neste task.

type AjustarTab = "identidade" | "instrucoes" | "habilidades" | "comportamento" | "historico";

const TABS: AjustarTab[] = [
  "identidade",
  "instrucoes",
  "habilidades",
  "comportamento",
  "historico",
];

export const AgentAjustar = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [ajustarTab, setAjustarTab] = useState<AjustarTab>("identidade");
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
  }, [agent, ajustarTab]);

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
        onOpenLearning={() => setAjustarTab("habilidades")}
      />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-6">
          <TabBar
            variant="underline"
            active={ajustarTab}
            onSelect={(id) => setAjustarTab(id as AjustarTab)}
            tabs={TABS.map((k) => ({ id: k, label: t(`ajustar.tabs.${k}`) }))}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {ajustarTab === "identidade" && <IdentidadeTab agent={agent} />}
          {ajustarTab === "instrucoes" && <InstructionsTab agentId={agent.id} />}
          {ajustarTab === "habilidades" && (
            <HabilidadesTab agentId={agent.id} skills={skills} memories={memories} />
          )}
          {ajustarTab === "comportamento" && <ConfigTab agent={agent} />}
          {ajustarTab === "historico" && (
            <HistoricoTab agentId={agent.id} companyId={agent.companyId} />
          )}
        </div>
      </div>
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
