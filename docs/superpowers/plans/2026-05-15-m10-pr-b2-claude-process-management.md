# M10 PR-B.2 — Agent-Runner Claude Process Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the `apps/agent-runner` app to actually run agents — spawn `claude` child processes, write to their stdin, kill them, and forward their `stdout`/`stderr`/`exit` over the wire protocol.

**Architecture:** A `ClaudeProcess` abstraction (the minimal `ChildProcess` surface the runner needs) spawned through an injectable `ClaudeSpawner` — the real one wraps `node:child_process.spawn`, tests inject a `FakeClaude`. A per-agent registry on `RunnerState` tracks live children. The `spawn` handler prepares a container-side sandbox, spawns the child, and wires its stdout/stderr (line-framed) and exit to wire notifications.

**Tech Stack:** TypeScript, Node `child_process`/`stream`, tsup, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md` — PR-B.2 of three sub-PRs for spec §10 row **B** (B.1 ✅ done). PR-B.3 still owns: `mcp-bridge`, the MCP-flag triplet on the spawn argv, stderr token redaction, the real Docker image.

**Baseline:** 877 tests passing + 2 todo. This PR adds ~22 tests, all in `apps/agent-runner`.

---

## File Structure

**Created (`apps/agent-runner/src/`):**
- `claude-process.ts` — `ClaudeProcess` type, `ClaudeSpawner` type, `spawnClaude` (real spawner).
- `sandbox.ts` — `prepareAgentSandbox()`: per-agent config + work dirs and `settings.json`.
- `handlers/spawn.ts` — `handleSpawn()`: sandbox → spawn → register → forward output.
- `handlers/stdin-write.ts` — `handleStdinWrite()`.
- `handlers/kill.ts` — `handleKill()`.

**Created (`apps/agent-runner/tests/`):**
- `fake-claude.ts` — test-controllable `ClaudeProcess` double.
- `claude-process.test.ts`, `sandbox.test.ts`, `spawn.test.ts`, `stdin-write.test.ts`, `kill.test.ts`.

**Modified:**
- `src/state.ts` — add the `agents` registry to `RunnerState`.
- `src/handlers/health.ts` — report the live `activeAgents` count.
- `src/handlers/handshake.ts` — advertise the new capabilities.
- `src/runner.ts` — wire the three new handlers; accept injectable deps.
- `tests/health.test.ts`, `tests/handshake.test.ts`, `tests/runner.test.ts` — cover the changes.

**Conventions:** `pnpm lint` covers `src/` only; explicit `.js` import extensions; `verbatimModuleSyntax` (type-only imports need `type`); the `@prospero/shared` package exports `LineFramer`. Run one test file: `pnpm --filter @prospero/agent-runner exec vitest run tests/<file>`.

---

## Task 1: ClaudeProcess abstraction + real spawner

**Files:**
- Create: `apps/agent-runner/src/claude-process.ts`
- Test: `apps/agent-runner/tests/claude-process.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/claude-process.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawnClaude } from "../src/claude-process.js";

