import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@prospero/shared";

type Props = {
  issue: Issue;
  assigneeName: string | null;
  onClick: () => void;
};

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Plain-language task card for the embedded project Kanban (M16). Emoji-free by
 * design — unlike the legacy IssueCard, it speaks in owner terms: who is on it,
 * whether it is waiting for an agent, or whether it needs the owner's sign-off.
 */
export const ProjectTaskCard: FC<Props> = ({ issue, assigneeName, onClick }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const review = issue.status === "review";
  const unassignedWaiting =
    assigneeName === null && (issue.status === "todo" || issue.status === "backlog");
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`rounded-lg border p-2.5 mb-1.5 cursor-pointer text-xs hover:ring-1 hover:ring-brand/40 ${
        review
          ? "border-semantic-warning/50 bg-semantic-warning/5"
          : "border-surface-border bg-surface-card"
      }`}
    >
      <div className="text-ink leading-snug line-clamp-3">{issue.title}</div>
      {assigneeName !== null && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="w-4 h-4 rounded-full bg-surface-soft text-ink-muted text-[8px] font-bold flex items-center justify-center shrink-0">
            {initials(assigneeName)}
          </span>
          <span className="text-[10px] text-ink-muted truncate">{assigneeName}</span>
        </div>
      )}
      {unassignedWaiting && (
        <div className="text-[10px] text-ink-soft italic mt-1.5">
          {t("projetos.detail.waitingAgent")}
        </div>
      )}
      {review && (
        <span className="inline-block text-[9px] font-bold text-semantic-warning bg-semantic-warning/15 rounded px-1.5 py-0.5 mt-2">
          {t("projetos.detail.needsReview")}
        </span>
      )}
    </div>
  );
};
