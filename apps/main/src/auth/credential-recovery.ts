import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

// File-based diagnostic log. Mirrors the adapter's dlog so credential-recovery
// activity lands in the same `prospero-debug.log` that we ask users to share
// when token-rotation issues recur. Pre-fix, the entire recovery pipeline ran
// silently — broadcasts went to IPC but never to disk, so a missed recovery
// (Bug A from Task 0 of v0.2 piece #6) was invisible in `git grep` against
// the user's log. This instrumentation is the precondition for diagnosing
// Bug A on the next occurrence.
const dlog = (msg: string): void => {
  if (userDataDir === null) return;
  const path = resolve(userDataDir, "prospero-debug.log");
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] [auth:recover] ${msg}\n`, "utf8");
  } catch {
    /* log writes are best-effort */
  }
};

export const isAuthError = (line: string): boolean => {
  if (line === "") return false;
  for (const pattern of AUTH_ERROR_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
};

// The Claude CLI (stream-json mode used by the local adapter) surfaces auth
// failures as structured JSON events on STDOUT, not as plaintext on stderr:
//   {"type":"system","subtype":"api_retry",...,"error_status":401,"error":"authentication_failed"}
//   {"type":"result",...,"is_error":true,"api_error_status":401,"result":"...401 Invalid authentication credentials"}
// The stderr-only `isAuthError` trigger therefore NEVER fired in production —
// auto-recovery was effectively dead (0 `auth:recover` entries despite repeated
// 401s in the wild). This detector watches the stdout stream. Detection is
// SCOPED to the CLI's own system/result event types so an agent that merely
// prints "authentication_failed" in its own assistant output can't trigger a
// spurious kill+respawn. Only 401 counts as auth — transient 502/server_error
// retries must NOT trigger recovery.
export const isAuthFailureStreamEvent = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed[0] !== "{") return false;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (data === null || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  const type = o["type"];

  // api_retry — the earliest signal, emitted on the first failed attempt.
  if (type === "system" && o["subtype"] === "api_retry") {
    if (o["error"] === "authentication_failed") return true;
    if (o["error_status"] === 401) return true;
    return false;
  }

  // result — the terminal turn outcome carrying the auth failure.
  if (type === "result") {
    if (o["api_error_status"] === 401) return true;
    const result = o["result"];
    if (typeof result === "string" && isAuthError(result)) return true;
    return false;
  }

  return false;
};

// Injected at orchestrator init (apps/main/src/orchestrator/index.ts). Tests set
// these directly via the setters below. Keeping them as module-level state keeps
// the recovery pipeline a pure function of its inputs (no electron `app` import here
// — preserves testability).
type RespawnFn = (agentId: string) => Promise<unknown>;
type BroadcastFn = (event: RecoveryStatusEvent) => void;
type PauseFn = (agentId: string, reason: string) => void;
let respawnFn: RespawnFn | null = null;
let userDataDir: string | null = null;
let broadcastFn: BroadcastFn | null = null;
let pauseFn: PauseFn | null = null;

const LOCK_TIMEOUT_MS = 30_000;
const COOLDOWN_MS = 15_000;

// Circuit breaker: if an agent needs auto-401 recovery more than this many times
// within the window, respawning clearly isn't fixing the auth (dead refresh
// token, persistent network failure, …). Respawning with the same bad credential
// would loop forever (~once per cooldown), burning the agent so it never
// completes a turn — it looks "stuck idle". Trip the breaker instead: pause the
// agent + tell the user to reconnect. A user-reconnect resets the counter.
const BREAKER_WINDOW_MS = 5 * 60_000;
const BREAKER_MAX_RECOVERIES = 4;

const inFlight = new Map<string, Promise<RecoveryResult>>();
const lastSuccessAt = new Map<string, number>();
// Timestamps of recent auto-401 recovery attempts per agent (for the breaker).
const autoRecoveryTimes = new Map<string, number[]>();

export const setRespawnFn = (fn: RespawnFn): void => {
  respawnFn = fn;
};

export const setUserDataDir = (dir: string): void => {
  userDataDir = dir;
};

export const setRecoveryBroadcastFn = (fn: BroadcastFn): void => {
  broadcastFn = fn;
};

export const setRecoveryPauseFn = (fn: PauseFn): void => {
  pauseFn = fn;
};

const broadcast = (event: RecoveryStatusEvent): void => {
  if (broadcastFn !== null) broadcastFn(event);
};

export const __resetRecoveryState = (): void => {
  respawnFn = null;
  userDataDir = null;
  broadcastFn = null;
  pauseFn = null;
  inFlight.clear();
  lastSuccessAt.clear();
  autoRecoveryTimes.clear();
};

export const recoverAgent = async (
  agentId: string,
  opts: { reason: RecoveryReason },
): Promise<RecoveryResult> => {
  dlog(`recoverAgent agentId=${agentId} reason=${opts.reason}`);

  // A user-initiated reconnect is a fresh start — clear the breaker so a token
  // the user just refreshed gets a clean shot.
  if (opts.reason === "user-reconnect") {
    autoRecoveryTimes.delete(agentId);
  }

  const existing = inFlight.get(agentId);
  if (existing !== undefined) {
    dlog(`recoverAgent agentId=${agentId} short-circuit=skipped-recovering`);
    return { kind: "skipped-recovering", agentId };
  }

  // Circuit breaker (auto-401 only): if we've respawned this agent repeatedly in
  // the window and it keeps 401-ing, respawning isn't the fix. Pause the agent
  // and ask the user to reconnect instead of looping forever.
  if (opts.reason === "auto-401") {
    const now = Date.now();
    const recent = (autoRecoveryTimes.get(agentId) ?? []).filter(
      (t) => now - t < BREAKER_WINDOW_MS,
    );
    recent.push(now);
    autoRecoveryTimes.set(agentId, recent);
    if (recent.length > BREAKER_MAX_RECOVERIES) {
      dlog(
        `recoverAgent agentId=${agentId} CIRCUIT-OPEN n=${recent.length.toString()} window=${BREAKER_WINDOW_MS.toString()}ms — pausing, user must reconnect`,
      );
      broadcast({ agentId, phase: "circuit-open", reason: "auth-unrecoverable" });
      if (pauseFn !== null) pauseFn(agentId, "auth");
      return { kind: "circuit-open", agentId };
    }
  }

  const lastSuccess = lastSuccessAt.get(agentId);
  if (lastSuccess !== undefined && Date.now() - lastSuccess < COOLDOWN_MS) {
    dlog(
      `recoverAgent agentId=${agentId} short-circuit=skipped-cooldown ageMs=${(Date.now() - lastSuccess).toString()}`,
    );
    return { kind: "skipped-cooldown", agentId };
  }

  const promise = withTimeout(() => runPipeline(agentId, opts), agentId);
  inFlight.set(agentId, promise);
  try {
    const result = await promise;
    if (result.kind === "recovered") {
      lastSuccessAt.set(agentId, Date.now());
    }
    dlog(`recoverAgent agentId=${agentId} result=${result.kind}`);
    return result;
  } finally {
    inFlight.delete(agentId);
  }
};

export const recoverAllRunning = async (): Promise<RecoveryResult[]> => {
  const ids = listAdapterAgentIds();
  dlog(`recoverAllRunning n=${ids.length.toString()} ids=${ids.join(",")}`);
  return Promise.all(ids.map((id) => recoverAgent(id, { reason: "user-reconnect" })));
};

const runPipeline = async (
  agentId: string,
  _opts: { reason: RecoveryReason },
): Promise<RecoveryResult> => {
  const startMs = Date.now();

  const adapter = getAdapter(agentId);
  if (adapter === undefined || !adapter.isAlive()) {
    dlog(
      `pipeline agentId=${agentId} skipped-not-running adapterPresent=${(adapter !== undefined).toString()}`,
    );
    // Silent — no broadcast on skipped-* (caller still sees the result).
    return { kind: "skipped-not-running", agentId };
  }

  dlog(`pipeline agentId=${agentId} phase=started`);
  broadcast({ agentId, phase: "started" });

  const detected = detectClaudeCliToken();
  if (detected === null) {
    dlog(`pipeline agentId=${agentId} phase=host-stale reason=no-host-file`);
    broadcast({ agentId, phase: "host-stale", reason: "no-host-file" });
    return { kind: "host-stale", agentId, reason: "no-host-file" };
  }

  if (userDataDir === null) {
    dlog(`pipeline agentId=${agentId} phase=failed reason=user-data-dir-not-set`);
    broadcast({ agentId, phase: "failed", reason: "user-data-dir-not-set" });
    return { kind: "failed", agentId, reason: "user-data-dir-not-set" };
  }
  if (respawnFn === null) {
    dlog(`pipeline agentId=${agentId} phase=failed reason=respawn-fn-not-set`);
    broadcast({ agentId, phase: "failed", reason: "respawn-fn-not-set" });
    return { kind: "failed", agentId, reason: "respawn-fn-not-set" };
  }

  dlog(`pipeline agentId=${agentId} killing adapter to respawn with fresh credential`);
  adapter.kill();

  const agentConfigDir = getAgentConfigDir(userDataDir, agentId);
  const reseedOk = seedSandboxCredentials(agentConfigDir);
  if (reseedOk === false) {
    dlog(
      `pipeline agentId=${agentId} phase=failed reason=reseed-failed configDir=${agentConfigDir}`,
    );
    broadcast({ agentId, phase: "failed", reason: "reseed-failed" });
    return { kind: "failed", agentId, reason: "reseed-failed" };
  }
  dlog(`pipeline agentId=${agentId} reseed-ok configDir=${agentConfigDir}; respawning`);

  try {
    await respawnFn(agentId);
  } catch (e) {
    const reason = `respawn-failed: ${e instanceof Error ? e.message : String(e)}`;
    dlog(`pipeline agentId=${agentId} phase=failed ${reason}`);
    broadcast({ agentId, phase: "failed", reason });
    return {
      kind: "failed",
      agentId,
      reason,
    };
  }

  const durationMs = Date.now() - startMs;
  dlog(`pipeline agentId=${agentId} phase=recovered durationMs=${durationMs.toString()}`);
  broadcast({ agentId, phase: "recovered" });
  return { kind: "recovered", agentId, durationMs };
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
      dlog(
        `pipeline agentId=${agentId} phase=failed reason=timeout (after ${LOCK_TIMEOUT_MS.toString()}ms)`,
      );
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
