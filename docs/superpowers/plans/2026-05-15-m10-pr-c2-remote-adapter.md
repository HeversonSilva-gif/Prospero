# M10 PR-C.2 — Remote Docker adapter + MCP relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `claude-oauth-remote-docker` adapter end to end — `ClaudeRemoteDockerAdapter` (implements `AgentAdapter`, drives the PR-C.1 connection manager) plus the per-agent MCP relay that bridges the container's tools to the host's dashboard MCP server — and register it so the orchestrator can spawn remote agents.

**Architecture:** The adapter is per-agent and translates the `AgentAdapter` surface into wire messages over the shared `RemoteConnectionManager` (PR-C.1). Its `claude` argv is built host-side by `buildClaudeArgs` **minus the MCP triplet** — the runner appends the triplet with the container-local `mcp.json` path. When the container's `claude` opens its MCP bridge, the adapter spawns the **real `mcp/server.js`** as a host subprocess (direct SQLite access) and an `McpRelay` ferries JSON-RPC lines between it and the wire `mcp-data` channel (design §6). Two gaps that block end-to-end function are closed here: the runner must inject the handshake OAuth token as `CLAUDE_CODE_OAUTH_TOKEN`, and the lifecycle ToS cap must count remote OAuth agents.

**Tech Stack:** TypeScript, the `AgentAdapter` pattern (`apps/main/src/orchestrator/adapters/`), the PR-C.1 connection layer, `@prospero/shared` (`LineFramer`), `node:child_process`, vitest.

---

## Context for the implementer

PR-C.1 built the connection layer (`claude-oauth-remote-docker/`: `config.ts`, `transport-command.ts`, `child-transport.ts`, `connection-manager.ts` + `memory-transport.ts`/`fake-runner.ts` test helpers). PR-C.2 builds the adapter on top of it and registers it. PR-D handles Settings UX; PR-E does docs + the Docker smoke.

Read these before starting:

- `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` — `ClaudeOAuthLocalAdapter`, the `AgentAdapter` reference. PR-C.2's adapter mirrors its listener-set pattern (`onEvent`/`onStderr`/`onExit`), `handleParsedEvent` usage accumulation, and the `sendInput` JSONL payload shape.
- `packages/shared/src/types/adapter.ts` — `AgentAdapter` interface, `SpawnContext`, `ParsedEvent`, `UsageEstimate`, `AdapterName`.
- `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts` (PR-C.1) — `RemoteConnectionManager.spawnAgent({agentId, args, env?, oauthToken, callbacks})`, `sendStdin`, `killAgent`, `sendMcpData`, `hasAgent`; `RemoteAgentCallbacks` (`onStdout`/`onStderr`/`onExit`/`onMcpOpen`/`onMcpData`/`onMcpClose`); `getRemoteConnectionManager()` singleton.
- `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts` — `buildClaudeArgs`. Task 1 changes its signature.
- `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts` — `parseStreamLine(line)` → `ParsedEvent | null`. The remote adapter parses runner `stdout` lines with it (the api-key adapter already imports cross-adapter from `claude-oauth-local/`).
- `apps/main/src/orchestrator/mcp-handshake.ts` — `resolveMcpServerPath(override?)` resolves `dist/mcp/server.js`.
- `apps/main/src/orchestrator/mcp-config.ts` — `writeMcpConfigFile` shows the MCP-server env (`AGENT_ID`/`COMPANY_ID`/`DB_PATH`/`PERMISSIONS_DIR`/`EVENTS_DIR`) and the `ELECTRON_RUN_AS_NODE` workaround the relay reuses.
- `apps/agent-runner/src/handlers/spawn.ts` + `src/state.ts` — the runner spawn handler. `state.credentials` (`WireCredentials | null`) is set by the handshake but **never applied** to the claude env — Task 2 closes that gap.
- `apps/main/src/orchestrator/lifecycle.ts` — `ensureAdapter`'s `isOauth` check. Task 6 adds `claude-oauth-remote-docker` to it.

### MCP line-framing asymmetry (critical — Task 4)

The two directions of `mcp-data` are framed differently, by established PR-B behavior:

- **runner → host** (`onMcpData`): the runner's `mcp-mux` runs the bridge socket through a `LineFramer`, so each `mcp-data.line` arrives **newline-stripped**.
- **host → runner** (`sendMcpData`): the runner's `writeToBridge` writes the line **verbatim** to the bridge socket, and `claude`'s MCP client needs newline-delimited JSON-RPC — so host→runner lines **must include the trailing `\n`** (confirmed by `apps/agent-runner/tests/runner.test.ts`, which sends `line: '{"jsonrpc":"2.0"}\n'`).

So the relay: writes inbound lines to the MCP server's stdin **ensuring one `\n`**, and frames the server's stdout with `LineFramer` then sends each line back **with `\n` re-appended**.

### Repo conventions

