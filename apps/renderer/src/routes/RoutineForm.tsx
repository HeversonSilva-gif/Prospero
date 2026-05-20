import { useEffect, useRef, useState, type FC, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EventSpec, ScheduleSpec } from "@prospero/shared";
import { useRoutinesStore } from "../stores/routines.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { RecurrencePicker } from "../components/routines/RecurrencePicker.js";
import { EventPicker } from "../components/routines/EventPicker.js";
import { TargetAgentPicker } from "../components/routines/TargetAgentPicker.js";
import { RoutineHistory } from "../components/routines/RoutineHistory.js";

type TriggerType = "schedule" | "event";

const DEFAULT_SCHEDULE: ScheduleSpec = { freq: "daily", atMinute: 540 };
const DEFAULT_EVENT: EventSpec = { eventType: "goal_achieved" };

export const RoutineForm: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = id !== undefined;

  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const routines = useRoutinesStore((s) => s.routines);
  const load = useRoutinesStore((s) => s.load);
  const getById = useRoutinesStore((s) => s.getById);
  const createFn = useRoutinesStore((s) => s.create);
  const updateFn = useRoutinesStore((s) => s.update);
  const deleteFn = useRoutinesStore((s) => s.delete);
  const runNowFn = useRoutinesStore((s) => s.runNow);
  const loadAgents = useAgentsStore((s) => s.load);
  const agentsLoaded = useAgentsStore((s) => s.loaded);

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [triggerType, setTriggerType] = useState<TriggerType>("schedule");
  const [scheduleSpec, setScheduleSpec] = useState<ScheduleSpec>(DEFAULT_SCHEDULE);
  const [eventSpec, setEventSpec] = useState<EventSpec>(DEFAULT_EVENT);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<"idle" | "fired" | "error">("idle");

  const runStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (runStatusTimerRef.current !== null) {
        clearTimeout(runStatusTimerRef.current);
      }
    };
  }, []);

  // Load routines (for edit lookup) + agents.
  useEffect(() => {
    if (activeCompanyId === null) return;
    if (routines === null) void load(activeCompanyId);
    if (!agentsLoaded) void loadAgents(activeCompanyId);
  }, [activeCompanyId, routines, load, agentsLoaded, loadAgents]);

  // Pre-fill in edit mode.
  useEffect(() => {
    if (!isEdit || id === undefined) return;
    const existing = getById(id);
    if (existing === null) return;
    setName(existing.name);
    setEnabled(existing.enabled);
    setTriggerType(existing.triggerType);
    if (existing.scheduleSpec !== null) setScheduleSpec(existing.scheduleSpec);
    if (existing.eventSpec !== null) setEventSpec(existing.eventSpec);
    setTargetAgentId(existing.targetAgentId);
    setInstruction(existing.instruction);
  }, [isEdit, id, getById, routines]);

  if (activeCompanyId === null) {
    return <div className="p-6 text-sm text-ink-muted">…</div>;
  }

  if (isEdit && routines !== null && getById(id ?? "") === null) {
    return (
      <div className="p-6">
        <p className="text-sm text-semantic-danger mb-3">{t("routines.form.notFound")}</p>
        <Link to="/routines" className="text-xs text-brand hover:underline">
          ← {t("routines.form.back")}
        </Link>
      </div>
    );
  }

  const canSubmit =
    name.trim().length > 0 &&
    name.trim().length <= 120 &&
    targetAgentId !== null &&
    targetAgentId !== "" &&
    instruction.trim().length > 0 &&
    instruction.trim().length <= 4000;

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit || activeCompanyId === null || targetAgentId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && id !== undefined) {
        await updateFn({
          id,
          name: name.trim(),
          enabled,
          ...(triggerType === "schedule" ? { scheduleSpec } : { eventSpec }),
          targetAgentId,
          instruction: instruction.trim(),
        });
      } else {
        const baseInput = {
          companyId: activeCompanyId,
          name: name.trim(),
          enabled,
          triggerType,
          targetAgentId,
          instruction: instruction.trim(),
        };
        const payload =
          triggerType === "schedule" ? { ...baseInput, scheduleSpec } : { ...baseInput, eventSpec };
        await createFn(payload);
      }
      navigate("/routines");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!isEdit || id === undefined) return;
    const existing = getById(id);
    if (existing === null) return;
    if (!window.confirm(t("routines.form.deleteConfirm", { name: existing.name }))) return;
    try {
      await deleteFn(id);
      navigate("/routines");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunNow = async (): Promise<void> => {
    if (!isEdit || id === undefined) return;
    if (runStatusTimerRef.current !== null) {
      clearTimeout(runStatusTimerRef.current);
    }
    try {
      await runNowFn(id);
      setRunStatus("fired");
    } catch {
      setRunStatus("error");
    }
    runStatusTimerRef.current = setTimeout(() => setRunStatus("idle"), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-2 text-xs text-ink-muted mb-3">
        <Link to="/routines" className="hover:text-ink">
          ← {t("routines.title")}
        </Link>
        <span>/</span>
        <span className="text-ink">
          {isEdit ? t("routines.form.header.edit") : t("routines.form.header.new")}
        </span>
      </div>

      {error !== null && (
        <div className="mb-4 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger flex items-start justify-between gap-2">
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

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <div>
          <label htmlFor="routine-name" className="block text-xs font-semibold text-ink mb-1">
            {t("routines.form.name")}
          </label>
          <input
            id="routine-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full px-2 py-1.5 text-sm rounded border border-surface-border bg-surface-card"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            {t("routines.form.trigger")}
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={triggerType === "schedule"}
                onChange={() => setTriggerType("schedule")}
              />
              {t("routines.form.triggerSchedule")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={triggerType === "event"}
                onChange={() => setTriggerType("event")}
              />
              {t("routines.form.triggerEvent")}
            </label>
          </div>
        </div>

        {triggerType === "schedule" ? (
          <RecurrencePicker value={scheduleSpec} onChange={setScheduleSpec} />
        ) : (
          <EventPicker value={eventSpec} onChange={setEventSpec} />
        )}

        <TargetAgentPicker value={targetAgentId} onChange={setTargetAgentId} />

        <div>
          <label
            htmlFor="routine-instruction"
            className="block text-xs font-semibold text-ink mb-1"
          >
            {t("routines.form.instruction")}
          </label>
          <textarea
            id="routine-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={4000}
            rows={4}
            className="w-full px-2 py-1.5 text-sm rounded border border-surface-border bg-surface-card resize-y"
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-surface-border">
          <div className="flex items-center gap-2">
            {isEdit && (
              <>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="text-xs px-3 py-1.5 rounded text-semantic-danger hover:bg-semantic-danger-bg"
                >
                  {t("routines.form.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunNow()}
                  className="text-xs px-3 py-1.5 rounded bg-surface-soft text-ink hover:bg-surface-border inline-flex items-center gap-1.5"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 1.5 L8 5 L2 8.5 Z" />
                  </svg>
                  {t("routines.form.runNow")}
                </button>
                {runStatus === "fired" && (
                  <span className="text-xs text-semantic-success">
                    {t("routines.form.runNowFired")}
                  </span>
                )}
                {runStatus === "error" && (
                  <span className="text-xs text-semantic-danger">
                    {t("routines.form.runNowError")}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/routines")}
              className="text-xs px-3 py-1.5 rounded text-ink-muted hover:bg-surface-soft"
            >
              {t("routines.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white disabled:opacity-50"
            >
              {submitting
                ? t("routines.form.saving")
                : isEdit
                  ? t("routines.form.save")
                  : t("routines.form.create")}
            </button>
          </div>
        </div>
      </form>
      {isEdit && id !== undefined && activeCompanyId !== null && (
        <RoutineHistory routineId={id} companyId={activeCompanyId} />
      )}
    </div>
  );
};
