import { describe, it, expect } from "vitest";
import { isInQuietHours } from "./quiet-hours.js";
import type { QuietHoursSchedule } from "@prospero/shared";

const at = (year: number, m: number, d: number, h: number, min = 0): Date =>
  new Date(year, m - 1, d, h, min, 0, 0);

describe("isInQuietHours", () => {
  it("returns false when schedule is empty", () => {
    const s: QuietHoursSchedule = { windows: [] };
    expect(isInQuietHours(at(2026, 5, 27, 23, 0), s)).toBe(false);
  });

  it("returns true inside a normal window (start < end)", () => {
    const s: QuietHoursSchedule = {
      windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 }],
    };
    expect(isInQuietHours(at(2026, 5, 27, 12, 0), s)).toBe(true);
    expect(isInQuietHours(at(2026, 5, 27, 8, 59), s)).toBe(false);
    expect(isInQuietHours(at(2026, 5, 27, 17, 0), s)).toBe(false);
  });

  it("handles a wrap-past-midnight window (start > end)", () => {
    const s: QuietHoursSchedule = {
      windows: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 22 * 60, endMinute: 8 * 60 }],
    };
    expect(isInQuietHours(at(2026, 5, 27, 23, 30), s)).toBe(true);
    expect(isInQuietHours(at(2026, 5, 28, 3, 0), s)).toBe(true);
    expect(isInQuietHours(at(2026, 5, 28, 7, 59), s)).toBe(true);
    expect(isInQuietHours(at(2026, 5, 28, 8, 0), s)).toBe(false);
  });

  it("skips a window whose day-of-week does not match", () => {
    const s: QuietHoursSchedule = {
      windows: [{ daysOfWeek: [1], startMinute: 0, endMinute: 24 * 60 - 1 }],
    };
    expect(isInQuietHours(at(2026, 5, 27, 12, 0), s)).toBe(false);
  });

  it("returns true if any of several windows matches", () => {
    const s: QuietHoursSchedule = {
      windows: [
        { daysOfWeek: [1], startMinute: 9 * 60, endMinute: 12 * 60 },
        { daysOfWeek: [3], startMinute: 14 * 60, endMinute: 16 * 60 },
      ],
    };
    expect(isInQuietHours(at(2026, 5, 27, 15, 0), s)).toBe(true);
  });

  it("treats an empty window (start === end) as inactive", () => {
    const s: QuietHoursSchedule = {
      windows: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 12 * 60, endMinute: 12 * 60 }],
    };
    expect(isInQuietHours(at(2026, 5, 27, 12, 0), s)).toBe(false);
  });

  it("respects boundary minutes 0:00 and 23:59", () => {
    const s: QuietHoursSchedule = {
      windows: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 23 * 60 + 59 }],
    };
    expect(isInQuietHours(at(2026, 5, 27, 0, 0), s)).toBe(true);
    expect(isInQuietHours(at(2026, 5, 27, 23, 58), s)).toBe(true);
  });
});
