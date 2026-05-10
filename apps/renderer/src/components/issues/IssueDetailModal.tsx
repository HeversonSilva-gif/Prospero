import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useIssuesStore } from "../../stores/issues.js";
import { useAgentsStore } from "../../stores/agents.js";
import { IssueCommentsList } from "./IssueCommentsList.js";
import { CommentComposer } from "./CommentComposer.js";
import { SubtaskList } from "./SubtaskList.js";
import { ToolCallHistoryAccordion } from "./ToolCallHistoryAccordion.js";
import { ReassignDropdown } from "./ReassignDropdown.js";
import { IssueFormModal } from "./IssueFormModal.js";

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

  useEffect(() => {
    void loadDetail(issueId);
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

        <div className="flex gap-2 mt-4">
          <ReassignDropdown
            issueId={issue.id}
            currentAssigneeId={issue.assigneeId}
            agents={agents}
          />
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("issues.detail.confirmDelete"))) {
                void deleteIssue(issue.id);
                onClose();
              }
            }}
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
      </div>
    </div>
  );
};
