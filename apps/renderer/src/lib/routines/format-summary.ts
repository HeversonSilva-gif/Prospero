import type { EventSpec, RoutineEventType, ScheduleSpec } from "@prospero/shared";

// M15 PR-B — pure formatters used by RoutineRow and elsewhere.
// `t` is the i18next-style translator: callers inject it so the module stays
// renderer-pure (no react-i18next coupling).

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

export const formatAtMinute = (atMinute: number): string => {
  const h = Math.floor(atMinute / 60);
  const m = atMinute % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `${hh}:${mm}`;
};

export const parseAtMinute = (value: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
};

export const formatScheduleSummary = (spec: ScheduleSpec, t: TFunction): string => {
  if (spec.freq === "interval") {
    return t("routines.summary.interval", { minutes: spec.everyMinutes });
  }
  if (spec.freq === "daily") {
    return t("routines.summary.daily", { time: formatAtMinute(spec.atMinute) });
  }
  if (spec.freq === "weekly") {
    return t("routines.summary.weekly", {
      weekday: t(`routines.weekday.${String(spec.weekday)}`),
      time: formatAtMinute(spec.atMinute),
    });
  }
  if (spec.freq === "monthly") {
    return t("routines.summary.monthly", {
      day: spec.day,
      time: formatAtMinute(spec.atMinute),
    });
  }
  const _exhaustive: never = spec;
  return _exhaustive;
};

export const formatEventSummary = (spec: EventSpec, t: TFunction): string => {
  return t("routines.summary.event", {
    event: t(eventLabelKey(spec.eventType)),
  });
};

const eventLabelKey = (eventType: RoutineEventType): string => {
  return `routines.form.events.${eventType}`;
};
