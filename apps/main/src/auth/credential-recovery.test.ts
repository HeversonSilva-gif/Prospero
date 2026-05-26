import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("recoverAgent — error paths", () => {
  beforeEach(() => {
    __resetRecoveryState();
    vi.clearAllMocks();
    setUserDataDir("/tmp/test-userdata");
  });

  it("returns host-stale when host file missing", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue(null);
    setRespawnFn(() => Promise.resolve(null));

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result).toEqual({ kind: "host-stale", agentId: "agent-1", reason: "no-host-file" });
    expect(seedSandboxCredentials).not.toHaveBeenCalled();
  });

  it("returns failed when seedSandboxCredentials returns false", async () => {
    const killSpy = vi.fn();
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: killSpy } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(false);
    setRespawnFn(() => Promise.resolve(null));

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toBe("reseed-failed");
    expect(killSpy).toHaveBeenCalled();
  });

  it("returns failed when respawnFn throws", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => Promise.reject(new Error("spawn ENOENT")));

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toContain("respawn-failed");
    if (result.kind === "failed") expect(result.reason).toContain("spawn ENOENT");
  });

  it("returns failed when respawnFn not set", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    // setRespawnFn NOT called — left null after __resetRecoveryState()

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toBe("respawn-fn-not-set");
  });

  it("returns failed when userDataDir not set", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => Promise.resolve(null));
    // Override the beforeEach setUserDataDir by re-calling __resetRecoveryState
    __resetRecoveryState();
    setRespawnFn(() => Promise.resolve(null));

    const result = await recoverAgent("agent-1", { reason: "user-reconnect" });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toBe("user-data-dir-not-set");
  });
});

describe("recoverAgent — lock + cooldown + timeout", () => {
  beforeEach(() => {
    __resetRecoveryState();
    vi.clearAllMocks();
    setUserDataDir("/tmp/test-userdata");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("second call while first is in flight returns skipped-recovering", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => new Promise((resolve) => setTimeout(() => resolve(null), 5000)));

    const p1 = recoverAgent("agent-1", { reason: "user-reconnect" });
    const p2 = recoverAgent("agent-1", { reason: "auto-401" });

    const r2 = await p2;
    expect(r2.kind).toBe("skipped-recovering");

    await vi.advanceTimersByTimeAsync(5000);
    const r1 = await p1;
    expect(r1.kind).toBe("recovered");
  });

  it("call within cooldown after success returns skipped-cooldown", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => Promise.resolve(null));

    const r1 = await recoverAgent("agent-1", { reason: "user-reconnect" });
    expect(r1.kind).toBe("recovered");

    vi.setSystemTime(Date.now() + 5000);
    const r2 = await recoverAgent("agent-1", { reason: "auto-401" });
    expect(r2.kind).toBe("skipped-cooldown");
  });

  it("call after cooldown elapses runs again", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => Promise.resolve(null));

    const r1 = await recoverAgent("agent-1", { reason: "user-reconnect" });
    expect(r1.kind).toBe("recovered");

    vi.setSystemTime(Date.now() + 20000);
    const r2 = await recoverAgent("agent-1", { reason: "auto-401" });
    expect(r2.kind).toBe("recovered");
  });

  it("respawnFn that hangs past 30s times out and returns failed", async () => {
    vi.mocked(getAdapter).mockReturnValue({ isAlive: () => true, kill: vi.fn() } as never);
    vi.mocked(detectClaudeCliToken).mockReturnValue({ token: "sk-ant-oat-abc", expiresAt: null });
    vi.mocked(seedSandboxCredentials).mockReturnValue(true);
    setRespawnFn(() => new Promise(() => {})); // never resolves

    const p = recoverAgent("agent-1", { reason: "user-reconnect" });
    await vi.advanceTimersByTimeAsync(30_001);

    const result = await p;
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toBe("timeout");
  });
});
