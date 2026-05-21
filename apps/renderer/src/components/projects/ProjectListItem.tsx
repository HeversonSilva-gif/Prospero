import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project, ProjectPathStatus } from "@prospero/shared";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  selected: boolean;
  counts: { done: number; total: number } | null;
  onClick: () => void;
};

export const ProjectListItem: FC<Props> = ({ project, pathStatus, selected, counts, onClick }) => {
  const { t } = useTranslation();
  const missing = pathStatus === "missing";
  const archived = project.archivedAt !== null;
  const cls = [
    "px-3 py-2 rounded cursor-pointer",
    selected
      ? "bg-brand-bg text-brand border-l-4 border-l-brand"
      : "hover:bg-surface-soft text-ink-muted",
    missing ? "opacity-60" : "",
    archived ? "italic text-ink-soft" : "",
  ].join(" ");
  const pct =
    counts !== null && counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  return (
    <div onClick={onClick} className={cls}>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: project.color }} />
        {project.icon !== null && <span className="text-base shrink-0">{project.icon}</span>}
        <span className="truncate flex-1">{project.name}</span>
        {archived && <span className="text-[10px] uppercase tracking-wide">arq</span>}
        {missing && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-semantic-danger shrink-0"
            aria-label="path missing"
          >
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
        )}
      </div>
      {counts !== null && counts.total > 0 && (
        <div className="mt-1 pl-4">
          <div className="text-[10px] text-ink-soft">
            {t("projetos.detail.tasksProgress", { done: counts.done, total: counts.total })}
          </div>
          <div className="h-1 mt-0.5 rounded-full bg-surface-border overflow-hidden">
            <div className="h-full bg-semantic-success rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
};
