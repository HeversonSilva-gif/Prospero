import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project, Agent, Issue, ProjectPathStatus } from "@dashboard-agent/shared";
import { AgentAccessSection } from "./AgentAccessSection.js";
import { useProjectsStore } from "../../stores/projects.js";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  agents: Agent[];
  allProjects: Project[];
  recentIssues: Issue[];
  doingCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
};

export const ProjectDetail: FC<Props> = ({
  project,
  pathStatus,
  agents,
  allProjects,
  recentIssues,
  doingCount,
  onEdit,
  onDelete,
  onOpenFolder,
}) => {
  const { t } = useTranslation();
  const missing = pathStatus === "missing";
  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full" style={{ background: project.color }} />
        <h2 className="text-xl font-bold text-brand-dark">{project.name}</h2>
        {missing && (
          <span className="ml-2 text-xs bg-semantic-danger text-white px-2 py-0.5 rounded">
            {t("projects.detail.pathMissing")}
          </span>
        )}
      </div>
      <div className="font-mono text-xs bg-surface-soft px-2 py-1 rounded mb-3 break-all">
        📁 {project.path}
      </div>
      <p className="text-sm text-ink-muted mb-4">
        {t("projects.detail.counts", {
          agents: agents.length,
          issues: recentIssues.length,
          doing: doingCount,
        })}
      </p>
      <div className="mb-4">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("projects.detail.agentsWithAccess")}
        </h3>
        <AgentAccessSection agents={agents} project={project} allProjects={allProjects} />
      </div>
      <div className="mb-4">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("projects.detail.recentIssues")}
        </h3>
        <ul className="space-y-1">
          {recentIssues.slice(0, 5).map((i) => (
            <li key={i.id} className="text-sm flex items-center gap-2">
              <span className="text-ink-muted">·</span>
              <span className="flex-1 truncate">{i.title}</span>
              <span className="text-[10px] uppercase text-ink-soft">{i.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenFolder}
          className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
        >
          {t("projects.detail.openInExplorer")}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs px-3 py-1 bg-brand text-brand-fg rounded"
        >
          {t("projects.detail.edit")}
        </button>
        {project.archivedAt !== null ? (
          <button
            type="button"
            onClick={() => void useProjectsStore.getState().unarchive(project.id)}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.detail.unarchive")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void useProjectsStore.getState().archive(project.id)}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.detail.archive")}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="text-xs px-3 py-1 bg-semantic-danger text-white rounded ml-auto"
        >
          {t("projects.form.delete")}
        </button>
      </div>
    </div>
  );
};
