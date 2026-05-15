# M10 PR-B.3 — Agent-Runner MCP Tunnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent-runner its MCP tunnel — a `mcp-bridge` that `claude` launches as its `dashboard` MCP server, a runner-side loopback relay that muxes the bridge's traffic onto the wire as `mcp-open`/`mcp-data`/`mcp-close`, and stderr token redaction.

**Architecture:** `claude`'s `mcp.json` points its `dashboard` server `command` at the bundled `mcp-bridge` — a dumb relay that pipes MCP stdio to a loopback TCP socket the runner opened for that agent. The runner's `createMcpListener` accepts that connection and turns it into wire notifications; host→runner `mcp-data` is written back into the bridge. The spawn handler now also writes the container `mcp.json`, appends the MCP-flag triplet to the `claude` argv, and redacts secrets from forwarded stderr.

**Tech Stack:** TypeScript, Node `net`/`stream`, tsup, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md` §6. **Deviation:** the spec §5.1 named a *unix socket* for the bridge↔runner channel; this plan uses **loopback TCP** (`127.0.0.1`) — functionally identical inside the container's network namespace, and cross-platform so `createMcpListener` is testable with real sockets. PR-B is now four sub-PRs: B.1 ✅, B.2 ✅, **B.3 (this — MCP tunnel + redaction)**, B.4 (real Docker image + `compose.yml`).

**Baseline:** 899 tests passing + 2 todo. This PR adds ~16 tests in `apps/agent-runner`.

---

## File Structure

**Created (`apps/agent-runner/src/`):**
- `redact.ts` — `redactSecrets()`: masks token-shaped substrings.
- `mcp-bridge.ts` — second app entry; the relay `claude` launches as its MCP server.
- `mcp-mux.ts` — `createMcpListener()`: the runner-side loopback relay.
- `container-mcp-config.ts` — `writeContainerMcpConfig()` + `mcpTripletArgs()`.

**Created (`apps/agent-runner/tests/`):**
- `redact.test.ts`, `mcp-mux.test.ts`, `container-mcp-config.test.ts`.

**Modified:**
- `tsup.config.ts` — add the `mcp-bridge` entry.
- `src/state.ts` — `RunningAgent` gains its `McpListener`.
- `src/handlers/spawn.ts` — async; opens the MCP listener, writes `mcp.json`, appends the triplet, redacts stderr.
- `src/runner.ts` — routes `mcp-data` notifications to the bridge; injects the bridge path.
- `tests/spawn.test.ts` — updated for the async handler and MCP context.

**Conventions:** lint-staged lints `src/` *and* `tests/`; `.js` import extensions; `verbatimModuleSyntax`; `@prospero/shared` exports `LineFramer`. One test file: `pnpm --filter @prospero/agent-runner exec vitest run tests/<file>`.

---

## Task 1: Secret redaction

**Files:**
- Create: `apps/agent-runner/src/redact.ts`
- Test: `apps/agent-runner/tests/redact.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/redact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("masks an Anthropic key", () => {
    const out = redactSecrets("env CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-AbCd1234_efGh");
    expect(out).not.toContain("sk-ant-oat01-AbCd1234_efGh");
    expect(out).toContain("[redacted]");
  });

  it("masks a GitHub token", () => {
    expect(redactSecrets("token gho_AbCd1234EfGh5678IjKl")).toContain("[redacted]");
    expect(redactSecrets("token gho_AbCd1234EfGh5678IjKl")).not.toContain("gho_AbCd1234EfGh5678IjKl");
  });

  it("masks a bearer token but keeps the Bearer prefix", () => {
    expect(redactSecrets("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("leaves text without secrets untouched", () => {
    expect(redactSecrets("a plain diagnostic line")).toBe("a plain diagnostic line");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/redact.test.ts`
Expected: FAIL — cannot resolve `../src/redact.js`.

- [ ] **Step 3: Create the redaction module**

Create `apps/agent-runner/src/redact.ts`:

```ts
type SecretPattern = { re: RegExp; replacement: string };

// Token shapes worth masking before a stderr line leaves the container.
const SECRET_PATTERNS: SecretPattern[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{8,}/g, replacement: "[redacted]" },
  { re: /\bgh[opsu]_[A-Za-z0-9]{16,}\b/g, replacement: "[redacted]" },
  { re: /Bearer\s+[A-Za-z0-9._-]{12,}/gi, replacement: "Bearer [redacted]" },
];

/** Masks token-shaped substrings so forwarded stderr never leaks a credential. */
export const redactSecrets = (line: string): string => {
  let out = line;
  for (const { re, replacement } of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/redact.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/redact.ts apps/agent-runner/tests/redact.test.ts
git commit -m "feat(m10): stderr secret redaction"
```

---

## Task 2: mcp-bridge entry + tsup wiring

**Files:**
- Create: `apps/agent-runner/src/mcp-bridge.ts`
- Modify: `apps/agent-runner/tsup.config.ts`

- [ ] **Step 1: Create the bridge entry**

Create `apps/agent-runner/src/mcp-bridge.ts`:

```ts
import { connect } from "node:net";

// claude spawns this as its `dashboard` MCP server (see the mcp.json the runner
// writes). It is a dumb relay: claude's MCP stdio is piped to a loopback TCP
// socket the runner is listening on, and back. The runner muxes that traffic
// onto the wire protocol. This file is an entry point — it has no exports and
// is verified by the PR-E Docker smoke, not by unit tests.
const port = Number(process.env["PROSPERO_MCP_PORT"]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("mcp-bridge: PROSPERO_MCP_PORT missing or invalid\n");
  process.exit(1);
}

const socket = connect(port, "127.0.0.1");
socket.on("connect", () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on("close", () => process.exit(0));
socket.on("error", (err) => {
  process.stderr.write(`mcp-bridge: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the bridge to the tsup build**

Replace the `entry` line in `apps/agent-runner/tsup.config.ts`:

```ts
  entry: ["src/index.ts", "src/mcp-bridge.ts"],
```

- [ ] **Step 3: Verify the build produces both bundles**

Run: `pnpm --filter @prospero/agent-runner build`
Expected: tsup succeeds; both `apps/agent-runner/dist/index.js` and `apps/agent-runner/dist/mcp-bridge.js` exist.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/mcp-bridge.ts apps/agent-runner/tsup.config.ts
git commit -m "feat(m10): mcp-bridge entry"
```

---

## Task 3: Runner-side MCP listener

**Files:**
- Create: `apps/agent-runner/src/mcp-mux.ts`
- Test: `apps/agent-runner/tests/mcp-mux.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/mcp-mux.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { createMcpListener } from "../src/mcp-mux.js";

type Notification = { method: string; params: unknown };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("createMcpListener", () => {
  it("emits mcp-open on connect and mcp-data per line from the bridge", async () => {
    const notifications: Notification[] = [];
    const listener = await createMcpListener("agent_1", {
      notify: (method, params) => notifications.push({ method, params }),
    });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.write('{"jsonrpc":"2.0","id":1}\n');
    await tick();
    expect(notifications).toContainEqual({ method: "mcp-open", params: { agentId: "agent_1" } });
    expect(notifications).toContainEqual({
      method: "mcp-data",
      params: { agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1}' },
    });
    client.destroy();
    listener.close();
  });

  it("writes host data into the connected bridge", async () => {
    const listener = await createMcpListener("agent_2", { notify: () => {} });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.setEncoding("utf8");
    listener.writeToBridge('{"jsonrpc":"2.0","result":{}}\n');
    const [chunk] = (await once(client, "data")) as [string];
    expect(chunk).toBe('{"jsonrpc":"2.0","result":{}}\n');
    client.destroy();
    listener.close();
  });

  it("emits mcp-close when the bridge disconnects", async () => {
    const notifications: Notification[] = [];
    const listener = await createMcpListener("agent_3", {
      notify: (method, params) => notifications.push({ method, params }),
    });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.destroy();
    await tick();
    expect(notifications).toContainEqual({ method: "mcp-close", params: { agentId: "agent_3" } });
    listener.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/mcp-mux.test.ts`
Expected: FAIL — cannot resolve `../src/mcp-mux.js`.

- [ ] **Step 3: Create the MCP mux module**

Create `apps/agent-runner/src/mcp-mux.ts`:

```ts
import { createServer, type Socket } from "node:net";
import { LineFramer } from "@prospero/shared";

export type McpListener = {
  /** The 127.0.0.1 port the agent's mcp-bridge connects to. */
  readonly port: number;
  /** Write one MCP JSON-RPC line from the host into the bridge. */
  writeToBridge(line: string): void;
  /** Stop accepting connections and close the channel. */
  close(): void;
};

export type McpListenerDeps = {
  notify: (method: string, params: unknown) => void;
};

/**
 * Starts a loopback TCP server for one agent's mcp-bridge. On connect it emits
 * `mcp-open`; each line the bridge sends becomes an `mcp-data` notification;
 * disconnect emits `mcp-close`. The returned promise resolves once the server
 * is listening, so the caller has the port for the agent's mcp.json.
 */
export const createMcpListener = (
  agentId: string,
  deps: McpListenerDeps,
): Promise<McpListener> => {
  return new Promise((resolve) => {
    let bridge: Socket | null = null;
    const framer = new LineFramer();
    const server = createServer((socket) => {
      bridge = socket;
      deps.notify("mcp-open", { agentId });
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const line of framer.push(chunk)) deps.notify("mcp-data", { agentId, line });
      });
      socket.on("close", () => {
        bridge = null;
        deps.notify("mcp-close", { agentId });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        writeToBridge: (line) => {
          bridge?.write(line);
        },
        close: () => {
          bridge?.destroy();
          server.close();
        },
      });
    });
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/mcp-mux.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/mcp-mux.ts apps/agent-runner/tests/mcp-mux.test.ts
git commit -m "feat(m10): runner-side mcp listener"
```

---

## Task 4: Container mcp.json + the MCP triplet

**Files:**
- Create: `apps/agent-runner/src/container-mcp-config.ts`
- Test: `apps/agent-runner/tests/container-mcp-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent-runner/tests/container-mcp-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTripletArgs, writeContainerMcpConfig } from "../src/container-mcp-config.js";

describe("writeContainerMcpConfig", () => {
  it("writes an mcp.json pointing the dashboard server at the bridge", () => {
    const dir = mkdtempSync(join(tmpdir(), "prospero-mcpcfg-"));
    const path = writeContainerMcpConfig(dir, { bridgePath: "/app/mcp-bridge.js", port: 51234 });
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: { dashboard: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(config.mcpServers.dashboard.args).toEqual(["/app/mcp-bridge.js"]);
    expect(config.mcpServers.dashboard.env["PROSPERO_MCP_PORT"]).toBe("51234");
  });
});

describe("mcpTripletArgs", () => {
  it("returns the mcp-config, strict, and permission-prompt flags", () => {
    expect(mcpTripletArgs("/cfg/mcp.json")).toEqual([
      "--mcp-config",
      "/cfg/mcp.json",
      "--strict-mcp-config",
      "--permission-prompt-tool",
      "mcp__dashboard__request_permission",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/container-mcp-config.test.ts`
Expected: FAIL — cannot resolve `../src/container-mcp-config.js`.

- [ ] **Step 3: Create the module**

Create `apps/agent-runner/src/container-mcp-config.ts`:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type McpConfigOptions = {
  /** Absolute path to the bundled mcp-bridge.js inside the container. */
  bridgePath: string;
  /** The loopback port the bridge should connect to. */
  port: number;
};

/**
 * Writes the container `mcp.json` that makes claude launch the mcp-bridge as
 * its `dashboard` MCP server. The bridge connects back to the runner on `port`.
 * Returns the path of the written file.
 */
export const writeContainerMcpConfig = (configDir: string, opts: McpConfigOptions): string => {
  const path = join(configDir, "mcp.json");
  const config = {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: process.execPath,
        args: [opts.bridgePath],
        env: { PROSPERO_MCP_PORT: String(opts.port) },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config), "utf8");
  return path;
};

/**
 * The MCP-flag triplet the runner appends to the host-built `claude` argv:
 * point claude at our mcp.json, ignore any other MCP servers, and route
 * permission prompts through the dashboard tool.
 */
export const mcpTripletArgs = (mcpConfigPath: string): string[] => [
  "--mcp-config",
  mcpConfigPath,
  "--strict-mcp-config",
  "--permission-prompt-tool",
  "mcp__dashboard__request_permission",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/container-mcp-config.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @prospero/agent-runner typecheck` — no errors.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/container-mcp-config.ts apps/agent-runner/tests/container-mcp-config.test.ts
git commit -m "feat(m10): container mcp.json and triplet args"
```

---

## Task 5: RunningAgent gains its MCP listener

**Files:**
- Modify: `apps/agent-runner/src/state.ts`

- [ ] **Step 1: Add the listener to RunningAgent**

In `apps/agent-runner/src/state.ts`, add the import and the field. Replace the import block and the `RunningAgent` type:

```ts
import type { WireCredentials } from "@prospero/shared";
import type { ClaudeProcess } from "./claude-process.js";
import type { AgentSandbox } from "./sandbox.js";
import type { McpListener } from "./mcp-mux.js";

/** A spawned agent the runner is managing. */
export type RunningAgent = {
  readonly child: ClaudeProcess;
  readonly sandbox: AgentSandbox;
  readonly mcp: McpListener;
};
```

- [ ] **Step 2: Verify typecheck fails where RunningAgent is constructed**

Run: `pnpm --filter @prospero/agent-runner typecheck`
Expected: FAIL — `handleSpawn`, plus the `stdin-write`/`kill`/`health` tests, construct `RunningAgent` without `mcp`. These are fixed in Tasks 6 and 8.

- [ ] **Step 3: Commit the type change**

Run: `pnpm --filter @prospero/agent-runner lint` — no errors (lint does not need a clean typecheck).

```bash
git add apps/agent-runner/src/state.ts
git commit -m "feat(m10): mcp listener on running agent"
```

> Typecheck is intentionally red between this task and Task 8 — the constructing call sites are updated there.

---

## Task 6: Integrate the MCP tunnel into the spawn handler

**Files:**
- Modify: `apps/agent-runner/src/handlers/spawn.ts`
- Modify: `apps/agent-runner/tests/spawn.test.ts`

- [ ] **Step 1: Rewrite the spawn test for the async, MCP-aware handler**

Replace the contents of `apps/agent-runner/tests/spawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireHandlerError } from "@prospero/shared";
import { handleSpawn, type SpawnContext } from "../src/handlers/spawn.js";
import { createRunnerState } from "../src/state.js";
import type { McpListener } from "../src/mcp-mux.js";
import { FakeClaude } from "./fake-claude.js";

type Notification = { method: string; params: unknown };

const fakeMcpListener = (): McpListener => ({
  port: 50000,
  writeToBridge: () => {},
  close: () => {},
});

const makeContext = (fake: FakeClaude): { ctx: SpawnContext; notifications: Notification[] } => {
  const notifications: Notification[] = [];
  const ctx: SpawnContext = {
    state: createRunnerState(),
    notify: (method, params) => notifications.push({ method, params }),
    spawnClaude: () => fake,
    prepareSandbox: (agentId) => {
      const root = mkdtempSync(join(tmpdir(), "prospero-spawn-"));
      return { configDir: join(root, agentId), workDir: join(root, agentId) };
    },
    createMcpListener: () => Promise.resolve(fakeMcpListener()),
    mcpBridgePath: "/app/mcp-bridge.js",
  };
  return { ctx, notifications };
};

const validParams = { agentId: "agent_1", args: ["--model", "claude-sonnet-4-6"] };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("handleSpawn", () => {
  it("registers the agent and returns its pid", async () => {
    const { ctx } = makeContext(new FakeClaude());
    const result = await handleSpawn(validParams, ctx);
    expect(result).toEqual({ pid: 4242 });
    expect(ctx.state.agents.has("agent_1")).toBe(true);
  });

  it("appends the MCP triplet to the claude argv", async () => {
    const fake = new FakeClaude();
    const { ctx } = makeContext(fake);
    let seenArgs: string[] = [];
    ctx.spawnClaude = (opts) => {
      seenArgs = opts.args;
      return fake;
    };
    await handleSpawn(validParams, ctx);
    expect(seenArgs).toContain("--strict-mcp-config");
    expect(seenArgs).toContain("mcp__dashboard__request_permission");
    expect(seenArgs.slice(0, 2)).toEqual(["--model", "claude-sonnet-4-6"]);
  });

  it("forwards a stdout line as a stdout notification", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitStdout('{"type":"system"}\n');
    await tick();
    expect(notifications).toContainEqual({
      method: "stdout",
      params: { agentId: "agent_1", line: '{"type":"system"}' },
    });
  });

  it("redacts secrets from forwarded stderr", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitStderr("auth failed for sk-ant-oat01-LeakedToken123\n");
    await tick();
    const stderr = notifications.find((n) => n.method === "stderr");
    expect(stderr?.params).toEqual({ agentId: "agent_1", line: "auth failed for [redacted]" });
  });

  it("emits an exit notification and deregisters on child exit", async () => {
    const fake = new FakeClaude();
    const { ctx, notifications } = makeContext(fake);
    await handleSpawn(validParams, ctx);
    fake.emitExit(0);
    expect(notifications).toContainEqual({
      method: "exit",
      params: { agentId: "agent_1", code: 0 },
    });
    expect(ctx.state.agents.has("agent_1")).toBe(false);
  });

  it("throws spawnFailed (1020) when the agent is already running", async () => {
    const { ctx } = makeContext(new FakeClaude());
    await handleSpawn(validParams, ctx);
    let caught: unknown;
    try {
      await handleSpawn(validParams, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1020);
  });

  it("throws protocolMismatch (1030) on malformed params", async () => {
    const { ctx } = makeContext(new FakeClaude());
    let caught: unknown;
    try {
      await handleSpawn({ agentId: "agent_1" }, ctx);
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/spawn.test.ts`
Expected: FAIL — `SpawnContext` has no `createMcpListener`/`mcpBridgePath`, and `handleSpawn` is not async.

- [ ] **Step 3: Rewrite the spawn handler**

Replace the contents of `apps/agent-runner/src/handlers/spawn.ts`:

```ts
import { z } from "zod";
import { LineFramer, WireErrorCode, WireHandlerError, type SpawnResult } from "@prospero/shared";
import type { ClaudeSpawner } from "../claude-process.js";
import type { AgentSandbox } from "../sandbox.js";
import type { McpListener } from "../mcp-mux.js";
import type { RunnerState } from "../state.js";
import { redactSecrets } from "../redact.js";
import { mcpTripletArgs, writeContainerMcpConfig } from "../container-mcp-config.js";

/** Dependencies the spawn handler needs beyond the runner state. */
export type SpawnContext = {
  state: RunnerState;
  notify: (method: string, params: unknown) => void;
  spawnClaude: ClaudeSpawner;
  prepareSandbox: (agentId: string) => AgentSandbox;
  createMcpListener: (agentId: string) => Promise<McpListener>;
  /** Absolute path of the bundled mcp-bridge.js inside the container. */
  mcpBridgePath: string;
};

const spawnParamsSchema = z.object({
  agentId: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

// Forwards a child stream as line-delimited wire notifications, applying an
// optional per-line transform (stderr is redacted; stdout passes through).
const forwardLines = (
  stream: NodeJS.ReadableStream | null,
  method: string,
  agentId: string,
  notify: SpawnContext["notify"],
  transform: (line: string) => string = (line) => line,
): void => {
  if (stream === null) return;
  const framer = new LineFramer();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of framer.push(chunk)) notify(method, { agentId, line: transform(line) });
  });
};

/**
 * Validates a spawn request, prepares the agent's sandbox, opens its MCP
 * listener, writes the container mcp.json, spawns `claude` with the MCP triplet
 * appended to the host-built argv, registers it, and wires stdout/stderr/exit
 * to wire notifications. Throws WireHandlerError on bad params or a duplicate.
 */
export const handleSpawn = async (params: unknown, ctx: SpawnContext): Promise<SpawnResult> => {
  const parsed = spawnParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "spawn: invalid params");
  }
  const { agentId, args, env } = parsed.data;
  if (ctx.state.agents.has(agentId)) {
    throw new WireHandlerError(
      WireErrorCode.spawnFailed,
      `spawn: agent '${agentId}' already running`,
    );
  }

  const sandbox = ctx.prepareSandbox(agentId);
  const mcp = await ctx.createMcpListener(agentId);
  const mcpConfigPath = writeContainerMcpConfig(sandbox.configDir, {
    bridgePath: ctx.mcpBridgePath,
    port: mcp.port,
  });

  const child = ctx.spawnClaude({
    command: "claude",
    args: [...args, ...mcpTripletArgs(mcpConfigPath)],
    env: { ...(env ?? {}), CLAUDE_CONFIG_DIR: sandbox.configDir },
    cwd: sandbox.workDir,
  });

  forwardLines(child.stdout, "stdout", agentId, ctx.notify);
  forwardLines(child.stderr, "stderr", agentId, ctx.notify, redactSecrets);
  child.on("exit", (code) => {
    ctx.notify("exit", { agentId, code });
    mcp.close();
    ctx.state.agents.delete(agentId);
  });

  ctx.state.agents.set(agentId, { child, sandbox, mcp });
  return { pid: child.pid ?? -1 };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/spawn.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Typecheck still reports the `stdin-write`/`kill`/`health` test call sites (fixed in Task 8) — that is expected. Confirm `src/handlers/spawn.ts` itself has no error:

Run: `pnpm --filter @prospero/agent-runner exec tsc --noEmit 2>&1 | grep "handlers/spawn.ts" || echo "spawn.ts clean"`
Expected: `spawn.ts clean`.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/handlers/spawn.ts apps/agent-runner/tests/spawn.test.ts
git commit -m "feat(m10): mcp tunnel and stderr redaction in spawn"
```

---

## Task 7: Route mcp-data and inject the bridge path

**Files:**
- Modify: `apps/agent-runner/src/runner.ts`
- Modify: `apps/agent-runner/tests/runner.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `apps/agent-runner/tests/runner.test.ts` (the `FakeClaude` import already exists):

```ts
it("routes an inbound mcp-data notification to the agent's bridge", async () => {
  const pair = createMemoryTransportPair();
  const fake = new FakeClaude();
  const written: string[] = [];
  const runner = createRunner(pair.a, {
    spawnClaude: () => fake,
    prepareSandbox: (agentId) => ({ configDir: `/c/${agentId}`, workDir: `/w/${agentId}` }),
    createMcpListener: (agentId) =>
      Promise.resolve({
        port: 50000,
        writeToBridge: (line) => written.push(line),
        close: () => {},
      }),
    mcpBridgePath: "/app/mcp-bridge.js",
  });
  pair.b.send(
    encodeWireMessage({
      type: "request",
      id: "msg_s",
      method: "spawn",
      params: { agentId: "agent_1", args: [] },
    }),
  );
  await Promise.resolve();
  await Promise.resolve();
  pair.b.send(
    encodeWireMessage({
      type: "notification",
      method: "mcp-data",
      params: { agentId: "agent_1", line: '{"jsonrpc":"2.0"}\n' },
    }),
  );
  expect(written).toEqual(['{"jsonrpc":"2.0"}\n']);
  expect(runner.state.agents.has("agent_1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/runner.test.ts`
Expected: FAIL — `RunnerDeps` has no `createMcpListener`/`mcpBridgePath`, and inbound `mcp-data` is not routed.

- [ ] **Step 3: Update the runner module**

Replace the contents of `apps/agent-runner/src/runner.ts`:

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WireServer, type WireTransport } from "@prospero/shared";
import { createRunnerState, type RunnerState } from "./state.js";
import { spawnClaude as realSpawnClaude, type ClaudeSpawner } from "./claude-process.js";
import { prepareAgentSandbox } from "./sandbox.js";
import type { AgentSandbox } from "./sandbox.js";
import { createMcpListener as realCreateMcpListener } from "./mcp-mux.js";
import type { McpListener } from "./mcp-mux.js";
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
  createMcpListener?: (agentId: string) => Promise<McpListener>;
  mcpBridgePath?: string;
};

// The bundled mcp-bridge sits next to index.js in dist/ (and in the image).
const defaultBridgePath = (): string => join(dirname(fileURLToPath(import.meta.url)), "mcp-bridge.js");

/**
 * Wires a WireServer over the given transport and registers the runner's
 * request handlers. The server is live as soon as this returns.
 */
export const createRunner = (transport: WireTransport, deps: RunnerDeps = {}): Runner => {
  const state = createRunnerState();
  const server = new WireServer(transport);
  const spawnClaude = deps.spawnClaude ?? realSpawnClaude;
  const prepareSandbox = deps.prepareSandbox ?? ((agentId: string) => prepareAgentSandbox(agentId));
  const notify = (method: string, params: unknown): void => server.notify(method, params);
  const createMcpListener =
    deps.createMcpListener ?? ((agentId: string) => realCreateMcpListener(agentId, { notify }));
  const mcpBridgePath = deps.mcpBridgePath ?? defaultBridgePath();

  server.handle("handshake", (params) => handleHandshake(params, state));
  server.handle("health", () => handleHealth(state));
  server.handle("spawn", (params) =>
    handleSpawn(params, { state, notify, spawnClaude, prepareSandbox, createMcpListener, mcpBridgePath }),
  );
  server.handle("stdin-write", (params) => handleStdinWrite(params, state));
  server.handle("kill", (params) => handleKill(params, state));

  // Host → bridge: write inbound MCP lines into the target agent's listener.
  server.onNotification("mcp-data", (params) => {
    const data = params as { agentId?: unknown; line?: unknown };
    if (typeof data.agentId !== "string" || typeof data.line !== "string") return;
    state.agents.get(data.agentId)?.mcp.writeToBridge(data.line);
  });

  return { server, state };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/runner.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Typecheck still reports the `stdin-write`/`kill`/`health` test call sites — fixed in Task 8. Confirm `runner.ts` itself is clean:

Run: `pnpm --filter @prospero/agent-runner exec tsc --noEmit 2>&1 | grep "runner.ts" || echo "runner.ts clean"`
Expected: `runner.ts clean`.
Run: `pnpm --filter @prospero/agent-runner lint` — no errors.

```bash
git add apps/agent-runner/src/runner.ts apps/agent-runner/tests/runner.test.ts
git commit -m "feat(m10): route mcp-data to the agent bridge"
```

---

## Task 8: Fix RunningAgent call sites in the remaining tests

**Files:**
- Modify: `apps/agent-runner/tests/stdin-write.test.ts`, `apps/agent-runner/tests/kill.test.ts`, `apps/agent-runner/tests/health.test.ts`

- [ ] **Step 1: Add a shared `mcp` stub to the three tests**

In each of `tests/stdin-write.test.ts`, `tests/kill.test.ts`, and `tests/health.test.ts`, every `state.agents.set(...)` call passes a `RunningAgent` literal that now needs an `mcp` field. Add this `mcp` value to each literal:

```ts
mcp: { port: 0, writeToBridge: () => {}, close: () => {} },
```

So a call like:

```ts
state.agents.set("agent_1", { child: fake, sandbox: { configDir: "/c", workDir: "/w" } });
```

becomes:

```ts
state.agents.set("agent_1", {
  child: fake,
  sandbox: { configDir: "/c", workDir: "/w" },
  mcp: { port: 0, writeToBridge: () => {}, close: () => {} },
});
```

Apply the same to the `state.agents.set("a1", { child: { ... }, sandbox: { ... } })` literal in `tests/health.test.ts`.

- [ ] **Step 2: Run the three test files to verify they pass**

Run: `pnpm --filter @prospero/agent-runner exec vitest run tests/stdin-write.test.ts tests/kill.test.ts tests/health.test.ts`
Expected: PASS — 3 + 3 + 3 = 9 tests.

- [ ] **Step 3: Verify the whole package typechecks**

Run: `pnpm --filter @prospero/agent-runner typecheck`
Expected: no errors — every `RunningAgent` call site now has `mcp`.

- [ ] **Step 4: Commit**

```bash
git add apps/agent-runner/tests/stdin-write.test.ts apps/agent-runner/tests/kill.test.ts apps/agent-runner/tests/health.test.ts
git commit -m "feat(m10): mcp field in running-agent test fixtures"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every package**

Run: `pnpm -r typecheck`
Expected: all 4 packages green.

- [ ] **Step 2: Lint every package**

Run: `pnpm -r lint`
Expected: all green.

- [ ] **Step 3: Run the whole test suite**

Run: `pnpm -r test`
Expected: all suites green. The 899 baseline still passes; `apps/agent-runner` adds ~16 (4 + 3 + 2 + 7 new spawn − 6 old + 1 new runner + 9 unchanged), landing around 915 total.

- [ ] **Step 4: Build both runner bundles**

Run: `pnpm --filter @prospero/agent-runner build`
Expected: tsup succeeds; `dist/index.js` and `dist/mcp-bridge.js` both exist.

- [ ] **Step 5: Confirm scope**

Run: `git diff --name-only b9aedc3..HEAD | grep -v "^docs/"` is not the right base — use the PR-B.3 plan commit. Confirm every changed file is under `apps/agent-runner/`.

---

## Self-Review notes

- **Spec coverage (§6, part of row B):** `mcp-bridge` ✓ (Task 2), runner-side relay emitting `mcp-open`/`mcp-data`/`mcp-close` ✓ (Task 3), container `mcp.json` + MCP triplet ✓ (Tasks 4, 6), host→bridge `mcp-data` routing ✓ (Task 7), stderr redaction ✓ (Tasks 1, 6). Deferred to PR-B.4: the real Docker image + `compose.yml`.
- **Transport deviation from spec §5.1:** loopback TCP instead of a unix socket — same trust boundary inside the container, cross-platform-testable. Recorded in the plan header.
- **Intentional red typecheck window:** Task 5 adds `RunningAgent.mcp`; the constructing call sites in three test files are only fixed in Task 8. Tasks 6–7 verify their own files are clean via a grep. Task 8 restores a fully-green typecheck. This keeps each task a coherent commit.
- **Placeholder scan:** none — every step has concrete code or an exact command.
- **Type consistency:** `McpListener` (`port`/`writeToBridge`/`close`, Task 3) flows through `RunningAgent.mcp` (Task 5), `SpawnContext.createMcpListener` (Task 6), and `RunnerDeps` (Task 7). `handleSpawn` is `async` and every caller (`createRunner`, the tests) `await`s it. `mcpTripletArgs`/`writeContainerMcpConfig` (Task 4) are consumed only by `handleSpawn`.
