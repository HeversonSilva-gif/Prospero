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
});
