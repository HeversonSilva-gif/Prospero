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

  // Bug observed in v0.1.21 production: Claude CLI emits status="allowed_warning"
  // when the account is approaching its weekly cap but is still allowed to make
  // calls. Pre-fix, the parser treated everything-not-equal-to-"allowed" as a
  // throttle, so the team paused itself prematurely with 23% of the weekly cap
  // still unused. Any status whose name signals the call is still allowed must
  // be benign — use a prefix check so future variants (allowed_caution,
  // allowed_strict, ...) are forward-compatible.
  it("ignores rate_limit_event when status is allowed_warning (approaching cap but still allowed)", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          resetsAt: 1779400800,
          rateLimitType: "weekly",
        },
      }),
    );
    expect(ev?.kind).not.toBe("rate-limited");
  });

  it("ignores any status starting with allowed (forward-compat for new warning variants)", () => {
    for (const status of ["allowed", "allowed_warning", "allowed_caution", "allowed_strict"]) {
      const ev = parseStreamLine(
        JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: { status, resetsAt: 1779400800 },
        }),
      );
      expect(ev?.kind).not.toBe("rate-limited");
    }
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
