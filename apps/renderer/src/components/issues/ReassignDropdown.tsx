import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { useIssuesStore } from "../../stores/issues.js";

type Props = { issueId: string; currentAssigneeId: string | null; agents: Agent[] };

export const ReassignDropdown: FC<Props> = ({ issueId, currentAssigneeId, agents }) => {
  const { t } = useTranslation();
  const updateIssue = useIssuesStore((s) => s.update);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
      >
        {t("issues.detail.reassign")} ▼
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-1 z-10 text-xs min-w-[160px]">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                void updateIssue({ id: issueId, assigneeId: a.id });
                setOpen(false);
              }}
              className={`w-full text-left px-2 py-1 rounded hover:bg-brand-bg ${a.id === currentAssigneeId ? "bg-brand-bg text-brand" : ""}`}
            >
              👤 {a.name} <span className="text-ink-soft">· {a.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
