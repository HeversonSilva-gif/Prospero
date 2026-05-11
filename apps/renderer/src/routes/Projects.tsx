import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@dashboard-agent/shared";
import { useProjectsStore } from "../stores/projects.js";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { ProjectListItem } from "../components/projects/ProjectListItem.js";
import { ProjectDetail } from "../components/projects/ProjectDetail.js";
import { ProjectFormModal } from "../components/projects/ProjectFormModal.js";
import { ConfirmModal } from "../components/ConfirmModal.js";

export const Projects: FC = () => {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const pathStatuses = useProjectsStore((s) => s.pathStatuses);
  const selectedId = useProjectsStore((s) => s.selectedId);
  const select = useProjectsStore((s) => s.select);
  const load = useProjectsStore((s) => s.load);
  const refreshPaths = useProjectsStore((s) => s.refreshPaths);
  const createProj = useProjectsStore((s) => s.create);
  const updateProj = useProjectsStore((s) => s.update);
  const deleteProj = useProjectsStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);
  const allIssues = useIssuesStore((s) => s.issues);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Project | null>(null);

  useEffect(() => {
    void (async () => {
      const cs = await window.dashboardAgent.companies.list();
      if (cs.length > 0) {
        setCompanyId(cs[0]!.id);
        void load(cs[0]!.id);
      }
    })();
  }, [load]);

  useEffect(() => {
    if (companyId === null) return;
    const interval = setInterval(() => void refreshPaths(companyId), 30_000);
    return () => clearInterval(interval);
  }, [companyId, refreshPaths]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const projectIssues = useMemo(
    () => allIssues.filter((i) => i.projectId === selected?.id),
    [allIssues, selected?.id],
  );
  const doingCount = projectIssues.filter((i) => i.status === "doing").length;
  const recentIssues = projectIssues
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-surface-border p-3 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-brand-dark">{t("projects.title")}</h2>
        </div>
        <div className="flex-1 overflow-auto">
          {projects.length === 0 ? (
            <p className="text-xs text-ink-muted px-2">{t("projects.empty")}</p>
          ) : (
            <div className="space-y-1">
              {projects.map((p) => (
                <ProjectListItem
                  key={p.id}
                  project={p}
                  pathStatus={pathStatuses[p.id]}
                  selected={selectedId === p.id}
                  onClick={() => select(p.id)}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="text-xs px-3 py-2 bg-brand text-white rounded font-semibold mt-2"
        >
          {t("projects.newButton")}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {selected !== null && (
          <ProjectDetail
            project={selected}
            pathStatus={pathStatuses[selected.id]}
            agents={agents}
            allProjects={projects}
            recentIssues={recentIssues}
            doingCount={doingCount}
            onEdit={() => {
              setEditing(selected);
              setShowForm(true);
            }}
            onDelete={() => setConfirmingDelete(selected)}
            onOpenFolder={() => void window.dashboardAgent.projects.openFolder(selected.id)}
          />
        )}
      </div>
      {showForm && companyId !== null && (
        <ProjectFormModal
          {...(editing !== null ? { initial: editing } : {})}
          onClose={() => setShowForm(false)}
          onSubmit={async (data) => {
            if (editing !== null) await updateProj({ id: editing.id, ...data });
            else await createProj({ companyId, ...data });
          }}
        />
      )}
      {confirmingDelete !== null && (
        <ConfirmModal
          title={confirmingDelete.name}
          message={t("projects.form.confirmDelete")}
          confirmLabel={t("common.delete")}
          destructive
          onConfirm={async () => {
            await deleteProj(confirmingDelete.id);
            setConfirmingDelete(null);
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
};