describe("spawnClaude", () => {
  it("spawns a process and exposes the ClaudeProcess surface", () => {
    // `node -e ""` stands in for the `claude` binary: it exits immediately and
    // has the same stdio/pid/kill/on surface the runner depends on.
    const child = spawnClaude({ command: process.execPath, args: ["-e", ""], env: {}, cwd: process.cwd() });
    expect(typeof child.pid === "number" || child.pid === undefined).toBe(true);
    expect(child.stdin).not.toBeNull();
    expect(child.stdout).not.toBeNull();
    expect(child.stderr).not.toBeNull();
    expect(typeof child.kill).toBe("function");
  });

  it("emits exit when the process finishes", async () => {
    const child = spawnClaude({ command: process.execPath, args: ["-e", ""], env: {}, cwd: process.cwd() });
    const code = await new Promise<number | null>((resolve) => {
      child.on("exit", (c) => resolve(c));
    });
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/claude-process.test.ts`
Expected: FAIL — cannot resolve `../src/claude-process.js`.

- [ ] **Step 3: Create the module**

Create `apps/agent-runner/src/claude-process.ts`:

```ts
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** The subset of node:child_process.ChildProcess the runner depends on. */
export type ClaudeProcess = {
  readonly pid: number | undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(): void;
  on(event: "exit", listener: (code: number | null) => void): void;
};

export type ClaudeSpawnOptions = {
  /** Binary to run — "claude" in the container; overridable for tests. */
  command: string;
  args: string[];
  /** Extra env merged over the runner's own process.env. */
  env: Record<string, string>;
  cwd: string;
};

/** Spawns a child process. Injectable so tests can substitute a FakeClaude. */
export type ClaudeSpawner = (opts: ClaudeSpawnOptions) => ClaudeProcess;

/** The production spawner — runs the real binary with piped stdio. */
export const spawnClaude: ClaudeSpawner = (opts) =>
  spawn(opts.command, opts.args, {
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/claude-process.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/claude-process.ts apps/agent-runner/tests/claude-process.test.ts
git commit -m "feat(m10): claude process abstraction and spawner"
```

---

## Task 2: FakeClaude test double

**Files:**
- Create: `apps/agent-runner/tests/fake-claude.ts`
- Test: `apps/agent-runner/tests/fake-claude.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/fake-claude.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeClaude } from "./fake-claude.js";

describe("FakeClaude", () => {
  it("captures what is written to stdin", () => {
    const fake = new FakeClaude();
    fake.stdin.write("a line\n");
    expect(fake.stdinWrites).toEqual(["a line\n"]);
  });

  it("emits stdout chunks pushed by the test", async () => {
    const fake = new FakeClaude();
    const got = new Promise<string>((resolve) => {
      fake.stdout.on("data", (c: Buffer) => resolve(c.toString()));
    });
    fake.emitStdout("hello\n");
    expect(await got).toBe("hello\n");
  });

  it("emits exit and marks killed when killed", async () => {
    const fake = new FakeClaude();
    const code = await new Promise<number | null>((resolve) => {
      fake.on("exit", (c) => resolve(c));
      fake.kill();
    });
    expect(code).toBe(0);
    expect(fake.killed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/fake-claude.test.ts`
Expected: FAIL — cannot resolve `./fake-claude.js`.

- [ ] **Step 3: Create the double**

Create `apps/agent-runner/tests/fake-claude.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClaudeProcess } from "../src/claude-process.js";

/**
 * A test-controllable ClaudeProcess. The test drives stdout/stderr/exit by hand
 * and inspects what the runner wrote to stdin.
 */
export class FakeClaude extends EventEmitter implements ClaudeProcess {
  readonly pid = 4242;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly stdinWrites: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.stdinWrites.push(chunk.toString()));
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.emit("exit", 0);
  }

  /** Test helper: push a chunk to the child's stdout. */
  emitStdout(chunk: string): void {
    this.stdout.write(chunk);
  }

  /** Test helper: push a chunk to the child's stderr. */
  emitStderr(chunk: string): void {
    this.stderr.write(chunk);
  }

  /** Test helper: end the process with an exit code. */
  emitExit(code: number | null): void {
    this.emit("exit", code);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/fake-claude.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.

```bash
git add apps/agent-runner/tests/fake-claude.ts apps/agent-runner/tests/fake-claude.test.ts
git commit -m "feat(m10): fake claude test double"
```

---

## Task 3: Container-side sandbox

**Files:**
- Create: `apps/agent-runner/src/sandbox.ts`
- Test: `apps/agent-runner/tests/sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/sandbox.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentSandbox } from "../src/sandbox.js";

describe("prepareAgentSandbox", () => {
  it("creates per-agent config and work directories", () => {
    const root = mkdtempSync(join(tmpdir(), "prospero-sbx-"));
    const sandbox = prepareAgentSandbox("agent_1", root);
    expect(existsSync(sandbox.configDir)).toBe(true);
    expect(existsSync(sandbox.workDir)).toBe(true);
    expect(sandbox.configDir).toContain("agent_1");
  });

  it("writes a settings.json that asks for filesystem tools", () => {
    const root = mkdtempSync(join(tmpdir(), "prospero-sbx-"));
    const sandbox = prepareAgentSandbox("agent_2", root);
    const settings = JSON.parse(readFileSync(join(sandbox.configDir, "settings.json"), "utf8")) as {
      permissions: { ask: string[]; allow: string[] };
    };
    expect(settings.permissions.ask).toContain("Bash");
    expect(settings.permissions.allow).toContain("mcp__dashboard__request_permission");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/sandbox.test.ts`
Expected: FAIL — cannot resolve `../src/sandbox.js`.

- [ ] **Step 3: Create the sandbox module**

Create `apps/agent-runner/src/sandbox.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Default container location for per-agent state. */
export const AGENT_STATE_ROOT = "/var/lib/agent-state";

export type AgentSandbox = {
  /** CLAUDE_CONFIG_DIR for the agent — isolated settings, no host config. */
  configDir: string;
  /** Working directory the agent runs in. */
  workDir: string;
};

// Mirrors the host adapter's writeSandboxSettings: filesystem tools route
// through --permission-prompt-tool (ask); the dashboard MCP tools are pre-allowed.
const SANDBOX_SETTINGS = {
  permissions: {
    ask: ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "MultiEdit", "NotebookEdit"],
    allow: [
      "mcp__dashboard__list_agents",
      "mcp__dashboard__list_projects",
      "mcp__dashboard__hire_agent",
      "mcp__dashboard__fire_agent",
      "mcp__dashboard__message_agent",
      "mcp__dashboard__report_to_user",
      "mcp__dashboard__notify_user",
      "mcp__dashboard__create_issue",
      "mcp__dashboard__read_thread",
      "mcp__dashboard__update_issue",
      "mcp__dashboard__assign_issue",
      "mcp__dashboard__list_issues",
      "mcp__dashboard__check_status",
      "mcp__dashboard__request_permission",
    ],
  },
};

/**
 * Creates the per-agent config and work directories inside the container and
 * writes the sandbox settings.json. `root` is injectable for tests.
 */
export const prepareAgentSandbox = (agentId: string, root: string = AGENT_STATE_ROOT): AgentSandbox => {
  const base = join(root, agentId);
  const configDir = join(base, "config");
  const workDir = join(base, "work");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), JSON.stringify(SANDBOX_SETTINGS, null, 2), "utf8");
  return { configDir, workDir };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/sandbox.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/sandbox.ts apps/agent-runner/tests/sandbox.test.ts
git commit -m "feat(m10): container-side agent sandbox"
```

---

## Task 4: Agent registry on RunnerState

**Files:**
- Modify: `apps/agent-runner/src/state.ts`
- Test: `apps/agent-runner/tests/state.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Append to `apps/agent-runner/tests/state.test.ts`:

```ts
it("starts with an empty agents registry", () => {
  const state = createRunnerState();
  expect(state.agents.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/state.test.ts`
Expected: FAIL — `state.agents` is undefined.

- [ ] **Step 3: Add the registry to the state module**

Replace the contents of `apps/agent-runner/src/state.ts`:

```ts
import type { WireCredentials } from "@prospero/shared";
import type { ClaudeProcess } from "./claude-process.js";
import type { AgentSandbox } from "./sandbox.js";

/** A spawned agent the runner is managing. */
export type RunningAgent = {
  readonly child: ClaudeProcess;
  readonly sandbox: AgentSandbox;
};

/** Mutable state shared across the runner's wire handlers. */
export type RunnerState = {
  /** Epoch ms when the runner process started. */
  readonly startedAt: number;
  /** Credentials from the handshake; null until the handshake completes. */
  credentials: WireCredentials | null;
  /** Live agents, keyed by agentId. */
  readonly agents: Map<string, RunningAgent>;
};

/** Create a fresh runner state. `now` is injectable for deterministic tests. */
export const createRunnerState = (now: number = Date.now()): RunnerState => ({
  startedAt: now,
  credentials: null,
  agents: new Map(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/state.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/state.ts apps/agent-runner/tests/state.test.ts
git commit -m "feat(m10): agent registry on runner state"
```

---

## Task 5: spawn handler

**Files:**
- Create: `apps/agent-runner/src/handlers/spawn.ts`
- Test: `apps/agent-runner/tests/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/spawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireHandlerError } from "@prospero/shared";
import { handleSpawn, type SpawnContext } from "../src/handlers/spawn.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

type Notification = { method: string; params: unknown };

const makeContext = (
  fake: FakeClaude,
): { ctx: SpawnContext; notifications: Notification[] } => {
  const notifications: Notification[] = [];
  const ctx: SpawnContext = {
    state: createRunnerState(),
    notify: (method, params) => notifications.push({ method, params }),
    spawnClaude: () => fake,
    prepareSandbox: (agentId) => {
      const root = mkdtempSync(join(tmpdir(), "prospero-spawn-"));
      return { configDir: join(root, agentId, "config"), workDir: join(root, agentId, "work") };
    },
  };
  return { ctx, notifications };
};

const validParams = { agentId: "agent_1", args: ["--model", "claude-sonnet-4-6"] };

// Stream `data` events are not reliably synchronous — wait one tick after
// pushing to the fake child's stdout/stderr before asserting.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("handleSpawn", () => {
  it("registers the agent and returns its pid", () => {
    const { ctx } = makeContext(new FakeClaude());
    const result = handleSpawn(validParams, ctx);
    expect(result).toEqual({ pid: 4242 });
    expect(ctx.state.agents.has("agent_1")).toBe(true);
  });

  it("forwards a stdout line as a stdout notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitStdout('{"type":"system"}\n');
    await tick();
    expect(notifications).toContainEqual({
      method: "stdout",
      params: { agentId: "agent_1", line: '{"type":"system"}' },
    });
  });

  it("forwards a stderr line as a stderr notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitStderr("a warning\n");
    await tick();
    expect(notifications).toContainEqual({
      method: "stderr",
      params: { agentId: "agent_1", line: "a warning" },
    });
  });

  it("emits an exit notification and deregisters on child exit", () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    handleSpawn(validParams, ctx);
    fake.emitExit(0);
    expect(notifications).toContainEqual({
      method: "exit",
      params: { agentId: "agent_1", code: 0 },
    });
    expect(ctx.state.agents.has("agent_1")).toBe(false);
  });

  it("throws spawnFailed (1020) when the agent is already running", () => {
    const { ctx } = makeContext(new FakeClaude());
    handleSpawn(validParams, ctx);
    let caught: unknown;
    try {
      handleSpawn(validParams, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1020);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    const { ctx } = makeContext(new FakeClaude());
    let caught: unknown;
    try {
      handleSpawn({ agentId: "agent_1" }, ctx);
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/spawn.test.ts`
Expected: FAIL — cannot resolve `../src/handlers/spawn.js`.

- [ ] **Step 3: Create the spawn handler**

Create `apps/agent-runner/src/handlers/spawn.ts`:

```ts
import { z } from "zod";
import { LineFramer, WireErrorCode, WireHandlerError, type SpawnResult } from "@prospero/shared";
import type { ClaudeSpawner } from "../claude-process.js";
import type { AgentSandbox } from "../sandbox.js";
import type { RunnerState } from "../state.js";

/** Dependencies the spawn handler needs beyond the runner state. */
export type SpawnContext = {
  state: RunnerState;
  notify: (method: string, params: unknown) => void;
  spawnClaude: ClaudeSpawner;
  prepareSandbox: (agentId: string) => AgentSandbox;
};

const spawnParamsSchema = z.object({
  agentId: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

// Forwards a child stream as line-delimited wire notifications of one method.
const forwardLines = (
  stream: NodeJS.ReadableStream | null,
  method: string,
  agentId: string,
  notify: SpawnContext["notify"],
): void => {
  if (stream === null) return;
  const framer = new LineFramer();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of framer.push(chunk)) notify(method, { agentId, line });
  });
};

/**
 * Validates a spawn request, prepares the agent's sandbox, spawns the `claude`
 * child, registers it, and wires its stdout/stderr/exit to wire notifications.
 * The `claude` argv is taken as-is from params.args — PR-B.3 appends the MCP
 * triplet. Throws WireHandlerError on bad params or a duplicate agent.
 */
export const handleSpawn = (params: unknown, ctx: SpawnContext): SpawnResult => {
  const parsed = spawnParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "spawn: invalid params");
  }
  const { agentId, args, env } = parsed.data;
  if (ctx.state.agents.has(agentId)) {
    throw new WireHandlerError(WireErrorCode.spawnFailed, `spawn: agent '${agentId}' already running`);
  }

  const sandbox = ctx.prepareSandbox(agentId);
  const child = ctx.spawnClaude({
    command: "claude",
    args,
    env: { ...(env ?? {}), CLAUDE_CONFIG_DIR: sandbox.configDir },
    cwd: sandbox.workDir,
  });

  forwardLines(child.stdout, "stdout", agentId, ctx.notify);
  forwardLines(child.stderr, "stderr", agentId, ctx.notify);
  child.on("exit", (code) => {
    ctx.notify("exit", { agentId, code });
    ctx.state.agents.delete(agentId);
  });

  ctx.state.agents.set(agentId, { child, sandbox });
  return { pid: child.pid ?? -1 };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/spawn.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/handlers/spawn.ts apps/agent-runner/tests/spawn.test.ts
git commit -m "feat(m10): runner spawn handler"
```

---

## Task 6: stdin-write handler

**Files:**
- Create: `apps/agent-runner/src/handlers/stdin-write.ts`
- Test: `apps/agent-runner/tests/stdin-write.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/stdin-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WireHandlerError } from "@prospero/shared";
import { handleStdinWrite } from "../src/handlers/stdin-write.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

describe("handleStdinWrite", () => {
  it("writes the line to the agent's stdin", () => {
    const state = createRunnerState();
    const fake = new FakeClaude();
    state.agents.set("agent_1", {
      child: fake,
      sandbox: { configDir: "/c", workDir: "/w" },
    });
    handleStdinWrite({ agentId: "agent_1", line: '{"type":"user"}\n' }, state);
    expect(fake.stdinWrites).toEqual(['{"type":"user"}\n']);
  });

  it("throws agentNotFound (1010) for an unknown agent", () => {
    let caught: unknown;
    try {
      handleStdinWrite({ agentId: "ghost", line: "x" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1010);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    let caught: unknown;
    try {
      handleStdinWrite({ agentId: "agent_1" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/stdin-write.test.ts`
Expected: FAIL — cannot resolve `../src/handlers/stdin-write.js`.

- [ ] **Step 3: Create the handler**

Create `apps/agent-runner/src/handlers/stdin-write.ts`:

```ts
import { z } from "zod";
import { WireErrorCode, WireHandlerError } from "@prospero/shared";
import type { RunnerState } from "../state.js";

const stdinWriteParamsSchema = z.object({
  agentId: z.string().min(1),
  line: z.string(),
});

/**
 * Writes one line of JSONL to a running agent's stdin. Throws WireHandlerError
 * on malformed params or an unknown agent.
 */
export const handleStdinWrite = (params: unknown, state: RunnerState): Record<string, never> => {
  const parsed = stdinWriteParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "stdin-write: invalid params");
  }
  const agent = state.agents.get(parsed.data.agentId);
  if (agent === undefined) {
    throw new WireHandlerError(
      WireErrorCode.agentNotFound,
      `stdin-write: no agent '${parsed.data.agentId}'`,
    );
  }
  agent.child.stdin?.write(parsed.data.line);
  return {};
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/stdin-write.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/handlers/stdin-write.ts apps/agent-runner/tests/stdin-write.test.ts
git commit -m "feat(m10): runner stdin-write handler"
```

---

## Task 7: kill handler

**Files:**
- Create: `apps/agent-runner/src/handlers/kill.ts`
- Test: `apps/agent-runner/tests/kill.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/kill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WireHandlerError } from "@prospero/shared";
import { handleKill } from "../src/handlers/kill.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

describe("handleKill", () => {
  it("kills the agent's child process", () => {
    const state = createRunnerState();
    const fake = new FakeClaude();
    state.agents.set("agent_1", { child: fake, sandbox: { configDir: "/c", workDir: "/w" } });
    handleKill({ agentId: "agent_1" }, state);
    expect(fake.killed).toBe(true);
  });

  it("throws agentNotFound (1010) for an unknown agent", () => {
    let caught: unknown;
    try {
      handleKill({ agentId: "ghost" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1010);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    let caught: unknown;
    try {
      handleKill({}, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/kill.test.ts`
Expected: FAIL — cannot resolve `../src/handlers/kill.js`.

- [ ] **Step 3: Create the handler**

Create `apps/agent-runner/src/handlers/kill.ts`:

```ts
import { z } from "zod";
import { WireErrorCode, WireHandlerError } from "@prospero/shared";
import type { RunnerState } from "../state.js";

const killParamsSchema = z.object({ agentId: z.string().min(1) });

/**
 * Terminates a running agent's child. The child's exit listener (wired in the
 * spawn handler) emits the `exit` notification and deregisters the agent — kill
 * does not do that itself, so there is one cleanup path. Throws WireHandlerError
 * on malformed params or an unknown agent.
 */
export const handleKill = (params: unknown, state: RunnerState): Record<string, never> => {
  const parsed = killParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "kill: invalid params");
  }
  const agent = state.agents.get(parsed.data.agentId);
  if (agent === undefined) {
    throw new WireHandlerError(WireErrorCode.agentNotFound, `kill: no agent '${parsed.data.agentId}'`);
  }
  agent.child.kill();
  return {};
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/kill.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/handlers/kill.ts apps/agent-runner/tests/kill.test.ts
git commit -m "feat(m10): runner kill handler"
```

---

## Task 8: Update health and handshake

**Files:**
- Modify: `apps/agent-runner/src/handlers/health.ts`, `apps/agent-runner/src/handlers/handshake.ts`
- Test: `apps/agent-runner/tests/health.test.ts`, `apps/agent-runner/tests/handshake.test.ts` (extend)

- [ ] **Step 1: Extend the failing tests**

Append to `apps/agent-runner/tests/health.test.ts`:

```ts
it("reports the live agent count", () => {
  const state = createRunnerState(0);
  state.agents.set("a1", {
    child: { pid: 1, stdin: null, stdout: null, stderr: null, kill: () => {}, on: () => {} },
    sandbox: { configDir: "/c", workDir: "/w" },
  });
  expect(handleHealth(state, 0).activeAgents).toBe(1);
});
```

In `apps/agent-runner/tests/handshake.test.ts`, change the `capabilities` expectation in the "returns the server handshake result" test from `["health"]` to:

```ts
      capabilities: ["spawn", "stdin", "kill", "health"],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/health.test.ts tests/handshake.test.ts`
Expected: FAIL — `activeAgents` is 0, and `capabilities` is `["health"]`.

- [ ] **Step 3: Update the health handler**

In `apps/agent-runner/src/handlers/health.ts`, replace `activeAgents: 0,` with:

```ts
  activeAgents: state.agents.size,
```

Also update the doc comment — replace the first sentence with:

```ts
/**
 * Liveness snapshot. `now` is injectable for deterministic tests.
 */
```

- [ ] **Step 4: Update the handshake capabilities**

In `apps/agent-runner/src/handlers/handshake.ts`, replace `capabilities: ["health"],` with:

```ts
    capabilities: ["spawn", "stdin", "kill", "health"],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/health.test.ts tests/handshake.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/handlers/health.ts apps/agent-runner/src/handlers/handshake.ts apps/agent-runner/tests/health.test.ts apps/agent-runner/tests/handshake.test.ts
git commit -m "feat(m10): health agent count and spawn capabilities"
```

---

## Task 9: Wire the new handlers into the runner

**Files:**
- Modify: `apps/agent-runner/src/runner.ts`
- Test: `apps/agent-runner/tests/runner.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Append to `apps/agent-runner/tests/runner.test.ts` (add `FakeClaude` to the imports — `import { FakeClaude } from "./fake-claude.js";`):

```ts
it("spawns an agent through the wire and tracks it", async () => {
  const pair = createMemoryTransportPair();
  const fake = new FakeClaude();
  const runner = createRunner(pair.a, {
    spawnClaude: () => fake,
    prepareSandbox: (agentId) => ({ configDir: `/c/${agentId}`, workDir: `/w/${agentId}` }),
  });
  const responses: unknown[] = [];
  pair.b.onData((chunk) => responses.push(decodeWireMessage(chunk)));
  pair.b.send(
    encodeWireMessage({
      type: "request",
      id: "msg_9",
      method: "spawn",
      params: { agentId: "agent_1", args: [] },
    }),
  );
  await Promise.resolve();
  expect(responses[0]).toMatchObject({ type: "response", id: "msg_9", result: { pid: 4242 } });
  expect(runner.state.agents.has("agent_1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/runner.test.ts`
Expected: FAIL — `createRunner` takes one argument; the second is rejected, and `spawn` is an unknown method.

- [ ] **Step 3: Update the runner module**

Replace the contents of `apps/agent-runner/src/runner.ts`:

```ts
import { WireServer, type WireTransport } from "@prospero/shared";
import { createRunnerState, type RunnerState } from "./state.js";
import { spawnClaude as realSpawnClaude, type ClaudeSpawner } from "./claude-process.js";
import { prepareAgentSandbox } from "./sandbox.js";
import type { AgentSandbox } from "./sandbox.js";
import { handleHandshake } from "./handlers/handshake.js";
import { handleHealth } from "./handlers/health.js";
import { handleSpawn } from "./handlers/spawn.js";
import { handleStdinWrite } from "./handlers/stdin-write.js";
import { handleKill } from "./handlers/kill.js";

export type Runner = {
  readonly server: WireServer;
  readonly state: RunnerState;
};

/** Injectable dependencies — overridden in tests with fakes. */
export type RunnerDeps = {
  spawnClaude?: ClaudeSpawner;
  prepareSandbox?: (agentId: string) => AgentSandbox;
};

/**
 * Wires a WireServer over the given transport and registers the runner's
 * request handlers. The server is live as soon as this returns.
 */
export const createRunner = (transport: WireTransport, deps: RunnerDeps = {}): Runner => {
  const state = createRunnerState();
  const server = new WireServer(transport);
  const spawnClaude = deps.spawnClaude ?? realSpawnClaude;
  const prepareSandbox = deps.prepareSandbox ?? ((agentId: string) => prepareAgentSandbox(agentId));

  server.handle("handshake", (params) => handleHandshake(params, state));
  server.handle("health", () => handleHealth(state));
  server.handle("spawn", (params) =>
    handleSpawn(params, {
      state,
      notify: (method, notifyParams) => server.notify(method, notifyParams),
      spawnClaude,
      prepareSandbox,
    }),
  );
  server.handle("stdin-write", (params) => handleStdinWrite(params, state));
  server.handle("kill", (params) => handleKill(params, state));
  return { server, state };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/runner.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/runner.ts apps/agent-runner/tests/runner.test.ts
git commit -m "feat(m10): wire spawn stdin-write kill into the runner"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every package**

Run: `pnpm -r typecheck`
Expected: all 4 packages green.

- [ ] **Step 2: Lint every package**

Run: `pnpm -r lint`
Expected: all green.

- [ ] **Step 3: Run the whole test suite**

Run: `pnpm -r test`
Expected: all suites green. The 877 baseline tests still pass; `apps/agent-runner` adds ~22 (2 + 3 + 2 + 1 + 6 + 3 + 3 + 1 + 1), so the package rises from 16 to ~38, total ~899.

- [ ] **Step 4: Build the runner bundle**

Run: `pnpm --filter @prospero/agent-runner build`
Expected: tsup succeeds; `apps/agent-runner/dist/index.js` is regenerated.

- [ ] **Step 5: Confirm scope**

Run: `git diff --name-only <pr-b1-last-commit>..HEAD | grep -v "^docs/"`
Confirm every changed file is under `apps/agent-runner/` — PR-B.2 is purely additive to the runner.

---

## Self-Review notes

- **Spec coverage (§10 row B, part 2 of 3):** `spawn` ✓ (Task 5), `stdin-write` ✓ (Task 6), `kill` ✓ (Task 7), container-side sandbox ✓ (Task 3), raw `stdout`/`stderr`/`exit` forwarding ✓ (Task 5). Deferred to PR-B.3: the MCP-flag triplet on the spawn argv, the `mcp-bridge`, stderr token redaction, the real Docker image.
- **Placeholder scan:** none — every step has concrete code or an exact command.
- **Type consistency:** `ClaudeProcess`/`ClaudeSpawner`/`ClaudeSpawnOptions` (Task 1) are consumed by `FakeClaude` (Task 2), `RunningAgent` (Task 4), `SpawnContext` (Task 5), and `createRunner` (Task 9). `AgentSandbox` (Task 3) flows through `RunningAgent` and `SpawnContext`. `RunnerState.agents` (Task 4) is used by every handler. `handleSpawn` returns `SpawnResult` from `@prospero/shared`. `LineFramer` is imported from `@prospero/shared` (exported by PR-A).
- **Single cleanup path:** only the child's `exit` listener (wired in `handleSpawn`) deregisters an agent; `handleKill` just calls `child.kill()`, which triggers that listener. No double-delete.
- **Redaction:** `stderr` lines are forwarded verbatim in PR-B.2; token redaction lands in PR-B.3. No real leak window — nothing consumes `stderr` notifications until the host adapter (PR-C).
