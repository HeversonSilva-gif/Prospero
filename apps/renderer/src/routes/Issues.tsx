import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Issue, IssueStatus, IssuePriority } from "@prospero/shared";
import { useIssuesStore } from "../stores/issues.js";
import { useProjectsStore } from "../stores/projects.js";
import { useAgentsStore } from "../stores/agents.js";
import { KanbanColumn } from "../components/issues/KanbanColumn.js";
import { IssueCard } from "../components/issues/IssueCard.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";
import { IssueDetailModal } from "../components/issues/IssueDetailModal.js";

const COLUMNS: IssueStatus[] = ["backlog", "todo", "doing", "review", "done"];

export const Issues: FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const issues = useIssuesStore((s) => s.issues);
  const load = useIssuesStore((s) => s.load);
  const updateIssue = useIssuesStore((s) => s.update);
  const optimisticStatus = useIssuesStore((s) => s.optimisticStatus);
  const replaceIssue = useIssuesStore((s) => s.replace);
  const removeIssue = useIssuesStore((s) => s.remove);
  const upsertIssue = useIssuesStore((s) => s.upsert);
  const projects = useProjectsStore((s) => s.projects);
  const agents = useAgentsStore((s) => s.agents);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterProject, setFilterProject] = useState<string>("");
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<IssuePriority | "">("");

  const selectedIssueId = searchParams.get("selected");

  useEffect(() => {
    void (async () => {
      const cs = await window.prospero.companies.list();
      if (cs.length > 0) {
        setCompanyId(cs[0]!.id);
        void load(cs[0]!.id);
      }
    })();
  }, [load]);

  useEffect(() => {
    // Targeted refresh: avoid replacing the whole array on every change. The
    // full reload was wiping dnd-kit's transient state mid-drag and causing
    // visible jank. Fetching just the changed issue keeps array references
    // stable so React re-renders only the affected card.
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

  const filtered = useMemo(
    () =>
      issues.filter(
        (i) =>
          (filterProject === "" || i.projectId === filterProject) &&
          (filterAssignee === "" || i.assigneeId === filterAssignee) &&
          (filterPriority === "" || i.priority === filterPriority),
      ),
    [issues, filterProject, filterAssignee, filterPriority],
  );

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (typeof overId !== "string" || typeof activeId !== "string") return;
    if (!COLUMNS.includes(overId as IssueStatus)) return;
    const issue = issues.find((i) => i.id === activeId);
    if (issue === undefined || issue.status === overId) return;
    optimisticStatus(activeId, overId as IssueStatus);
    void updateIssue({ id: activeId, status: overId as IssueStatus });
  };

  const byStatus: Record<IssueStatus, Issue[]> = {
    backlog: [],
    todo: [],
    doing: [],
    review: [],
    done: [],
    cancelled: [],
  };
  for (const i of filtered) byStatus[i.status].push(i);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-brand-dark">{t("issues.title")}</h1>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold"
        >
          {t("issues.newButton")}
        </button>
      </div>

      <div className="flex gap-3 mb-3 text-xs">
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="px-2 py-1 border border-surface-border rounded"
        >
          <option value="">
            {t("issues.filters.project")}: {t("issues.filters.all")}
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="px-2 py-1 border border-surface-border rounded"
        >
          <option value="">
            {t("issues.filters.assignee")}: {t("issues.filters.all")}
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as IssuePriority | "")}
          className="px-2 py-1 border border-surface-border rounded"
        >
          <option value="">
            {t("issues.filters.priority")}: {t("issues.filters.all")}
          </option>
          <option value="urgent">urgent</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 flex-1 overflow-auto">
          {COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              label={t(`issues.columns.${status}`)}
              itemIds={byStatus[status].map((i) => i.id)}
            >
              {byStatus[status].map((i) => (
                <IssueCard
                  key={i.id}
                  issue={i}
                  projectColor={projectMap.get(i.projectId ?? "")?.color ?? "#94a3b8"}
                  assigneeName={agentMap.get(i.assigneeId ?? "")?.name ?? null}
                  onClick={() => {
                    setSearchParams({ selected: i.id });
                  }}
                />
              ))}
            </KanbanColumn>
          ))}
        </div>
      </DndContext>

      {showForm && companyId !== null && (
        <IssueFormModal companyId={companyId} onClose={() => setShowForm(false)} />
      )}
      {selectedIssueId !== null && (
        <IssueDetailModal
          issueId={selectedIssueId}
          onClose={() => {
            searchParams.delete("selected");
            setSearchParams(searchParams);
          }}
        />
      )}
    </div>
  );
};
