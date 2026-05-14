import { describe, expect, it } from "vitest";
import { daysUntil, isExpiringSoon, EXPIRY_WARN_DAYS } from "./oauth-expiry.js";

const ONE_DAY = 24 * 60 * 60 * 1000;

describe("daysUntil", () => {
  it("returns ceil of days remaining", () => {
    const now = 1_700_000_000_000;
    expect(daysUntil(now + 5.5 * ONE_DAY, now)).toBe(6);
  });

  it("returns 0 for already expired", () => {
    const now = 1_700_000_000_000;
    expect(daysUntil(now - 1, now)).toBe(0);
  });

  it("returns null for null input", () => {
    expect(daysUntil(null, 0)).toBeNull();
  });
});

describe("isExpiringSoon", () => {
  it("true when within EXPIRY_WARN_DAYS", () => {
    const now = 1_700_000_000_000;
    expect(isExpiringSoon(now + 5 * ONE_DAY, now)).toBe(true);
  });

  it("false when beyond EXPIRY_WARN_DAYS", () => {
    const now = 1_700_000_000_000;
    expect(isExpiringSoon(now + (EXPIRY_WARN_DAYS + 5) * ONE_DAY, now)).toBe(false);
  });

  it("false when null", () => {
    expect(isExpiringSoon(null, 0)).toBe(false);
  });
});