- Colocated `*.test.ts`; test-only helpers colocate in the adapter dir (not bundled — `tsup` only reaches what `src/index.ts` imports).
- Run one apps/main test file: `pnpm --filter @prospero/main run test <path>`. One agent-runner test file: `pnpm --filter @prospero/agent-runner run test <path>`. (`pnpm exec vitest` does not resolve the binary — use the `test` script.)
- `exactOptionalPropertyTypes` is on — conditional spread for optional props; never assign explicit `undefined`. To build a `SpawnContext` without `oauthToken`, `delete` the key.
- commitlint rejects uppercase / `+` / `%` in the subject.

### File structure

| File | Responsibility |
|---|---|
| `claude-oauth-local/build-args.ts` (**modify**) | `mcpConfigPath: string \| null` — `null` omits the MCP triplet for the remote adapter. |
| `agent-runner/src/handlers/spawn.ts` (**modify**) | Inject `CLAUDE_CODE_OAUTH_TOKEN` from the handshake credentials. |
| `claude-oauth-remote-docker/test-fixtures.ts` (**create**) | `FakeMcpServer` + `makeSpawnContext` test helpers. |
| `claude-oauth-remote-docker/mcp-relay.ts` (**create**) | `McpRelay` — spawns host `mcp/server.js`, ferries JSON-RPC ↔ wire. |
| `claude-oauth-remote-docker/adapter.ts` (**create**) | `ClaudeRemoteDockerAdapter implements AgentAdapter`. |
| `adapters/index.ts` (**modify**) | Register the `claude-oauth-remote-docker` factory. |
| `orchestrator/lifecycle.ts` (**modify**) | Count remote OAuth agents toward the ToS cap. |
| `*.test.ts` (4 files) | Colocated tests + the build-args/spawn test updates. |

---

