import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentConversation } from "../components/agent-panel/AgentConversation.js";
import { AgentStudio, type StudioTab } from "../components/agent-panel/AgentStudio.js";
import { TabBar } from "../components/ui/index.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

type Mode = "conversa" | "estudio";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [mode, setMode] = useState<Mode>("conversa");
  const [studioTab, setStudioTab] = useState<StudioTab>("config");
  const [showAssignTask, setShowAssignTask] = useState(false);

  // M11 skills/memory feed the header 🎓 badge and the Learning tab.
  // Refetched whenever the studio (re-)opens the Learning tab.
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
  }, [agent, mode, studioTab]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => {
          setMode("estudio");
          setStudioTab("learning");
        }}
      />
      <div className="px-6 py-2 border-b border-surface-border">
        <TabBar
          variant="segmented"
          active={mode}
          onSelect={(id) => setMode(id as Mode)}
          tabs={[
            { id: "conversa", label: t("agent.mode.conversa") },
            { id: "estudio", label: t("agent.mode.estudio") },
          ]}
        />
      </div>
      {mode === "conversa" ? (
        <AgentConversation agent={agent} />
      ) : (
        <AgentStudio
          agent={agent}
          tab={studioTab}
          onTab={setStudioTab}
          skills={skills}
          memories={memories}
        />
      )}
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
