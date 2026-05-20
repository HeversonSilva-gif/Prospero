import { describe, it, expect } from "vitest";
import { computeNextFire } from "./recurrence.js";

// Helper: construct a local-time Date from y/m/d/h/mi explicitly.
const local = (y: number, m: number, d: number, h: number, mi: number): Date =>
  new Date(y, m, d, h, mi, 0, 0);

describe("computeNextFire — daily", () => {
  it("returns today's slot if it is strictly after `after`", () => {
    const after = local(2026, 5, 18, 8, 0); // 08:00 local
    const next = computeNextFire({ freq: "daily", atMinute: 540 /* 09:00 */ }, after);
    expect(next.toString()).toBe(local(2026, 5, 18, 9, 0).toString());
  });

  it("rolls to next day when today's slot has passed", () => {
    const after = local(2026, 5, 18, 10, 0);
    const next = computeNextFire({ freq: "daily", atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 19, 9, 0).toString());
  });

  it("rolls to next day when exactly equal (strictly after)", () => {
    const after = local(2026, 5, 18, 9, 0);
    const next = computeNextFire({ freq: "daily", atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 19, 9, 0).toString());
  });
});

describe("computeNextFire — weekly", () => {
  // Monday May 18, 2026 -> weekday=1
  it("returns today's slot when today matches and slot is in future", () => {
    const after = local(2026, 4, 18, 8, 0);
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 4, 18, 9, 0).toString());
  });

  it("rolls to same weekday next week when today's slot has passed", () => {
    const after = local(2026, 4, 18, 10, 0);
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 4, 25, 9, 0).toString());
  });

  it("rolls forward to a later weekday in the same week", () => {
    const after = local(2026, 4, 18, 10, 0); // Monday
    // weekday 3 (Wed) — 2 days ahead
    const next = computeNextFire({ freq: "weekly", weekday: 3, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 4, 20, 9, 0).toString());
  });

  it("rolls to weekday earlier in the calendar via next week", () => {
    const after = local(2026, 4, 22, 10, 0); // Fri (weekday 5)
    const next = computeNextFire({ freq: "weekly", weekday: 1, atMinute: 540 }, after);
    // next Monday is May 25
    expect(next.toString()).toBe(local(2026, 4, 25, 9, 0).toString());
  });
});

describe("computeNextFire — monthly", () => {
  it("returns this month's slot when it is still in the future", () => {
    const after = local(2026, 5, 10, 8, 0);
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 5, 15, 9, 0).toString());
  });

  it("rolls to next month when this month's slot has passed", () => {
    const after = local(2026, 5, 20, 8, 0);
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2026, 6, 15, 9, 0).toString());
  });

  it("rolls year-end correctly", () => {
    const after = local(2026, 11, 20, 8, 0); // Dec 20
    const next = computeNextFire({ freq: "monthly", day: 15, atMinute: 540 }, after);
    expect(next.toString()).toBe(local(2027, 0, 15, 9, 0).toString());
  });
});

describe("computeNextFire — interval", () => {
  it("returns `after + everyMinutes`", () => {
    const after = local(2026, 5, 18, 9, 0);
    const next = computeNextFire({ freq: "interval", everyMinutes: 30 }, after);
    expect(next.getTime() - after.getTime()).toBe(30 * 60_000);
  });

  it("works for 1-minute intervals", () => {
    const after = new Date(1_000_000);
    const next = computeNextFire({ freq: "interval", everyMinutes: 1 }, after);
    expect(next.getTime() - after.getTime()).toBe(60_000);
  });
});