## Task 1: `buildClaudeArgs` — make the MCP triplet optional

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`
- Test: `apps/main/tests/orchestrator.build-args.test.ts` (add one case)

The remote adapter reuses `buildClaudeArgs` for the system prompt / model / tools / stream flags, but the **MCP triplet** (`--mcp-config <path>`, `--strict-mcp-config`, `--permission-prompt-tool …`) must be omitted host-side — the runner appends it with the container-local `mcp.json` path (design §4.3). Change the signature to accept `mcpConfigPath: string | null`; `null` omits the triplet. The three existing tests pass a string and use `toContain`, so they keep passing despite the arg-order change.

- [ ] **Step 1: Write the failing test — add to `orchestrator.build-args.test.ts`**

Add this `it` block inside the existing `describe("buildClaudeArgs", …)`:

```ts
  it("omits the MCP triplet when mcpConfigPath is null", () => {
    const args = buildClaudeArgs(baseAgent, null);
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
    expect(args).toContain("--model");
    expect(args).toContain("--permission-mode");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main run test tests/orchestrator.build-args.test.ts`
Expected: FAIL — `buildClaudeArgs(baseAgent, null)` is a type error / the triplet is still present.

- [ ] **Step 3: Modify `build-args.ts`**

Replace the function body. The signature's second parameter becomes `string | null`; the base args end at `--permission-mode default`; the triplet is appended only when a config path is given:

```ts
export const buildClaudeArgs = (
  agent: Agent,
  mcpConfigPath: string | null,
  opts: { narratedActive?: boolean } = {},
): string[] => {
  const allowedTools = resolveSkillTools(agent.skills);
  const isCeo = agent.role === "ceo" || agent.role === "CEO";
  const narratedBlock = opts.narratedActive === true ? buildNarratedBlock() : undefined;
  const args = [
    "--system-prompt",
    composeSystemPrompt({
      agentPersona: agent.systemPrompt,
      skills: agent.skills,
      ...(isCeo ? { goalsBlock: goalsSystemPromptBlock } : {}),
      ...(narratedBlock !== undefined ? { narratedBlock } : {}),
    }),
    "--model",
    agent.model,
    "--allowedTools",
    allowedTools.join(","),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "default",
  ];
  // The MCP triplet — host-side adapters pass a host mcp.json path; the remote
  // adapter passes null because the agent-runner appends the triplet itself with
  // the container-local mcp.json path (m10 design §4.3 / §6).
  if (mcpConfigPath !== null) {
    args.push(
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--permission-prompt-tool",
      "mcp__dashboard__request_permission",
    );
  }
  if (agent.claudeSessionId !== null) {
    args.push("--resume", agent.claudeSessionId);
  }
  return args;
};
```

Keep the existing file header comment block above the function unchanged.

- [ ] **Step 4: Run the build-args tests to verify they pass**

Run: `pnpm --filter @prospero/main run test tests/orchestrator.build-args.test.ts`
Expected: PASS — 4 tests (3 existing + the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts apps/main/tests/orchestrator.build-args.test.ts
git commit -m "feat(m10): optional mcp triplet in build-args"
```

---

## Task 2: Runner — inject the handshake OAuth token into the claude env

**Files:**
- Modify: `apps/agent-runner/src/handlers/spawn.ts`
- Test: `apps/agent-runner/tests/spawn.test.ts` (add one case)

The runner's `handleHandshake` records `state.credentials` but `handleSpawn` never applies it — the spawned `claude` gets no `CLAUDE_CODE_OAUTH_TOKEN`, so a remote agent cannot authenticate (design §5.1 / §8: the token arrives via the handshake and becomes the claude child's env). This closes that PR-B.2 gap.

- [ ] **Step 1: Write the failing test — add to `apps/agent-runner/tests/spawn.test.ts`**

Add this `it` block inside the existing `describe("handleSpawn", …)`:

```ts
  it("injects the handshake oauth token as CLAUDE_CODE_OAUTH_TOKEN", async () => {
    const fake = new FakeClaude();
    const { ctx } = makeContext(fake);
    ctx.state.credentials = { kind: "oauth", oauthToken: "tok-secret" };
    let seenEnv: Record<string, string> = {};
    ctx.spawnClaude = (opts) => {
      seenEnv = opts.env;
      return fake;
    };
    await handleSpawn(validParams, ctx);
    expect(seenEnv["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok-secret");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner run test tests/spawn.test.ts`
Expected: FAIL — `seenEnv["CLAUDE_CODE_OAUTH_TOKEN"]` is `undefined`.

- [ ] **Step 3: Modify `spawn.ts`**

In `handleSpawn`, the `ctx.spawnClaude({ … })` call currently builds `env` as `{ ...(env ?? {}), CLAUDE_CONFIG_DIR: sandbox.configDir }`. Replace that `spawnClaude` call with:

```ts
  const child = ctx.spawnClaude({
    command: "claude",
    args: [...args, ...mcpTripletArgs(mcpConfigPath)],
    env: {
      ...(env ?? {}),
      // The OAuth token arrives once via the handshake (design §5.1 / §8) and
      // becomes the claude child's credential — never seeded to disk.
      ...(ctx.state.credentials !== null
        ? { CLAUDE_CODE_OAUTH_TOKEN: ctx.state.credentials.oauthToken }
        : {}),
      CLAUDE_CONFIG_DIR: sandbox.configDir,
    },
    cwd: sandbox.workDir,
  });
```

(`ctx.state` is the `RunnerState`; `state.credentials` is `WireCredentials | null` = `{ kind: "oauth"; oauthToken: string } | null`.)

- [ ] **Step 4: Run the spawn tests to verify they pass**

Run: `pnpm --filter @prospero/agent-runner run test tests/spawn.test.ts`
Expected: PASS — all `handleSpawn` tests (7 existing + the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/agent-runner/src/handlers/spawn.ts apps/agent-runner/tests/spawn.test.ts
git commit -m "feat(m10): inject handshake oauth token into claude env"
```

---

## Task 3: `test-fixtures.ts` — `FakeMcpServer` + `makeSpawnContext`

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-fixtures.ts`

Test-only helpers shared by Tasks 4 and 5. `FakeMcpServer` is a controllable stand-in for the host `mcp/server.js` subprocess; `makeSpawnContext` builds a minimal `SpawnContext`. Not reachable from `src/index.ts`, so never bundled.

- [ ] **Step 1: Create `test-fixtures.ts`**

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Agent, SpawnContext } from "@prospero/shared";
import type { McpServerProcess } from "./mcp-relay.js";

/**
 * A test-controllable host MCP server process. The test drives stdout and
 * inspects what the relay wrote to stdin. Test-only.
 */
export class FakeMcpServer extends EventEmitter implements McpServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  /** Every chunk the relay wrote to stdin, in order. */
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

  /** Test helper: push a chunk to the server's stdout. */
  emitStdout(chunk: string): void {
    this.stdout.write(chunk);
  }
}

const baseAgent: Agent = {
  id: "agent_1",
  companyId: "co_1",
  name: "Engineer",
  role: "Backend Engineer",
  systemPrompt: "You are an engineer.",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  skills: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-remote-docker",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
};

/** A minimal SpawnContext for remote-adapter tests. Test-only. */
export const makeSpawnContext = (overrides: Partial<SpawnContext> = {}): SpawnContext => ({
  agent: baseAgent,
  oauthToken: "test-oauth-token",
  dbPath: "/tmp/prospero-test.sqlite",
  permissionsDir: "/tmp/prospero-test-perms",
  eventsDir: "/tmp/prospero-test-events",
  mcpServerJsPath: "/fake/mcp/server.js",
  ...overrides,
});
```

- [ ] **Step 2: Note**

No typecheck yet — `test-fixtures.ts` imports `McpServerProcess` from `mcp-relay.ts`, which Task 4 creates. It is committed together with Task 4. Proceed directly to Task 4.

---

## Task 4: `mcp-relay.ts` — the per-agent MCP relay

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.test.ts`

