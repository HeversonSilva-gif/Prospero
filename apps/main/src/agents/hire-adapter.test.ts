import { describe, expect, it } from "vitest";
import { pickAdapterForHire } from "./hire-adapter.js";

describe("pickAdapterForHire", () => {
  it("defaults to claude-oauth-local for local + oauth", () => {
    expect(pickAdapterForHire("local", "oauth")).toBe("claude-oauth-local");
  });

  it("uses claude-api-key-local for local + api-key (non-CEO)", () => {
    expect(pickAdapterForHire("local", "api-key")).toBe("claude-api-key-local");
  });

  it("uses claude-api-key-local for local + api-key when isCeo is not set", () => {
    expect(pickAdapterForHire("local", "api-key", {})).toBe("claude-api-key-local");
  });

  it("uses claude-oauth-local when location is undefined + oauth", () => {
    expect(pickAdapterForHire(undefined, "oauth")).toBe("claude-oauth-local");
  });

  it("forces claude-oauth-remote-docker for remote, ignoring api-key auth", () => {
    expect(pickAdapterForHire("remote", "api-key")).toBe("claude-oauth-remote-docker");
    expect(pickAdapterForHire("remote", "oauth")).toBe("claude-oauth-remote-docker");
  });

  // CEO-aware routing
  it("CEO + api-key → claude-api-direct", () => {
    expect(pickAdapterForHire("local", "api-key", { isCeo: true })).toBe("claude-api-direct");
  });

  it("CEO + api-key + undefined location → claude-api-direct", () => {
    expect(pickAdapterForHire(undefined, "api-key", { isCeo: true })).toBe("claude-api-direct");
  });

  it("CEO + oauth → claude-oauth-local (CEO flag has no effect in oauth mode)", () => {
    expect(pickAdapterForHire("local", "oauth", { isCeo: true })).toBe("claude-oauth-local");
  });

  it("remote + api-key + isCeo → claude-oauth-remote-docker (remote always wins)", () => {
    expect(pickAdapterForHire("remote", "api-key", { isCeo: true })).toBe(
      "claude-oauth-remote-docker",
    );
  });

  it("worker (isCeo false) + api-key → claude-api-key-local", () => {
    expect(pickAdapterForHire("local", "api-key", { isCeo: false })).toBe("claude-api-key-local");
  });
});
