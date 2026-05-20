import { useState, type FC, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityEventRow } from "@prospero/shared";
import { LoadingState } from "../ui/LoadingState.js";
import { RoutineHistoryRow } from "./RoutineHistoryRow.js";

type Props = {
  routineId: string;
  companyId: string;
};

export const RoutineHistory: FC<Props> = ({ routineId, companyId }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<ActivityEventRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rows = await window.prospero.activity.query({
        companyId,
        filters: { entityKind: "routine", entityId: routineId },
        limit: 20,
      });
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && events === null) {
      void load();
    }
  };

  const handleHeaderKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const refresh = (e: MouseEvent): void => {
    e.stopPropagation();
    void load();
  };

  const headerTitle =
    events !== null
      ? `${t("routines.history.title")} (${String(events.length)})`
      : t("routines.history.title");

  return (
    <section className="mt-6 border-t border-surface-border pt-4">
      {/* Header is a div with role=button to avoid nested-button HTML invalidity
          (the refresh control inside must remain a real <button>). */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleHeaderKey}
        aria-expanded={expanded}
        aria-label={expanded ? t("routines.history.collapse") : t("routines.history.expand")}
        className="w-full flex items-center gap-2 text-left text-xs font-semibold text-ink hover:text-brand cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 2 L7 5 L3 8" />
        </svg>
        <span className="flex-1">{headerTitle}</span>
        {expanded && events !== null && (
          <button
            type="button"
            onClick={refresh}
            aria-label={t("routines.history.refresh")}
            className="text-ink-muted hover:text-ink p-1 rounded"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 4 A4 4 0 1 0 10 8" />
              <path d="M10 1 L10 4 L7 4" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3">
          {error !== null && (
            <div className="mb-2 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger flex items-start justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss"
                className="text-semantic-danger hover:text-ink"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2 2 L8 8 M8 2 L2 8" />
                </svg>
              </button>
            </div>
          )}

          {loading && events === null && <LoadingState />}

          {!loading && events !== null && events.length === 0 && (
            <p className="text-xs text-ink-muted px-3 py-4 text-center">
              {t("routines.history.empty")}
            </p>
          )}

          {events !== null && events.length > 0 && (
            <div className="border border-surface-border rounded bg-surface-card">
              {events.map((e) => (
                <RoutineHistoryRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
