import { useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { NO_ACCESS_SENTINEL, type Agent, type Project } from "@dashboard-agent/shared";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  agent: Agent;
  allProjects: Project[];
};

const hasAccess = (agent: Agent, projectId: string): boolean =>
  agent.allowedProjects.length === 0 || agent.allowedProjects.includes(projectId);

export const AgentProjectsEditor: FC<Props> = ({ agent, allProjects }) => {
  const { t } = useTranslation();
  const setAllowedProjects = useAgentsStore((s) => s.setAllowedProjects);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const granted = allProjects.filter((p) => hasAccess(agent, p.id));
  const ungranted = allProjects.filter((p) => !hasAccess(agent, p.id));

  const revoke = async (project: Project): Promise<void> => {
    // If we're at "all access" ([]), materialize to explicit list minus this one.
    const base =
      agent.allowedProjects.length === 0
        ? allProjects.map((p) => p.id)
        : agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    const filtered = base.filter((id) => id !== project.id);
    const next = filtered.length === 0 ? [NO_ACCESS_SENTINEL] : filtered;
    await setAllowedProjects(agent.id, next);
  };

  const grant = async (project: Project): Promise<void> => {
    if (agent.allowedProjects.length === 0) return;
    const cleaned = agent.allowedProjects.filter((id) => id !== NO_ACCESS_SENTINEL);
    await setAllowedProjects(agent.id, [...cleaned, project.id]);
    setPickerOpen(false);
  };

  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {granted.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => void revoke(p)}
          title={t("agent.config.projects.removeTitle")}
          className="group text-[11px] px-2 py-0.5 rounded-full bg-brand-bg text-brand hover:bg-semantic-danger hover:text-white transition-colors flex items-center gap-1"
        >
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="opacity-0 group-hover:opacity-100">×</span>
        </button>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={ungranted.length === 0}
          className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-surface-border text-ink-muted hover:text-brand hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("agent.config.projects.add")}
        </button>
        {pickerOpen && ungranted.length > 0 && (
          <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-1 z-10 min-w-[160px]">
            {ungranted.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void grant(p)}
                className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-brand-bg hover:text-brand flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {agent.allowedProjects.length === 0 && (
        <span className="text-[10px] text-ink-soft italic">
          {t("agent.config.projects.allAccess")}
        </span>
      )}
    </div>
  );
};
