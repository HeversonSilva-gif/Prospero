import type { FC } from "react";
import type { Project, ProjectPathStatus } from "@dashboard-agent/shared";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  selected: boolean;
  onClick: () => void;
};

export const ProjectListItem: FC<Props> = ({ project, pathStatus, selected, onClick }) => {
  const missing = pathStatus === "missing";
  const cls = [
    "flex items-center gap-2 px-3 py-2 rounded text-sm cursor-pointer",
    selected
      ? "bg-brand-bg text-brand border-l-4 border-l-brand"
      : "hover:bg-surface-soft text-ink-muted",
    missing ? "opacity-60" : "",
  ].join(" ");
  return (
    <div onClick={onClick} className={cls}>
      <span className="w-2 h-2 rounded-full" style={{ background: project.color }} />
      <span className="truncate flex-1">{project.name}</span>
      {missing && <span title="path missing">⚠️</span>}
    </div>
  );
};
