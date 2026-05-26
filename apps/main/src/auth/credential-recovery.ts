import { getAdapter, listAdapterAgentIds } from "../orchestrator/lifecycle.js";
import { seedSandboxCredentials } from "../orchestrator/adapters/claude-oauth-local/prepare-sandbox.js";
import { getAgentConfigDir } from "../orchestrator/util/paths.js";
import { detectClaudeCliToken } from "./token-detect.js";
import type { RecoveryReason, RecoveryResult, RecoveryStatusEvent } from "@prospero/shared";

const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /invalid\s+authentication\s+credentials/i,
  /401[^\d].*socket.*closed/i,
  /401[^\d].*unauthorized/i,
  /401\s+unauthorized/i,
];

export const isAuthError = (line: string): boolean => {
  if (line === "") return false;
  for (const pattern of AUTH_ERROR_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
};

// Injected at orchestrator init (apps/main/src/orchestrator/index.ts). Tests set
// these directly via the setters below. Keeping them as module-level state keeps
// the recovery pipeline a pure function of its inputs (no electron `app` import here
// — preserves testability).
type RespawnFn = (agentId: string) => Promise<unknown>;
type BroadcastFn = (event: RecoveryStatusEvent) => void;
let respawnFn: RespawnFn | null = null;
let userDataDir: string | null = null;
let broadcastFn: BroadcastFn | null = null;

const LOCK_TIMEOUT_MS = 30_000;
const COOLDOWN_MS = 15_000;

const inFlight = new Map<string, Promise<RecoveryResult>>();
const lastSuccessAt = new Map<string, number>();

export const setRespawnFn = (fn: RespawnFn): void => {
  respawnFn = fn;
};

export const setUserDataDir = (dir: string): void => {
  userDataDir = dir;
};

export const setRecoveryBroadcastFn = (fn: BroadcastFn): void => {
  broadcastFn = fn;
};

const broadcast = (event: RecoveryStatusEvent): void => {
  if (broadcastFn !== null) broadcastFn(event);
};

export const __resetRecoveryState = (): void => {
  respawnFn = null;
  userDataDir = null;
  broadcastFn = null;
  inFlight.clear();
  lastSuccessAt.clear();
};

export const recoverAgent = async (
  agentId: string,
  opts: { reason: RecoveryReason },
): Promise<RecoveryResult> => {
  const existing = inFlight.get(agentId);
  if (existing !== undefined) {
    return { kind: "skipped-recovering", agentId };
  }

  const lastSuccess = lastSuccessAt.get(agentId);
  if (lastSuccess !== undefined && Date.now() - lastSuccess < COOLDOWN_MS) {
    return { kind: "skipped-cooldown", agentId };
  }

  const promise = withTimeout(() => runPipeline(agentId, opts), agentId);
  inFlight.set(agentId, promise);
  try {
    const result = await promise;
    if (result.kind === "recovered") {
      lastSuccessAt.set(agentId, Date.now());
    }
    return result;
  } finally {
    inFlight.delete(agentId);
  }
};

export const recoverAllRunning = async (): Promise<RecoveryResult[]> => {
  const ids = listAdapterAgentIds();
  return Promise.all(ids.map((id) => recoverAgent(id, { reason: "user-reconnect" })));
};

const runPipeline = async (
  agentId: string,
  _opts: { reason: RecoveryReason },
): Promise<RecoveryResult> => {
  const startMs = Date.now();

  const adapter = getAdapter(agentId);
  if (adapter === undefined || !adapter.isAlive()) {
    // Silent — no broadcast on skipped-* (caller still sees the result).
    return { kind: "skipped-not-running", agentId };
  }

  broadcast({ agentId, phase: "started" });

  const detected = detectClaudeCliToken();
  if (detected === null) {
    broadcast({ agentId, phase: "host-stale", reason: "no-host-file" });
    return { kind: "host-stale", agentId, reason: "no-host-file" };
  }

  if (userDataDir === null) {
    broadcast({ agentId, phase: "failed", reason: "user-data-dir-not-set" });
    return { kind: "failed", agentId, reason: "user-data-dir-not-set" };
  }
  if (respawnFn === null) {
    broadcast({ agentId, phase: "failed", reason: "respawn-fn-not-set" });
    return { kind: "failed", agentId, reason: "respawn-fn-not-set" };
  }

  adapter.kill();

  const agentConfigDir = getAgentConfigDir(userDataDir, agentId);
  const reseedOk = seedSandboxCredentials(agentConfigDir);
  if (reseedOk === false) {
    broadcast({ agentId, phase: "failed", reason: "reseed-failed" });
    return { kind: "failed", agentId, reason: "reseed-failed" };
  }

  try {
    await respawnFn(agentId);
  } catch (e) {
    const reason = `respawn-failed: ${e instanceof Error ? e.message : String(e)}`;
    broadcast({ agentId, phase: "failed", reason });
    return {
      kind: "failed",
      agentId,
      reason,
    };
  }

  broadcast({ agentId, phase: "recovered" });
  return { kind: "recovered", agentId, durationMs: Date.now() - startMs };
};

const withTimeout = (
  fn: () => Promise<RecoveryResult>,
  agentId: string,
): Promise<RecoveryResult> => {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      broadcast({ agentId, phase: "failed", reason: "timeout" });
      resolve({ kind: "failed", agentId, reason: "timeout" });
    }, LOCK_TIMEOUT_MS);

    void fn().then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });
  });
};
