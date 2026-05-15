import { describe, expect, it } from "vitest";
import { pickAdapterForHire } from "./hire-adapter.js";

describe("pickAdapterForHire", () => {
  it("defaults to claude-oauth-local for local + oauth", () => {
    expect(pickAdapterForHire("local", "oauth")).toBe("claude-oauth-local");
  });

  it("uses claude-api-key-local for local + api-key", () => {
    expect(pickAdapterForHire("local", "api-key")).toBe("claude-api-key-local");
  });

  it("uses claude-oauth-local when location is undefined + oauth", () => {
    expect(pickAdapterForHire(undefined, "oauth")).toBe("claude-oauth-local");
  });

  it("forces claude-oauth-remote-docker for remote, ignoring api-key auth", () => {
    expect(pickAdapterForHire("remote", "api-key")).toBe("claude-oauth-remote-docker");
    expect(pickAdapterForHire("remote", "oauth")).toBe("claude-oauth-remote-docker");
  });
});