When a remote agent's `claude` launches its MCP bridge, the host spawns the real `mcp/server.js` (host-side, direct SQLite) and the `McpRelay` ferries JSON-RPC lines between it and the wire `mcp-data` channel. Mind the framing asymmetry (see Context).

- [ ] **Step 1: Write the failing test — `mcp-relay.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { McpRelay, type McpServerSpawner } from "./mcp-relay.js";
import { FakeMcpServer } from "./test-fixtures.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const setup = (): {
  fake: FakeMcpServer;
  sent: { agentId: string; line: string }[];
  relay: McpRelay;
  spawnArgs: { path: string; env: Record<string, string> }[];
} => {
  const fake = new FakeMcpServer();
  const sent: { agentId: string; line: string }[] = [];
  const spawnArgs: { path: string; env: Record<string, string> }[] = [];
  const spawnMcpServer: McpServerSpawner = (path, env) => {
    spawnArgs.push({ path, env });
    return fake;
  };
  const relay = new McpRelay({
    agentId: "agent_1",
    mcpServerJsPath: "/fake/mcp/server.js",
    env: { AGENT_ID: "agent_1", COMPANY_ID: "co_1" },
    sendMcpData: (agentId, line) => sent.push({ agentId, line }),
    spawnMcpServer,
  });
  return { fake, sent, relay, spawnArgs };
};

describe("McpRelay", () => {
  it("spawns the MCP server with the given path and env on start", () => {
    const { relay, spawnArgs } = setup();
    relay.start();
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.path).toBe("/fake/mcp/server.js");
    expect(spawnArgs[0]?.env).toMatchObject({ AGENT_ID: "agent_1", COMPANY_ID: "co_1" });
  });

  it("writes an inbound line to the MCP server stdin with a trailing newline", async () => {
    const { fake, relay } = setup();
    relay.start();
    relay.handleData('{"jsonrpc":"2.0","id":1}');
    await tick();
    expect(fake.stdinWrites.join("")).toBe('{"jsonrpc":"2.0","id":1}\n');
  });

  it("does not double the newline when an inbound line already ends with one", async () => {
    const { fake, relay } = setup();
    relay.start();
    relay.handleData('{"jsonrpc":"2.0"}\n');
    await tick();
    expect(fake.stdinWrites.join("")).toBe('{"jsonrpc":"2.0"}\n');
  });

  it("frames MCP server stdout into newline-terminated mcp-data lines", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await tick();
    expect(sent).toEqual([
      { agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1,"result":{}}\n' },
    ]);
  });

  it("splits a multi-line stdout chunk into separate mcp-data lines", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"a":1}\n{"b":2}\n');
    await tick();
    expect(sent.map((s) => s.line)).toEqual(['{"a":1}\n', '{"b":2}\n']);
  });

  it("buffers a stdout line split across chunks", async () => {
    const { fake, sent, relay } = setup();
    relay.start();
    fake.emitStdout('{"jsonrpc"');
    fake.emitStdout(':"2.0"}\n');
    await tick();
    expect(sent).toEqual([{ agentId: "agent_1", line: '{"jsonrpc":"2.0"}\n' }]);
  });

  it("kills the MCP server on stop", () => {
    const { fake, relay } = setup();
    relay.start();
    relay.stop();
    expect(fake.killed).toBe(true);
  });

  it("ignores a second start", () => {
    const { relay, spawnArgs } = setup();
    relay.start();
    relay.start();
    expect(spawnArgs).toHaveLength(1);
  });
});

void vi;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `mcp-relay.ts`**

```ts
import { spawn } from "node:child_process";
import { LineFramer } from "@prospero/shared";

/** The minimal slice of a spawned MCP server process the relay drives. */
export type McpServerProcess = {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  kill(): void;
  on(event: "exit", listener: (code: number | null) => void): void;
};

/** Spawns the host `mcp/server.js` for one agent. Injectable for tests. */
export type McpServerSpawner = (
  mcpServerJsPath: string,
  env: Record<string, string>,
) => McpServerProcess;

export type McpRelayDeps = {
  agentId: string;
  /** Absolute path of the bundled host MCP server entry (dist/mcp/server.js). */
  mcpServerJsPath: string;
  /** AGENT_ID / COMPANY_ID / DB_PATH / PERMISSIONS_DIR / EVENTS_DIR. */
  env: Record<string, string>;
  /** Sends one newline-terminated MCP line back to the runner. */
  sendMcpData: (agentId: string, line: string) => void;
  spawnMcpServer?: McpServerSpawner;
};

