import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@prospero/shared";
import { useProjectsStore } from "../stores/projects.js";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
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
  const loadIssues = useIssuesStore((s) => s.load);
  const replaceIssue = useIssuesStore((s) => s.replace);
  const removeIssue = useIssuesStore((s) => s.remove);
  const upsertIssue = useIssuesStore((s) => s.upsert);

  const companyId = useActiveCompanyId();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = showArchived ? projects : projects.filter((p) => p.archivedAt === null);

  useEffect(() => {
    if (companyId === null) return;
    void load(companyId);
    void loadIssues(companyId);
  }, [companyId, load, loadIssues]);

  useEffect(() => {
    if (companyId === null) return;
    const interval = setInterval(() => void refreshPaths(companyId), 30_000);
    return () => clearInterval(interval);
  }, [companyId, refreshPaths]);

  // Keep the embedded Kanban live: agents move tasks across columns in the
  // background, so mirror the targeted-refresh subscription used by /issues.
  useEffect(() => {
    const off = window.prospero.issues.onChanged((ev) => {
      if (companyId === null || ev.companyId !== companyId) return;
      if (ev.kind === "deleted") {
        removeIssue(ev.issueId);
        return;
      }
      void (async () => {
        const detail = await window.prospero.issues.get(ev.issueId);
        if (detail === null) return;
        if (ev.kind === "created") {
          upsertIssue(detail.issue);
        } else {
          replaceIssue(detail.issue);
        }
      })();
    });
    return off;
  }, [companyId, removeIssue, replaceIssue, upsertIssue]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const countsByProject = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const i of allIssues) {
      if (i.projectId === null || i.status === "cancelled") continue;
      const c = m.get(i.projectId) ?? { done: 0, total: 0 };
      c.total += 1;
      if (i.status === "done") c.done += 1;
      m.set(i.projectId, c);
    }
    return m;
  }, [allIssues]);

  const projectIssues = useMemo(
    () => allIssues.filter((i) => i.projectId === selected?.id),
    [allIssues, selected?.id],
  );

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-6 border-b border-surface-border bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{t("projetos.title")}</h1>
            <p className="mt-1 text-sm text-ink-soft">{t("projetos.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90 whitespace-nowrap"
          >
            {t("projetos.novoProjeto")}
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <div className="w-64 border-r border-surface-border p-3 flex flex-col">
          <div className="flex-1 overflow-auto">
            {projects.length === 0 ? (
              <p className="text-xs text-ink-muted px-2">{t("projects.empty")}</p>
            ) : (
              <div className="space-y-1">
                {visible.map((p) => (
                  <ProjectListItem
                    key={p.id}
                    project={p}
                    pathStatus={pathStatuses[p.id]}
                    selected={selectedId === p.id}
                    counts={countsByProject.get(p.id) ?? null}
                    onClick={() => select(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-1 text-xs text-ink-muted mt-2 px-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("projects.list.showArchived")}
          </label>
        </div>
        <div className="flex-1 min-w-0 flex">
          {selected !== null && companyId !== null && (
            <ProjectDetail
              project={selected}
              pathStatus={pathStatuses[selected.id]}
              agents={agents}
              allProjects={projects}
              projectIssues={projectIssues}
              companyId={companyId}
              onEdit={() => {
                setEditing(selected);
                setShowForm(true);
              }}
              onDelete={() => setConfirmingDelete(selected)}
              onOpenFolder={() => void window.prospero.projects.openFolder(selected.id)}
            />
          )}
        </div>
        {showForm && companyId !== null && (
          <ProjectFormModal
            {...(editing !== null ? { initial: editing } : {})}
            onClose={() => setShowForm(false)}
            onSubmit={async ({ name, path, color, icon }) => {
              if (editing !== null) {
                await updateProj({ id: editing.id, name, path, color });
                await useProjectsStore.getState().setIcon(editing.id, icon);
              } else {
                const created = await createProj({ companyId, name, path, color });
                if (icon !== null) await useProjectsStore.getState().setIcon(created.id, icon);
              }
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
    </div>
  );
};
