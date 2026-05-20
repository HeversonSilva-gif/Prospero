import { describe, it, expect } from "vitest";
import {
  formatScheduleSummary,
  formatEventSummary,
  parseAtMinute,
  formatAtMinute,
} from "./format-summary.js";

// Fake t() returns the key + params for inspection.
const t = (key: string, params?: Record<string, string | number>): string => {
  if (params === undefined) return key;
  const pairs = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return `${key}{${pairs}}`;
};

describe("formatScheduleSummary", () => {
  it("daily → routines.summary.daily with time", () => {
    expect(formatScheduleSummary({ freq: "daily", atMinute: 540 }, t)).toBe(
      "routines.summary.daily{time=09:00}",
    );
  });

  it("weekly → routines.summary.weekly with weekday name and time", () => {
    expect(formatScheduleSummary({ freq: "weekly", weekday: 1, atMinute: 540 }, t)).toBe(
      "routines.summary.weekly{weekday=routines.weekday.1,time=09:00}",
    );
  });

  it("monthly → routines.summary.monthly with day and time", () => {
    expect(formatScheduleSummary({ freq: "monthly", day: 15, atMinute: 540 }, t)).toBe(
      "routines.summary.monthly{day=15,time=09:00}",
    );
  });

  it("interval → routines.summary.interval with minutes", () => {
    expect(formatScheduleSummary({ freq: "interval", everyMinutes: 30 }, t)).toBe(
      "routines.summary.interval{minutes=30}",
    );
  });
});

describe("formatEventSummary", () => {
  it("goal_achieved → routines.summary.event with event label", () => {
    expect(formatEventSummary({ eventType: "goal_achieved" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.goal_achieved}",
    );
  });

  it("verification_failed → label key", () => {
    expect(formatEventSummary({ eventType: "verification_failed" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.verification_failed}",
    );
  });

  it("issue_done → label key", () => {
    expect(formatEventSummary({ eventType: "issue_done" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.issue_done}",
    );
  });

  it("agent_recovered → label key", () => {
    expect(formatEventSummary({ eventType: "agent_recovered" }, t)).toBe(
      "routines.summary.event{event=routines.form.events.agent_recovered}",
    );
  });
});

describe("parseAtMinute", () => {
  it("'09:00' → 540", () => {
    expect(parseAtMinute("09:00")).toBe(540);
  });
  it("'23:59' → 1439", () => {
    expect(parseAtMinute("23:59")).toBe(1439);
  });
  it("'00:00' → 0", () => {
    expect(parseAtMinute("00:00")).toBe(0);
  });
  it("malformed → 0", () => {
    expect(parseAtMinute("")).toBe(0);
    expect(parseAtMinute("nope")).toBe(0);
  });
});

describe("formatAtMinute", () => {
  it("540 → '09:00'", () => {
    expect(formatAtMinute(540)).toBe("09:00");
  });
  it("0 → '00:00'", () => {
    expect(formatAtMinute(0)).toBe("00:00");
  });
  it("1439 → '23:59'", () => {
    expect(formatAtMinute(1439)).toBe("23:59");
  });
  it("zero-pads hour and minute", () => {
    expect(formatAtMinute(65)).toBe("01:05");
  });
});