// In Electron's main process, process.execPath is electron.exe; ELECTRON_RUN_AS_NODE
// makes it behave as plain Node for the child (mirrors orchestrator/mcp-config.ts).
const realSpawnMcpServer: McpServerSpawner = (mcpServerJsPath, env) => {
  const isElectronBinary = /electron(\.exe)?$/i.test(process.execPath);
  return spawn(process.execPath, [mcpServerJsPath], {
    env: {
      ...process.env,
      ...env,
      ...(isElectronBinary ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
};

/**
 * Per-agent MCP relay. When a remote agent's claude launches its MCP bridge,
 * the host spawns the real `mcp/server.js` here (host-side, direct SQLite
 * access) and ferries JSON-RPC lines between it and the runner's wire channel
 * (design §6). runner -> host mcp-data lines arrive newline-stripped; host ->
 * runner lines must carry the newline the bridge writes verbatim to claude.
 */
export class McpRelay {
  private readonly deps: McpRelayDeps;
  private server: McpServerProcess | null = null;
  private readonly framer = new LineFramer();

  constructor(deps: McpRelayDeps) {
    this.deps = deps;
  }

  /** Spawns the host MCP server and pipes its stdout back to the runner. */
  start(): void {
    if (this.server !== null) return;
    const spawnFn = this.deps.spawnMcpServer ?? realSpawnMcpServer;
    const server = spawnFn(this.deps.mcpServerJsPath, this.deps.env);
    this.server = server;
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => {
      for (const line of this.framer.push(chunk)) {
        this.deps.sendMcpData(this.deps.agentId, line + "\n");
      }
    });
  }

  /** Writes one inbound MCP line (from the runner) to the server's stdin. */
  handleData(line: string): void {
    const framed = line.endsWith("\n") ? line : line + "\n";
    this.server?.stdin?.write(framed);
  }

  /** Kills the host MCP server. */
  stop(): void {
    this.server?.kill();
    this.server = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @prospero/main typecheck` then `pnpm --filter @prospero/main lint`
Expected: both clean (this also typechecks `test-fixtures.ts` from Task 3).

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/mcp-relay.test.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-fixtures.ts
git commit -m "feat(m10): per-agent mcp relay"
```

---

## Task 5: `adapter.ts` — `ClaudeRemoteDockerAdapter`

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts`

The adapter implements `AgentAdapter`, per-agent. It drives the shared `RemoteConnectionManager`, parses runner `stdout` lines into `ParsedEvent`s with `parseStreamLine`, accumulates usage, and owns a per-agent `McpRelay`. `connectionManager` and `spawnMcpServer` are injectable so the test runs against a real `RemoteConnectionManager` + `FakeRunner` + `FakeMcpServer` — exercising the genuine wire round-trip end to end (design §9).

- [ ] **Step 1: Write the failing test — `adapter.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import type { ParsedEvent } from "@prospero/shared";
import { ClaudeRemoteDockerAdapter } from "./adapter.js";
import { RemoteConnectionManager } from "./connection-manager.js";
import { createMemoryTransportPair } from "./memory-transport.js";
import { FakeRunner } from "./fake-runner.js";
import { FakeMcpServer, makeSpawnContext } from "./test-fixtures.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const setup = (): {
  runner: FakeRunner;
  manager: RemoteConnectionManager;
  fakeMcp: FakeMcpServer;
  adapter: ClaudeRemoteDockerAdapter;
} => {
  const pair = createMemoryTransportPair();
  const runner = new FakeRunner(pair.b);
  const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
  const fakeMcp = new FakeMcpServer();
  const adapter = new ClaudeRemoteDockerAdapter(makeSpawnContext(), {
    connectionManager: manager,
    spawnMcpServer: () => fakeMcp,
  });
  return { runner, manager, fakeMcp, adapter };
};

describe("ClaudeRemoteDockerAdapter", () => {
  it("reports its adapter name and agent id", () => {
    const { adapter } = setup();
    expect(adapter.name).toBe("claude-oauth-remote-docker");
    expect(adapter.agentId).toBe("agent_1");
  });

  it("spawns the agent on the runner when started", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    expect(runner.spawned).toEqual(["agent_1"]);
    expect(adapter.isAlive()).toBe(true);
  });

  it("is not alive before start", () => {
    const { adapter } = setup();
    expect(adapter.isAlive()).toBe(false);
  });

  it("rejects start without an oauth token", async () => {
    const pair = createMemoryTransportPair();
    new FakeRunner(pair.b);
    const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
    const ctx = makeSpawnContext();
    delete ctx.oauthToken;
    const adapter = new ClaudeRemoteDockerAdapter(ctx, { connectionManager: manager });
    await expect(adapter.start()).rejects.toThrow(/oauthToken/);
  });

  it("rejects a second start", async () => {
    const { adapter } = setup();
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow(/already started/);
  });

  it("parses a stdout line into a ParsedEvent", async () => {
    const { runner, adapter } = setup();
    const events: ParsedEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start();
    runner.emitStdout(
      "agent_1",
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess_1" }),
    );
    expect(events).toContainEqual({ kind: "session-init", sessionId: "sess_1" });
  });

  it("accumulates usage from turn-complete events", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    runner.emitStdout(
      "agent_1",
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 40 },
      }),
    );
    expect(adapter.getUsage()).toEqual({
      input: 100,
      output: 40,
      cache_read: 0,
      cache_creation: 0,
    });
  });

  it("forwards stderr lines to stderr listeners", async () => {
    const { runner, adapter } = setup();
    const lines: string[] = [];
    adapter.onStderr((l) => lines.push(l));
    await adapter.start();
    runner.emitStderr("agent_1", "a warning");
    expect(lines).toEqual(["a warning"]);
  });

  it("sends input as a JSONL user message", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    adapter.sendInput("hello");
    await Promise.resolve();
    expect(runner.stdinWrites).toEqual([
      {
        agentId: "agent_1",
        line:
          JSON.stringify({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "hello" }] },
          }) + "\n",
      },
    ]);
  });

  it("kills the agent on the runner and goes not-alive", async () => {
    const { runner, adapter } = setup();
    await adapter.start();
    adapter.kill();
    await Promise.resolve();
    expect(runner.killed).toEqual(["agent_1"]);
    expect(adapter.isAlive()).toBe(false);
  });

  it("emits exit and goes not-alive when the runner reports exit", async () => {
    const { runner, adapter } = setup();
    const exits: (number | null)[] = [];
    adapter.onExit((c) => exits.push(c));
    await adapter.start();
    runner.emitExit("agent_1", 0);
    expect(exits).toEqual([0]);
    expect(adapter.isAlive()).toBe(false);
  });

  it("relays MCP traffic between the runner and the host MCP server", async () => {
    const { runner, fakeMcp, adapter } = setup();
    await adapter.start();
    runner.emitMcpOpen("agent_1");
    runner.emitMcpData("agent_1", '{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await tick();
    expect(fakeMcp.stdinWrites.join("")).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
    );
    fakeMcp.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await tick();
    expect(runner.mcpDataFromHost).toContainEqual({
      agentId: "agent_1",
      line: '{"jsonrpc":"2.0","id":1,"result":{}}\n',
    });
  });

  it("stops the MCP relay when the agent exits", async () => {
    const { runner, fakeMcp, adapter } = setup();
    await adapter.start();
    runner.emitMcpOpen("agent_1");
    runner.emitExit("agent_1", 0);
    expect(fakeMcp.killed).toBe(true);
  });
});

