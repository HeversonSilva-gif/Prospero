import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityEventRow } from "@prospero/shared";
import { formatRelative } from "../../lib/routines/format-summary.js";

type Props = {
  event: ActivityEventRow;
};

const KNOWN_REASONS = new Set([
  "scheduled",
  "catchup",
  "event",
  "manual",
  "agent_unavailable",
  "budget_paused",
]);

export const RoutineHistoryRow: FC<Props> = ({ event }) => {
  const { t } = useTranslation();
  const isFired = event.action === "routine.fired";
  const rawReason = typeof event.payload["reason"] === "string" ? event.payload["reason"] : "";
  const reasonLabel = KNOWN_REASONS.has(rawReason)
    ? t(`routines.history.reason.${rawReason}`)
    : rawReason;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-surface-border last:border-b-0">
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          isFired ? "bg-semantic-success" : "bg-ink-soft"
        }`}
        aria-hidden="true"
      />
      <span className="text-xs text-ink-muted tabular-nums flex-shrink-0">
        {formatRelative(event.createdAt, "—")}
      </span>
      <span className="text-xs text-ink flex-1 truncate">
        {isFired ? t("routines.history.status.fired") : t("routines.history.status.skipped")}
      </span>
      {reasonLabel !== "" && (
        <span className="text-[10px] uppercase tracking-wide bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded flex-shrink-0">
          {reasonLabel}
        </span>
      )}
    </div>
  );
};
