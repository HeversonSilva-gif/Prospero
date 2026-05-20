import { useState, type FC, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Routine } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import {
  formatScheduleSummary,
  formatEventSummary,
  formatAtMinute,
  type TFunction,
} from "../../lib/routines/format-summary.js";

type Props = {
  routine: Routine;
  onToggle: () => Promise<void>;
  onRun: () => Promise<void>;
  onClick: () => void;
};

const formatRelative = (ts: number | null, neverLabel: string): string => {
  if (ts === null) return neverLabel;
  // For v1, plain HH:MM if today, else short date.
  const d = new Date(ts);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return formatAtMinute(d.getHours() * 60 + d.getMinutes());
  }
  return d.toLocaleDateString();
};

export const RoutineRow: FC<Props> = ({ routine, onToggle, onRun, onClick }) => {
  const { t: tRaw } = useTranslation();
  const t = tRaw as unknown as TFunction;
  const [runStatus, setRunStatus] = useState<"idle" | "fired" | "error">("idle");
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === routine.targetAgentId));

  const summary =
    routine.triggerType === "schedule" && routine.scheduleSpec !== null
      ? formatScheduleSummary(routine.scheduleSpec, t)
      : routine.eventSpec !== null
        ? formatEventSummary(routine.eventSpec, t)
        : "";

  const handleToggle = (e: MouseEvent): void => {
    e.stopPropagation();
    void onToggle();
  };

  const handleRun = (e: MouseEvent): void => {
    e.stopPropagation();
    void (async () => {
      try {
        await onRun();
        setRunStatus("fired");
      } catch {
        setRunStatus("error");
      }
      setTimeout(() => setRunStatus("idle"), 2000);
    })();
  };

  const subLineParts: string[] = [summary];
  if (agent !== undefined) subLineParts.push(agent.name);
  if (routine.triggerType === "schedule") {
    if (routine.enabled && routine.nextFireAt !== null) {
      subLineParts.push(
        t("routines.row.nextFire", { when: formatRelative(routine.nextFireAt, "—") }),
      );
    } else if (!routine.enabled) {
      subLineParts.push(t("routines.row.paused"));
    }
    subLineParts.push(
      t("routines.row.lastFired", {
        when: formatRelative(routine.lastFiredAt, t("routines.row.neverFired")),
      }),
    );
  } else {
    subLineParts.push(
      t("routines.row.lastFired", {
        when: formatRelative(routine.lastFiredAt, t("routines.row.neverFired")),
      }),
    );
    if (!routine.enabled) subLineParts.push(t("routines.row.paused"));
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`w-full text-left p-3 border-b border-surface-border hover:bg-surface-soft transition-colors cursor-pointer ${
        routine.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-label={routine.enabled ? "disable" : "enable"}
          className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
            routine.enabled
              ? "bg-semantic-success border-semantic-success"
              : "bg-transparent border-ink-soft"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{routine.name}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {runStatus === "fired" && (
            <span className="text-xs text-semantic-success">{t("routines.form.runNowFired")}</span>
          )}
          {runStatus === "error" && (
            <span className="text-xs text-semantic-danger">{t("routines.form.runNowError")}</span>
          )}
          <button
            type="button"
            onClick={handleRun}
            className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-soft text-ink hover:bg-surface-border inline-flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
              <path d="M2 1.5 L8 5 L2 8.5 Z" />
            </svg>
            {t("routines.form.runNow")}
          </button>
        </div>
      </div>
      <div className="ml-6 mt-0.5 text-xs text-ink-muted truncate">{subLineParts.join(" · ")}</div>
    </div>
  );
};
