import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project, Agent, Issue, ProjectPathStatus } from "@prospero/shared";
import { AgentAccessSection } from "./AgentAccessSection.js";
import { ProjectKanban } from "./ProjectKanban.js";
import { useProjectsStore } from "../../stores/projects.js";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  agents: Agent[];
  allProjects: Project[];
  projectIssues: Issue[];
  companyId: string;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
};

export const ProjectDetail: FC<Props> = ({
  project,
  pathStatus,
  agents,
  allProjects,
  projectIssues,
  companyId,
  onEdit,
  onDelete,
  onOpenFolder,
}) => {
  const { t } = useTranslation();
  const missing = pathStatus === "missing";
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-5 py-4 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color }} />
          <h2 className="text-lg font-bold text-ink truncate">{project.name}</h2>
          {missing && (
            <span className="text-[10px] bg-semantic-danger text-white px-2 py-0.5 rounded">
              {t("projects.detail.pathMissing")}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenFolder}
              className="text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
            >
              {t("projects.detail.openInExplorer")}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
            >
              {t("projects.detail.edit")}
            </button>
            {project.archivedAt !== null ? (
              <button
                type="button"
                onClick={() => void useProjectsStore.getState().unarchive(project.id)}
                className="text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
              >
                {t("projects.detail.unarchive")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void useProjectsStore.getState().archive(project.id)}
                className="text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
              >
                {t("projects.detail.archive")}
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="text-xs px-2.5 py-1 text-semantic-danger rounded hover:bg-semantic-danger-bg"
            >
              {t("projects.form.delete")}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2 text-xs text-ink-muted bg-surface-soft border border-surface-border rounded-md px-2 py-1 w-fit max-w-full">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span className="font-medium">{t("projetos.detail.folder")}:</span>
          <span className="font-mono truncate">{project.path}</span>
        </div>

        <div className="mt-3">
          <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-1.5">
            {t("projects.detail.agentsWithAccess")}
          </h3>
          <AgentAccessSection agents={agents} project={project} allProjects={allProjects} />
        </div>
      </div>

      <ProjectKanban
        project={project}
        issues={projectIssues}
        agents={agents}
        companyId={companyId}
      />
    </div>
  );
};
