import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useIssuesStore } from "../../stores/issues.js";
import { useProjectsStore } from "../../stores/projects.js";
import { selectActiveIssues, countIssuesByProject } from "../../lib/dashboard/selectors.js";

export const ActiveIssuesWidget: FC = () => {
  const { t } = useTranslation();
  const issues = useIssuesStore((s) => s.issues);
  const projects = useProjectsStore((s) => s.projects);
  const active = selectActiveIssues(issues);
  const counts = countIssuesByProject(active);
  const projectsById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.activeIssues.title")}
        </h3>
        <Link to="/issues" className="text-xs text-brand hover:underline">
          {t("dashboard.activeIssues.viewAll")} →
        </Link>
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.activeIssues.empty")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{active.length}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {t("dashboard.activeIssues.subtitle")}
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {Object.entries(counts).map(([projectId, n]) => (
              <li key={projectId} className="flex justify-between">
                <span className="text-ink truncate">
                  {projectId === ""
                    ? t("dashboard.activeIssues.noProject")
                    : (projectsById.get(projectId) ?? projectId)}
                </span>
                <span className="text-ink-soft">{n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
