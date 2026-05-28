import type { SkillLifecycleState } from "@prospero/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

// A skill unused this long becomes `stale` (still in L0, with a one-time
// inbox warning); unused this long becomes `archived` (drops out of L0).
export const STALE_DAYS = 30;
export const ARCHIVE_DAYS = 90;

// Pure: where a skill belongs given the wall-clock gap since it was last touched
// (last_used ?? created_at). Boundaries are inclusive of the threshold.
export const nextLifecycleState = (lastTouched: number, now: number): SkillLifecycleState => {
  const elapsedDays = (now - lastTouched) / DAY_MS;
  if (elapsedDays < STALE_DAYS) return "active";
  if (elapsedDays < ARCHIVE_DAYS) return "stale";
  return "archived";
};
