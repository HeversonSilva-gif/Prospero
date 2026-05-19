import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Skill, Memory } from "@prospero/shared";
import { ConfigTab } from "./ConfigTab.js";
import { InstructionsTab } from "./InstructionsTab.js";
import { LearningPanel } from "./LearningPanel.js";
import { IssuesTab } from "./IssuesTab.js";
import { RunsTab } from "./RunsTab.js";
import { StatsTab } from "./StatsTab.js";
import { TabBar } from "../ui/index.js";

export type StudioTab = "config" | "instructions" | "learning" | "issues" | "runs" | "stats";

type Props = {
  agent: Agent;
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  skills: Skill[];
  memories: Memory[];
};

const TABS: StudioTab[] = ["config", "instructions", "learning", "issues", "runs", "stats"];

export const AgentStudio: FC<Props> = ({ agent, tab, onTab, skills, memories }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6">
        <TabBar
          variant="underline"
          active={tab}
          onSelect={(id) => onTab(id as StudioTab)}
          tabs={TABS.map((k) => ({ id: k, label: t(`agent.panel.tabs.${k}`) }))}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "instructions" && <InstructionsTab agentId={agent.id} />}
        {tab === "learning" && (
          <LearningPanel agentId={agent.id} skills={skills} memories={memories} />
        )}
        {tab === "issues" && <IssuesTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "runs" && <RunsTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "stats" && <StatsTab agentId={agent.id} />}
      </div>
    </div>
  );
};
