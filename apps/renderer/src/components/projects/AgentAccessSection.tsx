import { useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { NO_ACCESS_SENTINEL, type Agent, type Project } from "@dashboard-agent/shared";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  agents: Agent[];
  project: Project;
  allProjects: Project[];
};

const hasAccess = (agent: Agent, projectId: string) =>
  agent.allowedProjects.length === 0 || agent.allowedProjects.includes(projectId);

export const AgentAccessSection: FC<Props> = ({ agents, project, allProjects }) => {
  const { t } = useTranslation();
  const setAllowedProjects = useAgentsStore((s) => s.setAllowedProjects);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const withAccess = agents.filter((a) => hasAccess(a, project.id));
  const withoutAccess = agents.filter((a) => !hasAccess(a, project.id));

  const revoke = async (agent: Agent) => {
    const base =
      agent.allowedProjects.length === 0
        ? allProjects.map((p) => p.id)
        : agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    const filtered = base.filter((id) => id !== project.id);
    // [] would flip back to "all access" sentinel — use NO_ACCESS_SENTINEL instead.
    const next = filtered.length === 0 ? [NO_ACCESS_SENTINEL] : filtered;
    await setAllowedProjects(agent.id, next);
  };

  const grant = async (agent: Agent) => {
    if (agent.allowedProjects.length === 0) return;
    const cleaned = agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    await setAllowedProjects(agent.id, [...cleaned, project.id]);
    setPickerOpen(false);
  };

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {withAccess.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => void revoke(a)}
          title={t("projects.detail.removeAccessTitle")}
          className="group text-xs px-2 py-0.5 rounded-full bg-brand-bg text-brand hover:bg-semantic-danger hover:text-white transition-colors flex items-center gap-1"
        >
          <span>
            {a.name}
            {a.role.length > 0 && (
              <span className="text-ink-soft group-hover:text-white/80"> · {a.role}</span>
            )}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">×</span>
        </button>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={withoutAccess.length === 0}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-surface-border text-ink-muted hover:text-brand hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("projects.detail.addAgent")}
        </button>
        {pickerOpen && withoutAccess.length > 0 && (
          <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-1 z-10 min-w-[180px]">
            {withoutAccess.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void grant(a)}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-brand-bg hover:text-brand"
              >
                {a.name}
                {a.role.length > 0 && <span className="text-ink-soft"> · {a.role}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
