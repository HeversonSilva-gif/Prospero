import { describe, expect, it } from "vitest";
import { periodKey, utcMonthBounds } from "./period.js";

describe("periodKey", () => {
  it("formats a daily key as YYYY-MM-DD in UTC", () => {
    expect(periodKey("daily", new Date(Date.UTC(2026, 4, 18, 23, 59)))).toBe("2026-05-18");
  });
  it("formats a monthly key as YYYY-MM in UTC", () => {
    expect(periodKey("monthly", new Date(Date.UTC(2026, 4, 1)))).toBe("2026-05");
  });
  it("zero-pads single-digit months and days", () => {
    expect(periodKey("daily", new Date(Date.UTC(2026, 0, 3)))).toBe("2026-01-03");
  });
});

describe("utcMonthBounds", () => {
  it("returns the first of the month to the first of the next month", () => {
    const { start, end } = utcMonthBounds(new Date(Date.UTC(2026, 4, 18)));
    expect(start).toBe(Date.UTC(2026, 4, 1));
    expect(end).toBe(Date.UTC(2026, 5, 1));
  });
  it("rolls the year over in December", () => {
    const { start, end } = utcMonthBounds(new Date(Date.UTC(2026, 11, 31)));
    expect(start).toBe(Date.UTC(2026, 11, 1));
    expect(end).toBe(Date.UTC(2027, 0, 1));
  });
});
