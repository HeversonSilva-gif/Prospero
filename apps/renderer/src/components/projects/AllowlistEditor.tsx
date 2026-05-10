import { useState, type FC } from "react";
import type { Agent, Project } from "@dashboard-agent/shared";

type Props = {
  agent: Agent;
  project: Project;
};

// TODO Task 9: wire window.dashboardAgent.agents.setAllowedProjects + agent.allowedProjects.
export const AllowlistEditor: FC<Props> = ({ agent, project }) => {
  const allowed = true; // TODO Task 9: read from agent.allowedProjects
  const [open, setOpen] = useState(false);

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
            <input type="checkbox" checked={allowed} disabled />
            <span>Has access to {project.name}</span>
          </label>
        </div>
      )}
    </div>
  );
};