void vi;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `adapter.ts`**

```ts
import type {
  AgentAdapter,
  AdapterEventListener,
  AdapterName,
  ParsedEvent,
  SpawnContext,
  UsageEstimate,
} from "@prospero/shared";
import { buildClaudeArgs } from "../claude-oauth-local/build-args.js";
import { parseStreamLine } from "../claude-oauth-local/stream-parser.js";
import { resolveMcpServerPath } from "../../mcp-handshake.js";
import { getRemoteConnectionManager, type RemoteConnectionManager } from "./connection-manager.js";
import { McpRelay, type McpServerSpawner } from "./mcp-relay.js";

/** Injectable dependencies — overridden in tests. */
export type RemoteAdapterDeps = {
  connectionManager?: RemoteConnectionManager;
  spawnMcpServer?: McpServerSpawner;
};

/**
 * Runs an agent's `claude` process inside a remote Docker container. Per-agent
 * (one instance per agentId); translates the AgentAdapter surface into wire
 * messages over the shared RemoteConnectionManager, and runs a per-agent MCP
 * relay so the container's tools reach the host's dashboard MCP server.
 */
export class ClaudeRemoteDockerAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-oauth-remote-docker";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private readonly connectionManager: RemoteConnectionManager;
  private readonly spawnMcpServer: McpServerSpawner | undefined;
  private started = false;
  private alive = false;
  private relay: McpRelay | null = null;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  constructor(ctx: SpawnContext, deps: RemoteAdapterDeps = {}) {
    this.ctx = ctx;
    this.agentId = ctx.agent.id;
    this.connectionManager = deps.connectionManager ?? getRemoteConnectionManager();
    this.spawnMcpServer = deps.spawnMcpServer;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }
    this.started = true;
    if (this.ctx.oauthToken === undefined) {
      throw new Error("claude-oauth-remote-docker requires oauthToken in SpawnContext");
    }
    // null mcpConfigPath: the runner appends the MCP triplet with the
    // container-local mcp.json path (design §4.3).
    const args = buildClaudeArgs(this.ctx.agent, null, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
    });
    const mcpServerJsPath = resolveMcpServerPath(this.ctx.mcpServerJsPath);
    const mcpEnv = {
      AGENT_ID: this.ctx.agent.id,
      COMPANY_ID: this.ctx.agent.companyId,
      DB_PATH: this.ctx.dbPath,
      PERMISSIONS_DIR: this.ctx.permissionsDir,
      EVENTS_DIR: this.ctx.eventsDir,
    };
    try {
      await this.connectionManager.spawnAgent({
        agentId: this.agentId,
        args,
        oauthToken: this.ctx.oauthToken,
        callbacks: {
          onStdout: (line) => {
            const parsed = parseStreamLine(line);
            if (parsed !== null) this.handleParsedEvent(parsed);
          },
          onStderr: (line) => this.emitStderr(line),
          onExit: (code) => {
            this.alive = false;
            this.relay?.stop();
            this.relay = null;
            this.emitExit(code);
          },
          onMcpOpen: () => {
            this.relay?.stop();
            this.relay = new McpRelay({
              agentId: this.agentId,
              mcpServerJsPath,
              env: mcpEnv,
              sendMcpData: (id, line) => this.connectionManager.sendMcpData(id, line),
              ...(this.spawnMcpServer !== undefined
                ? { spawnMcpServer: this.spawnMcpServer }
                : {}),
            });
            this.relay.start();
          },
          onMcpData: (line) => this.relay?.handleData(line),
          onMcpClose: () => {
            this.relay?.stop();
            this.relay = null;
          },
        },
      });
    } catch (e) {
      this.alive = false;
      throw e;
    }
    this.alive = true;
  }

  sendInput(text: string): void {
    if (!this.alive) return;
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    this.connectionManager.sendStdin(this.agentId, payload + "\n");
  }

  onEvent(cb: AdapterEventListener<ParsedEvent>): () => void {
    this.eventListeners.add(cb);
    return (): void => {
      this.eventListeners.delete(cb);
    };
  }

  onStderr(cb: AdapterEventListener<string>): () => void {
    this.stderrListeners.add(cb);
    return (): void => {
      this.stderrListeners.delete(cb);
    };
  }

  onExit(cb: AdapterEventListener<number | null>): () => void {
    this.exitListeners.add(cb);
    return (): void => {
      this.exitListeners.delete(cb);
    };
  }

  kill(): void {
    this.alive = false;
    this.connectionManager.killAgent(this.agentId);
    this.relay?.stop();
    this.relay = null;
  }

  isAlive(): boolean {
    return this.alive;
  }

  getUsage(): UsageEstimate {
    return { ...this.usage };
  }

  getCurrentAction(): string | null {
    return this.currentAction;
  }

  private handleParsedEvent(event: ParsedEvent): void {
    if (event.kind === "turn-complete" && event.usage !== undefined) {
      this.usage.input += event.usage.input;
      this.usage.output += event.usage.output;
      this.usage.cache_creation += event.usage.cache_creation;
      this.usage.cache_read += event.usage.cache_read;
    }
    for (const cb of this.eventListeners) cb(event);
  }

  private emitStderr(line: string): void {
    for (const cb of this.stderrListeners) cb(line);
  }

  private emitExit(code: number | null): void {
    for (const cb of this.exitListeners) cb(code);
  }
}
```

