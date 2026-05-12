import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { IssueArtifact } from "@dashboard-agent/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { useAgentsStore } from "../../stores/agents.js";
import { IssueCommentsList } from "./IssueCommentsList.js";
import { CommentComposer } from "./CommentComposer.js";
import { SubtaskList } from "./SubtaskList.js";
import { ToolCallHistoryAccordion } from "./ToolCallHistoryAccordion.js";
import { ReassignDropdown } from "./ReassignDropdown.js";
import { IssueFormModal } from "./IssueFormModal.js";
import { ConfirmModal } from "../ConfirmModal.js";

type Props = { issueId: string; onClose: () => void };

export const IssueDetailModal: FC<Props> = ({ issueId, onClose }) => {
  const { t } = useTranslation();
  const detail = useIssuesStore((s) => s.detail);
  const loadDetail = useIssuesStore((s) => s.loadDetail);
  const clearDetail = useIssuesStore((s) => s.clearDetail);
  const addComment = useIssuesStore((s) => s.addComment);
  const deleteIssue = useIssuesStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [artifacts, setArtifacts] = useState<IssueArtifact[]>([]);

  useEffect(() => {
    void loadDetail(issueId);
    void window.dashboardAgent.issues.listArtifacts(issueId).then(setArtifacts);
    return () => clearDetail();
  }, [issueId, loadDetail, clearDetail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  if (detail === null || detail.issue.id !== issueId) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <p className="text-ink-muted">Loading…</p>
      </div>
    );
  }

  const { issue, comments, subtasks, toolHistory, project } = detail;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-card rounded p-6 w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase bg-surface-soft px-2 py-0.5 rounded font-semibold">
              {issue.status}
            </span>
            <span className="text-[10px] uppercase text-ink-muted">{issue.priority}</span>
          </div>
          <button type="button" onClick={onClose} className="text-ink-soft hover:text-brand">
            ×
          </button>
        </div>
        {issue.identifier !== null && (
          <div className="text-xs font-mono text-ink-soft mb-1">{issue.identifier}</div>
        )}
        <h2 className="text-lg font-bold text-brand-dark mb-3">{issue.title}</h2>
        {issue.description !== null && (
          <p className="text-sm text-ink-muted mb-4 whitespace-pre-wrap">{issue.description}</p>
        )}
        <div className="grid grid-cols-2 gap-4 text-xs mb-4">
          <div>
            <span className="text-ink-soft uppercase text-[10px]">Project</span>
            <br />
            {project !== null ? (
              <>
                <span
                  className="w-2 h-2 inline-block rounded-full mr-1"
                  style={{ background: project.color }}
                />
                {project.name}
              </>
            ) : (
              "—"
            )}
          </div>
          <div>
            <span className="text-ink-soft uppercase text-[10px]">Assignee</span>
            <br />
            {issue.assigneeId !== null
              ? `👤 ${agentMap.get(issue.assigneeId)?.name ?? "Agent"}`
              : "—"}
          </div>
        </div>

        {subtasks.length > 0 && (
          <div className="mb-4">
            <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
              {t("issues.detail.subtasks")} ({subtasks.length})
            </h3>
            <SubtaskList
              subtasks={subtasks}
              parentId={issue.id}
              onAdd={() => setShowSubtaskForm(true)}
            />
          </div>
        )}

        <div className="mb-4">
          <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
            {t("issues.detail.comments")} ({comments.length})
          </h3>
          <IssueCommentsList comments={comments} agentMap={agentMap} />
          <CommentComposer onSubmit={async (content) => addComment(issue.id, content)} />
        </div>

        <ToolCallHistoryAccordion history={toolHistory} />

        <details className="border-t border-surface-border mt-4 pt-3">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
            {t("issues.detail.artifacts.title")} ({artifacts.length})
          </summary>
          {artifacts.length === 0 ? (
            <p className="text-xs text-ink-soft mt-2">{t("issues.detail.artifacts.empty")}</p>
          ) : (
            <ul className="space-y-2 mt-2">
              {artifacts.map((a) => (
                <li
                  key={a.id}
                  className="text-xs flex flex-col gap-0.5 px-2 py-1.5 rounded bg-surface-soft"
                >
                  <span className="font-semibold text-ink">
                    {t(`issues.detail.artifacts.kind.${a.kind}`)}
                  </span>
                  <span className="font-mono text-ink-soft break-all">{a.ref}</span>
                  {a.contentPreview !== null && (
                    <span className="text-ink-soft truncate">{a.contentPreview}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>

        <div className="flex gap-2 mt-4">
          <ReassignDropdown
            issueId={issue.id}
            currentAssigneeId={issue.assigneeId}
            agents={agents}
          />
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-xs px-3 py-1 bg-semantic-danger text-white rounded ml-auto"
          >
            {t("issues.detail.delete")}
          </button>
        </div>

        {showSubtaskForm && (
          <IssueFormModal
            companyId={issue.companyId}
            parentId={issue.id}
            onClose={() => {
              setShowSubtaskForm(false);
              void loadDetail(issue.id);
            }}
          />
        )}
        {confirmingDelete && (
          <ConfirmModal
            title={issue.title}
            message={t("issues.detail.confirmDelete")}
            confirmLabel={t("common.delete")}
            destructive
            onConfirm={async () => {
              await deleteIssue(issue.id);
              setConfirmingDelete(false);
              onClose();
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </div>
  );
};
