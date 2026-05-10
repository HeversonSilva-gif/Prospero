import { useState, type FC } from "react";
import type { Agent, Project } from "@dashboard-agent/shared";

type Props = {
  agent: Agent;
  project: Project;
};

export const AllowlistEditor: FC<Props> = ({ agent, project }) => {
  const allowed = agent.allowedProjects.length === 0 || agent.allowedProjects.includes(project.id);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    let next: string[];
    if (agent.allowedProjects.length === 0) {
      // Currently "all"; revoke just this project = empty list (effectively "none").
      // Full multi-project picker is M9 polish; v1 minimal flow.
      next = [];
    } else {
      next = allowed
        ? agent.allowedProjects.filter((id) => id !== project.id)
        : [...agent.allowedProjects, project.id];
    }
    await window.dashboardAgent.agents.setAllowedProjects(agent.id, next);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-xs px-2 py-0.5 rounded-full ${allowed ? "bg-brand-bg text-brand" : "bg-surface-soft text-ink-muted"}`}
      >
        {agent.name}
        {agent.role.length > 0 && <span className="text-ink-soft"> · {agent.role}</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-2 z-10 text-xs whitespace-nowrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allowed} onChange={() => void toggle()} />
            <span>Has access to {project.name}</span>
          </label>
        </div>
      )}
    </div>
  );
};