Note — `currentAction` is declared and returned but never assigned, mirroring `ClaudeOAuthLocalAdapter` exactly: per-action state is derived by the orchestrator from `ParsedEvent`s, not tracked in the adapter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts
git commit -m "feat(m10): claude remote docker adapter"
```

---

## Task 6: Register the adapter + count it toward the ToS cap

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/index.ts`
- Modify: `apps/main/src/orchestrator/lifecycle.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts` (add one case)

Register the factory so `createAdapter("claude-oauth-remote-docker", ctx)` works, and add the adapter to the OAuth ToS cap in `ensureAdapter` (design §3.2 — the 4-agent cap counts remote OAuth agents).

- [ ] **Step 1: Write the failing test — add to `adapter.test.ts`**

Add this import at the top of `adapter.test.ts`:

```ts
import { createAdapter } from "../index.js";
```

And add this `describe` block at the end of the file (before the trailing `void vi;`):

```ts
describe("createAdapter — claude-oauth-remote-docker", () => {
  it("resolves the remote docker adapter from the registry", () => {
    const adapter = createAdapter("claude-oauth-remote-docker", makeSpawnContext());
    expect(adapter.name).toBe("claude-oauth-remote-docker");
    expect(adapter.agentId).toBe("agent_1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts`
Expected: FAIL — `createAdapter` throws `Adapter 'claude-oauth-remote-docker' is not implemented yet`.

- [ ] **Step 3: Modify `adapters/index.ts`**

Add the import beside the existing adapter imports:

```ts
import { ClaudeRemoteDockerAdapter } from "./claude-oauth-remote-docker/adapter.js";
```

Add the factory beside the existing factories:

```ts
const claudeOAuthRemoteDockerFactory: AgentAdapterFactory = {
  name: "claude-oauth-remote-docker",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeRemoteDockerAdapter(ctx);
  },
};
```

Replace the `claude-oauth-remote-docker` entry in `adapterRegistry`:

```ts
export const adapterRegistry: Record<AdapterName, AgentAdapterFactory | undefined> = {
  "claude-oauth-local": claudeOAuthLocalFactory,
  "claude-api-key-local": claudeApiKeyLocalFactory,
  "claude-oauth-remote-docker": claudeOAuthRemoteDockerFactory,
};
```

