import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { ConfigTab } from "./ConfigTab.js";
import { InstructionsTab } from "./InstructionsTab.js";
import { IssuesTab } from "./IssuesTab.js";
import { StatsTab } from "./StatsTab.js";

type Tab = "config" | "instructions" | "issues" | "stats";

type Props = { agent: Agent };

export const AgentConfigPanel: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("config");
  return (
    <aside className="w-80 border-l border-surface-border bg-surface-card flex flex-col">
      <nav className="flex border-b border-surface-border">
        {(["config", "instructions", "issues", "stats"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-2 text-[11px] font-semibold border-b-2 -mb-px ${
              tab === k
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`agent.panel.tabs.${k}`)}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "instructions" && <InstructionsTab agentId={agent.id} />}
        {tab === "issues" && <IssuesTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "stats" && <StatsTab agentId={agent.id} />}
      </div>
    </aside>
  );
};
