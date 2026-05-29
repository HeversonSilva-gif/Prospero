import { describe, it, expect } from "vitest";
import { isAuthError, isAuthFailureStreamEvent } from "../../../auth/credential-recovery.js";

// Lightweight test: the real adapter is hard to instantiate cheaply (it spawns
// a child process). Instead, we test the contract between the stderr stream
// and isAuthError: any line we match here should trigger recovery in the
// adapter wiring.

describe("auto-recovery trigger contract", () => {
  it("isAuthError matches the exact lines from the v0.1.16 user report", () => {
    const screenshotLine1 =
      "Failed to authenticate. API Error: 401 The socket connection was closed unexpectedly. For more information, pass verbose: true in the second argument to fetch()";
    const screenshotLine2 =
      "Failed to authenticate. API Error: 401 Invalid authentication credentials";

    expect(isAuthError(screenshotLine1)).toBe(true);
    expect(isAuthError(screenshotLine2)).toBe(true);
  });

  it("noise lines do not trigger", () => {
    expect(isAuthError("[debug] startup ok")).toBe(false);
    expect(isAuthError("turn-complete usage={...}")).toBe(false);
  });

  // The adapter's stdout handler triggers recovery via isAuthFailureStreamEvent.
  // These are the JSON shapes the CLI actually emits on stdout for a 401 — the
  // stderr path above never sees them, which is why stdout wiring is required.
  it("isAuthFailureStreamEvent matches the stdout 401 events the adapter watches", () => {
    expect(
      isAuthFailureStreamEvent(
        '{"type":"system","subtype":"api_retry","attempt":1,"error_status":401,"error":"authentication_failed"}',
      ),
    ).toBe(true);
    expect(
      isAuthFailureStreamEvent(
        '{"type":"result","is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 Invalid authentication credentials"}',
      ),
    ).toBe(true);
  });
});
