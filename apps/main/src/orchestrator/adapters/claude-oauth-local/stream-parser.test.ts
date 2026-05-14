import { describe, expect, it } from "vitest";
import { parseStreamLine } from "./stream-parser.js";

describe("parseStreamLine rate_limit_event", () => {
  it("returns rate-limited kind with retryAfter when present", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "rate_limit_event", retry_after: 30, message: "Cool down 30s" }),
    );
    expect(ev).toEqual({ kind: "rate-limited", retryAfterSec: 30, message: "Cool down 30s" });
  });

  it("returns rate-limited with retryAfterSec null when missing", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "rate_limit_event" }));
    expect(ev?.kind).toBe("rate-limited");
    if (ev?.kind === "rate-limited") {
      expect(ev.retryAfterSec).toBeNull();
      expect(ev.message).toContain("Rate limit");
    }
  });

  it("falls back to default message when missing", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "rate_limit_event", retry_after: 10 }));
    expect(ev?.kind).toBe("rate-limited");
    if (ev?.kind === "rate-limited") {
      expect(ev.retryAfterSec).toBe(10);
      expect(ev.message).toMatch(/Rate limit/);
    }
  });
});
