import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Issue } from "@prospero/shared";
import { useIssuesStore } from "../../stores/issues.js";

type Props = { subtasks: Issue[]; parentId: string; onAdd: () => void };

export const SubtaskList: FC<Props> = ({ subtasks, onAdd }) => {
  const { t } = useTranslation();
  const updateIssue = useIssuesStore((s) => s.update);
  return (
    <div className="space-y-1">
      {subtasks.map((sub) => {
        const done = sub.status === "done";
        return (
          <label key={sub.id} className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={done}
              onChange={() => void updateIssue({ id: sub.id, status: done ? "todo" : "done" })}
            />
            <span className={done ? "line-through text-ink-soft" : "text-brand-dark"}>
              {sub.title}
            </span>
            <span className="text-[10px] uppercase text-ink-soft ml-auto">{sub.status}</span>
          </label>
        );
      })}
      <button type="button" onClick={onAdd} className="text-xs text-brand hover:underline mt-1">
        {t("issues.detail.addSubtask")}
      </button>
    </div>
  );
};
