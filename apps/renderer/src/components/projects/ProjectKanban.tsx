import { useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Agent, Issue, IssueStatus, Project } from "@prospero/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { KanbanColumn } from "../issues/KanbanColumn.js";
import { IssueFormModal } from "../issues/IssueFormModal.js";
import { IssueDetailModal } from "../issues/IssueDetailModal.js";
import { ProjectTaskCard } from "./ProjectTaskCard.js";

type Props = {
  project: Project;
  issues: Issue[];
  agents: Agent[];
  companyId: string;
};

// Four owner-facing columns. "A fazer" absorbs backlog so no task is hidden;
// dropping anything there normalizes its status to "todo".
const COLUMNS: IssueStatus[] = ["todo", "doing", "review", "done"];

const columnOf = (status: IssueStatus): IssueStatus | null => {
  if (status === "backlog" || status === "todo") return "todo";
  if (status === "doing") return "doing";
  if (status === "review") return "review";
  if (status === "done") return "done";
  return null; // cancelled — not shown on the board
};

export const ProjectKanban: FC<Props> = ({ project, issues, agents, companyId }) => {
  const { t } = useTranslation();
  const updateIssue = useIssuesStore((s) => s.update);
  const optimisticStatus = useIssuesStore((s) => s.optimisticStatus);

  const [showForm, setShowForm] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const agentName = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  const byColumn = useMemo(() => {
    const groups: Record<IssueStatus, Issue[]> = {
      backlog: [],
      todo: [],
      doing: [],
      review: [],
      done: [],
      cancelled: [],
    };
    for (const i of issues) {
      const col = columnOf(i.status);
      if (col !== null) groups[col].push(i);
    }
    return groups;
  }, [issues]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (typeof overId !== "string" || typeof activeId !== "string") return;
    if (!COLUMNS.includes(overId as IssueStatus)) return;
    const issue = issues.find((i) => i.id === activeId);
    if (issue === undefined || columnOf(issue.status) === overId) return;
    optimisticStatus(activeId, overId as IssueStatus);
    void updateIssue({ id: activeId, status: overId as IssueStatus });
  };

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 flex-1 min-h-0 overflow-x-auto p-4">
          {COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              label={t(`projetos.detail.columns.${status}`)}
              itemIds={byColumn[status].map((i) => i.id)}
            >
              {byColumn[status].map((i) => (
                <ProjectTaskCard
                  key={i.id}
                  issue={i}
                  assigneeName={agentName.get(i.assigneeId ?? "") ?? null}
                  onClick={() => setSelectedIssueId(i.id)}
                />
              ))}
              {status === "todo" && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-surface-border-strong text-[11px] font-semibold text-ink-soft hover:text-brand hover:border-brand py-2 mt-1"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t("projetos.detail.addTask")}
                </button>
              )}
            </KanbanColumn>
          ))}
        </div>
      </DndContext>

      {showForm && (
        <IssueFormModal
          companyId={companyId}
          defaultProjectId={project.id}
          onClose={() => setShowForm(false)}
        />
      )}
      {selectedIssueId !== null && (
        <IssueDetailModal issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />
      )}
    </>
  );
};
