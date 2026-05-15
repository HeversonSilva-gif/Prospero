import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityEventRow, ActorKind } from "@prospero/shared";
import { renderDescription, ENTITY_IS_NAVIGABLE, type Lookups } from "./activityRender.js";
import { useRelativeTime } from "../../hooks/useRelativeTime.js";

const DOT_COLOR: Record<ActorKind, string> = {
  user: "bg-brand",
  agent: "bg-semantic-success",
  system: "bg-ink-soft",
};

interface Props {
  row: ActivityEventRow;
  lookups: Lookups;
  isNew: boolean;
  onNavigate: (row: ActivityEventRow) => void;
}

export const ActivityRow: FC<Props> = ({ row, lookups, isNew, onNavigate }) => {
  const { t } = useTranslation();
  const description = renderDescription(row, t, lookups);
  const time = useRelativeTime(row.createdAt);
  const navigable = ENTITY_IS_NAVIGABLE[row.entityKind];

  const isDeleted = row.entityKind === "agent" && !lookups.agentsById.has(row.entityId);
  const disabled = !navigable || isDeleted;
  const cursor = disabled ? "cursor-default" : "cursor-pointer hover:bg-surface-soft";

  return (
    <li
      className={`${cursor} flex items-start gap-3 px-3 py-2 border-b border-surface-border ${
        isNew ? "activity-row-enter" : ""
      }`}
      onClick={() => {
        if (!disabled) onNavigate(row);
      }}
    >
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${DOT_COLOR[row.actorKind]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink truncate">
          {description}
          {isDeleted && <span className="ml-1 text-ink-soft text-xs">{t("activity.deleted")}</span>}
        </p>
        <p className="text-[10px] text-ink-soft">
          {time} · {row.action}
        </p>
      </div>
    </li>
  );
};