- [ ] **Step 4: Modify `lifecycle.ts`**

In `ensureAdapter`, the `isOauth` expression currently matches `"claude-oauth-local"` and `undefined`. Add the remote adapter so it counts toward the cap (design §3.2):

```ts
  // OAuth Max ToS caps parallel sessions at 4 — local and remote OAuth both
  // count (design §3.2). API key has no such cap.
  const adapterName = opts.agent.adapterName as string | undefined;
  const isOauth =
    adapterName === "claude-oauth-local" ||
    adapterName === "claude-oauth-remote-docker" ||
    adapterName === undefined;
```

(Replace the existing `const isOauth = …` block; reuse the new `adapterName` local in the `const name: AdapterName = …` line below it if convenient, or leave that line unchanged.)

- [ ] **Step 5: Run the adapter tests to verify they pass**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts`
Expected: PASS — 14 tests (13 + the registry case).

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/adapters/index.ts apps/main/src/orchestrator/lifecycle.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.test.ts
git commit -m "feat(m10): register remote docker adapter"
```

---

## Task 7: Verification gate (no regression)

**Files:** none modified — checks only.

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: clean across all 4 projects.

- [ ] **Step 2: Lint the whole repo**

Run: `pnpm lint`
Expected: clean across all 4 projects.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: 0 failures. The PR-C.1 baseline is 929 passing + 2 todo. PR-C.2 adds: build-args +1, runner spawn +1, `mcp-relay.test.ts` 8, `adapter.test.ts` 14 — **24 new tests**, new total **953 passing + 2 todo**. Confirm `apps/main` 670 → 693, `apps/agent-runner` 49 → 50, and no previously-passing test regressed.

- [ ] **Step 4: Confirm the deferred check is recorded**

No commit. The real `docker run` / `ssh` path (`createProductionTransport`, PR-C.1) and `realSpawnMcpServer` (the real `mcp/server.js` spawn) are not unit-tested — they are exercised by the PR-E local Docker smoke. Note this in the session handoff when closing PR-C.2.

---

## Self-Review (plan vs. design §5.2 / §6)

- **Design §5.2 — "`adapter.ts` — `ClaudeRemoteDockerAdapter implements AgentAdapter`. Instância per-agente … traduzindo pra mensagens wire":** Task 5. ✓
- **Design §5.2 — "`mcp-relay.ts` — na primeira mensagem MCP de um agente, spawna o `mcp/server.js` real como subprocesso do host … e liga o stdio dele ↔ canal MCP wire":** Task 4 — `McpRelay` spawns on `start()` (driven by the adapter's `onMcpOpen`), pipes both directions. ✓
- **Design §4.3 — "`buildClaudeArgs` … omite `--mcp-config` / `--strict-mcp-config` / `--permission-prompt-tool`":** Task 1 — `mcpConfigPath: string | null`, `null` omits the triplet. ✓
- **Design §6 — MCP relay round-trip; `mcp/server.js` runs on the host with direct SQLite, writes events to the host `EVENTS_DIR`:** the relay spawns `resolveMcpServerPath(...)` with `AGENT_ID`/`COMPANY_ID`/`DB_PATH`/`PERMISSIONS_DIR`/`EVENTS_DIR` from the host `SpawnContext`. ✓
- **Design §5.1 / §8 — OAuth token arrives via the handshake and becomes the claude child's `CLAUDE_CODE_OAUTH_TOKEN`, never seeded to disk:** Task 2 closes the runner gap. ✓
- **Design §3.2 — "O cap de 4 da ToS OAuth continua valendo, contado no host":** Task 6 adds `claude-oauth-remote-docker` to `ensureAdapter`'s `isOauth`. ✓
- **Design §10 PR-C — "Registrado em `adapters/index.ts`. Testes de integração":** Task 6 registers it; `adapter.test.ts` runs the adapter against a real `RemoteConnectionManager` + `FakeRunner` + `FakeMcpServer` — a full in-process wire round-trip including MCP (design §9). ✓
- **Out of scope (→ PR-D / PR-E):** Settings UI, per-agent location selector, "test connection", i18n (PR-D); SECURITY.md, VPS runbook, Docker smoke, roadmap (PR-E).
- **Placeholder scan:** every file's full content / exact edit is inline; no TBD/TODO. The two untested paths — `createProductionTransport` and `realSpawnMcpServer` — are design-sanctioned deferrals to the PR-E smoke, called out explicitly.
- **Type consistency:** `McpServerProcess`/`McpServerSpawner` defined in `mcp-relay.ts`, consumed by `test-fixtures.ts` and `adapter.ts`; `RemoteConnectionManager`/`RemoteAgentCallbacks` from PR-C.1 used unchanged; `buildClaudeArgs(agent, null, opts)` matches the Task 1 signature; the `sendInput` JSONL payload matches `ClaudeOAuthLocalAdapter`.
