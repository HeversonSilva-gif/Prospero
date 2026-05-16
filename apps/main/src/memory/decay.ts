// M11 PR-F1: decay math for memory importance.
//
// Memory importance fades on a 90-day half-life. The maintenance pass
// (maintenance.ts) calls these once per session with the real elapsed time
// since the previous pass, so the total decay over 90 calendar days is 0.5
// regardless of how many times the app was opened.

// Days for importance to halve with no access boost.
const HALF_LIFE_DAYS = 90;
// access_count is clamped here before it stretches the half-life — a memory
// accessed 20+ times gets a 3x longer half-life, and no more.
const ACCESS_CAP = 20;
const ACCESS_BOOST_PER_HIT = 0.1;

// Multiplicative decay applied to importance for `elapsedDays` of real time.
// Returns a value in (0, 1]. accessCount stretches the half-life so well-used
// memories fade slower.
export const decayFactor = (elapsedDays: number, accessCount: number): number => {
  if (elapsedDays <= 0) return 1;
  const boost = 1 + Math.min(Math.max(accessCount, 0), ACCESS_CAP) * ACCESS_BOOST_PER_HIT;
  return Math.pow(0.5, elapsedDays / (HALF_LIFE_DAYS * boost));
};

// The new importance after `elapsedDays`, clamped to [0, 1].
export const decayedImportance = (
  importance: number,
  accessCount: number,
  elapsedDays: number,
): number => {
  const next = importance * decayFactor(elapsedDays, accessCount);
  return Math.max(0, Math.min(1, next));
};
