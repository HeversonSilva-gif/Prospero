import type { FC, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { IssueStatus } from "@dashboard-agent/shared";

type Props = {
  status: IssueStatus;
  label: string;
  itemIds: string[];
  children: ReactNode;
};

export const KanbanColumn: FC<Props> = ({ status, label, itemIds, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[180px] rounded p-2 ${isOver ? "bg-brand-bg" : "bg-surface-soft"}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-2">
        {label} · {itemIds.length}
      </div>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
};
