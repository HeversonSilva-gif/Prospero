import type { FC } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@dashboard-agent/shared";

type Props = {
  issue: Issue;
  projectColor: string;
  assigneeName: string | null;
  onClick: () => void;
};

const PRIORITY_BADGE: Record<string, { label: string; cls: string }> = {
  urgent: { label: "🔴 URGENT", cls: "text-semantic-danger" },
  high: { label: "⬆ HIGH", cls: "text-semantic-warning" },
  medium: { label: "", cls: "" },
  low: { label: "", cls: "" },
};

export const IssueCard: FC<Props> = ({ issue, projectColor, assigneeName, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const badge = PRIORITY_BADGE[issue.priority];
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-surface-card border border-surface-border rounded p-2 mb-2 cursor-pointer hover:ring-1 hover:ring-brand/40 text-xs"
    >
      <div className="flex items-start gap-2">
        <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: projectColor }} />
        <span className="font-medium text-brand-dark line-clamp-2 flex-1">
          {issue.identifier !== null && (
            <span className="font-mono text-[10px] text-ink-soft mr-1">{issue.identifier}</span>
          )}
          {issue.title}
        </span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-ink-muted">
        <span>👤 {assigneeName ?? "—"}</span>
        {badge !== undefined && badge.label !== "" && (
          <span className={badge.cls}>{badge.label}</span>
        )}
      </div>
    </div>
  );
};
