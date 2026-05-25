import { describe, expect, it } from "vitest";
import { parseStreamLine } from "./stream-parser.js";

describe("parseStreamLine rate_limit_event", () => {
  // rate_limit_event is informational telemetry from Claude Code (it reports the
  // account's rate-limit status, not a block) and claude handles real limits
  // itself — so the parser ignores it instead of pausing the agent. Treating it
  // as a fatal pause (M9) wrongly froze agents whose account was fine.
  it("ignores rate_limit_event (does not emit a fatal rate-limited event)", () => {
    const withRetry = parseStreamLine(
      JSON.stringify({ type: "rate_limit_event", retry_after: 30, message: "Cool down 30s" }),
    );
    expect(withRetry?.kind).not.toBe("rate-limited");
    expect(withRetry?.kind).toBe("unknown");

    const bare = parseStreamLine(JSON.stringify({ type: "rate_limit_event" }));
    expect(bare?.kind).toBe("unknown");
  });

  it("ignores rate_limit_event when status is allowed", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", resetsAt: 1779400800, rateLimitType: "five_hour" },
      }),
    );
    expect(ev?.kind).not.toBe("rate-limited");
  });

  it("emits rate-limited when status is not allowed, carrying resetsAt in ms", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt: 1779400800, rateLimitType: "five_hour" },
      }),
    );
    expect(ev?.kind).toBe("rate-limited");
    if (ev?.kind !== "rate-limited") return;
    expect(ev.resetsAt).toBe(1779400800 * 1000);
    expect(ev.message).toBe("five_hour");
  });

  it("also accepts snake_case fields (reset_at / rate_limit_type)", () => {
    // The real wire shape isn't pinned down and the rest of the stream is
    // snake_case — the parser must fire either way, not silently no-op.
    const ev = parseStreamLine(
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", reset_at: 1779400800, rate_limit_type: "five_hour" },
      }),
    );
    expect(ev?.kind).toBe("rate-limited");
    if (ev?.kind !== "rate-limited") return;
    expect(ev.resetsAt).toBe(1779400800 * 1000);
    expect(ev.message).toBe("five_hour");
  });
});
