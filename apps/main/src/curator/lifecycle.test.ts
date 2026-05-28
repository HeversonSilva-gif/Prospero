import { describe, it, expect } from "vitest";
import { nextLifecycleState, STALE_DAYS, ARCHIVE_DAYS } from "./lifecycle.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;

describe("nextLifecycleState", () => {
  it("active when used within STALE_DAYS", () => {
    expect(nextLifecycleState(NOW - (STALE_DAYS - 1) * DAY, NOW)).toBe("active");
  });
  it("stale at exactly STALE_DAYS", () => {
    expect(nextLifecycleState(NOW - STALE_DAYS * DAY, NOW)).toBe("stale");
  });
  it("stale between STALE_DAYS and ARCHIVE_DAYS", () => {
    expect(nextLifecycleState(NOW - (ARCHIVE_DAYS - 1) * DAY, NOW)).toBe("stale");
  });
  it("archived at exactly ARCHIVE_DAYS", () => {
    expect(nextLifecycleState(NOW - ARCHIVE_DAYS * DAY, NOW)).toBe("archived");
  });
});
