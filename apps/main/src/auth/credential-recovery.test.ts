import { describe, it, expect } from "vitest";
import { isAuthError } from "./credential-recovery.js";

describe("isAuthError", () => {
  it("matches 'Invalid authentication credentials'", () => {
    expect(
      isAuthError("Failed to authenticate. API Error: 401 Invalid authentication credentials"),
    ).toBe(true);
  });

  it("matches 'socket connection was closed unexpectedly' with 401", () => {
    expect(
      isAuthError(
        "Failed to authenticate. API Error: 401 The socket connection was closed unexpectedly. For more information, pass verbose: true in the second argument to fetch()",
      ),
    ).toBe(true);
  });

  it("matches lowercase 'unauthorized'", () => {
    expect(isAuthError("HTTP 401 unauthorized")).toBe(true);
  });

  it("does not match unrelated 401 strings", () => {
    expect(isAuthError("status 200 OK")).toBe(false);
    expect(isAuthError("Error: file not found")).toBe(false);
    expect(isAuthError("")).toBe(false);
  });

  it("is case-insensitive on the auth keywords", () => {
    expect(isAuthError("INVALID AUTHENTICATION CREDENTIALS")).toBe(true);
  });
});
