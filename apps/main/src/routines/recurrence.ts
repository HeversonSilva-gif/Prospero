import type { ScheduleSpec } from "@prospero/shared";

// M15 PR-A — `computeNextFire` returns the next occurrence STRICTLY after
// `after`, in the host's local timezone. Local TZ is intentional: a "9am
// standup" follows the user, not UTC. DST gymnastics: we treat `atMinute`
// as "minutes since midnight in local wall-clock time"; on DST transition
// days the slot can be off by an hour, which is acceptable for v1 (every
// other slot afterwards is correct again).

export const computeNextFire = (spec: ScheduleSpec, after: Date): Date => {
  if (spec.freq === "interval") {
    return new Date(after.getTime() + spec.everyMinutes * 60_000);
  }

  if (spec.freq === "daily") {
    const candidate = withLocalTimeOfDay(after, spec.atMinute);
    if (candidate.getTime() > after.getTime()) return candidate;
    return addDays(candidate, 1);
  }

  if (spec.freq === "weekly") {
    const candidate = withLocalTimeOfDay(after, spec.atMinute);
    const dowDelta = (spec.weekday - candidate.getDay() + 7) % 7;
    const sameDay = dowDelta === 0;
    const sameDayInFuture = sameDay && candidate.getTime() > after.getTime();
    if (sameDayInFuture) return candidate;
    if (sameDay) return addDays(candidate, 7);
    return addDays(candidate, dowDelta);
  }

  // monthly
  const candidate = withLocalDayAndTime(after, spec.day, spec.atMinute);
  if (candidate.getTime() > after.getTime()) return candidate;
  return addMonths(candidate, 1);
};

const withLocalTimeOfDay = (anchor: Date, atMinute: number): Date => {
  const h = Math.floor(atMinute / 60);
  const mi = atMinute % 60;
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), h, mi, 0, 0);
};

const withLocalDayAndTime = (anchor: Date, day: number, atMinute: number): Date => {
  const h = Math.floor(atMinute / 60);
  const mi = atMinute % 60;
  return new Date(anchor.getFullYear(), anchor.getMonth(), day, h, mi, 0, 0);
};

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);

const addMonths = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
