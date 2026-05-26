import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isAuthError,
  recoverAgent,
  setRespawnFn,
  setUserDataDir,
  __resetRecoveryState,
} from "./credential-recovery.js";

vi.mock("../orchestrator/lifecycle.js", () => ({
  getAdapter: vi.fn(),
  listAdapterAgentIds: vi.fn(() => []),
}));
vi.mock("../orchestrator/adapters/claude-oauth-local/prepare-sandbox.js", () => ({
  seedSandboxCredentials: vi.fn(() => true),
}));
vi.mock("./token-detect.js", () => ({
  detectClaudeCliToken: vi.fn(),
}));

import { getAdapter } from "../orchestrator/lifecycle.js";
import { seedSandboxCredentials } from "../orchestrator/adapters/claude-oauth-local/prepare-sandbox.js";
import { detectClaudeCliToken } from "./token-detect.js";

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

describe("recoverAgent — happy path", () => {
  beforeEach(() => {
    __resetRecoveryState();
    vi.clearAllMocks();
    setUserDataDir("/tmp/test-userdata");
  });

  it("returns recovered when pipeline succeeds", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    const respawnFn = vi.fn(() => Promise.resolve(null));
    setRespawnFn(respawnFn);

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("recovered");
    if (result.kind === "recovered") {
      expect(result.agentId).toBe("agent-1");
    }
    expect(seedSandboxCredentials).toHaveBeenCalled();
    expect(respawnFn).toHaveBeenCalledWith("agent-1");
  });

  it("returns skipped-not-running when agent has no adapter", async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);
    setRespawnFn(vi.fn());

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("skipped-not-running");
    expect(seedSandboxCredentials).not.toHaveBeenCalled();
  });

  it("returns skipped-not-running when adapter not alive", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => false, kill: vi.fn() } as never);
    setRespawnFn(vi.fn());

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("skipped-not-running");
  });
});
