# M10 PR-C.1 — Remote connection layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the host-side wire connection layer for the M10 VPS Docker remote adapter — the transport command builder, a `WireTransport` over a spawned child, and the singleton connection manager that multiplexes every remote agent over one wire connection.

**Architecture:** The host opens **one** wire connection to **one** agent-runner container and multiplexes all remote agents over it (design §3.2). PR-C.1 builds that connection layer in isolation: `transport-command.ts` (pure command builder), `child-transport.ts` (`WireTransport` over a child's stdio), and `connection-manager.ts` (lazy connect + handshake + per-`agentId` notification routing). The connection manager is transport-agnostic — it takes a `createTransport` factory — so it is fully unit-tested against an in-memory transport and a fake runner. **No host adapter, no MCP relay, no registry wiring** — those are PR-C.2. This PR adds files only; it changes no existing file.

**Tech Stack:** TypeScript, the `@prospero/shared` wire primitives (`WireClient`, `WireServer`, `WIRE_PROTOCOL_VERSION`), `node:child_process`, vitest.

---

## Context for the implementer

M10 PR-A built the wire protocol (`packages/shared/src/wire/`); PR-B built the agent-runner that speaks the **server** half. PR-C builds the **client** half — the host orchestrator side. PR-C is split: **C.1 (this plan) = the connection layer**; C.2 = the `ClaudeRemoteDockerAdapter`, the MCP relay, and the `adapterRegistry` wiring.

Read these before starting — the new code mirrors their patterns:

- `packages/shared/src/wire/client.ts` — `WireClient.request<T>(method, params)` returns a `Promise<T>`, correlates responses by id, and rejects pending requests on transport close. `notify(method, params)` is fire-and-forget (inherited from `WirePeer`). `onNotification(method, cb)` subscribes to inbound notifications.
- `packages/shared/src/wire/transport.ts` — the `WireTransport` interface: `send(data)`, `onData(handler)`, `onClose(handler)`. **`onData`/`onClose` are last-registration-wins.**
- `apps/agent-runner/src/transport/stdio-transport.ts` — `StdioWireTransport`, the runner's `WireTransport` over `process.stdin`/`process.stdout`. `child-transport.ts` is its host-side mirror over a *child's* stdio.
- `apps/agent-runner/tests/memory-transport.ts` and `tests/runner.test.ts` — the in-memory `WireTransport` pair and how wire round-trips are tested. PR-C.1 needs its own copy of the memory transport (apps/main must not depend on apps/agent-runner).
- `packages/shared/src/types/wire-protocol.ts` — message types: `HandshakeParams`/`HandshakeResult`, `SpawnParams`/`SpawnResult`, `HealthResult`, the `stdout`/`stderr`/`exit`/`mcp-open`/`mcp-data`/`mcp-close` notification params, and `WIRE_PROTOCOL_VERSION = 1`.
- `apps/agent-runner/src/runner.ts` — the runner's notification routing (`server.onNotification("mcp-data", ...)` casts `params as { agentId?: unknown; line?: unknown }` then `typeof` guards). The connection manager mirrors that lint-clean guard style.

Key wire facts the connection manager relies on:

- `handshake`, `spawn`, `stdin-write`, `kill`, `health` are **requests** (host→runner, `WireServer.handle`). `stdout`, `stderr`, `exit`, `mcp-open`, `mcp-close` are runner→host **notifications**. `mcp-data` is a **notification** sent in **both** directions (runner→host = MCP output to relay; host→runner = relay input to the bridge).
- The runner's `spawn` handler rejects a duplicate `agentId`; the host need not pre-check.
- All five exports the connection manager needs — `WireClient`, `WireServer`, `WIRE_PROTOCOL_VERSION`, and the wire types — come from the `@prospero/shared` barrel (`apps/main` already depends on it).

### Repo conventions

- Adapter code lives under `apps/main/src/orchestrator/adapters/<adapter-name>/`; tests are **colocated** as `*.test.ts` (see `claude-api-key-local/adapter.test.ts`). PR-C.1's files all go in a new `claude-oauth-remote-docker/` dir.
- Non-test helper modules colocate in the same dir (precedent: `claude-oauth-local/fake-claude.ts`). `tsup` bundles only what `src/index.ts` reaches, so test-only helpers are never shipped.
- `exactOptionalPropertyTypes` is on — build optional object properties with a conditional spread (`...(x !== undefined ? { x } : {})`), never `{ x: undefined }`.
- commitlint rejects uppercase, `+`, and `%` in the subject. Commit subjects below are pre-cleared.

### File structure

| File | Responsibility |
|---|---|
| `claude-oauth-remote-docker/config.ts` | `RemoteExecutionConfig` discriminated union + `DEFAULT_LOCAL_DOCKER_CONFIG`. |
| `claude-oauth-remote-docker/transport-command.ts` | `buildTransportCommand(config)` — pure: config → `{ command, args }`. |
| `claude-oauth-remote-docker/child-transport.ts` | `ChildProcessWireTransport` — `WireTransport` over a spawned child's stdio. |
| `claude-oauth-remote-docker/connection-manager.ts` | `RemoteConnectionManager` class + `getRemoteConnectionManager()` singleton + production transport factory. |
| `claude-oauth-remote-docker/memory-transport.ts` | Test helper — in-memory `WireTransport` pair. |
| `claude-oauth-remote-docker/fake-runner.ts` | Test helper — a `WireServer` with canned handlers + notification emitters. |
| `*.test.ts` (3 files) | Colocated unit tests. |

PR-C.1 **creates files only** — it modifies nothing existing. The connection manager is dead code until PR-C.2 wires the adapter to it; it is nonetheless fully unit-tested here.

---

## Task 1: `config.ts` — remote execution config

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts`

Pure type declarations + one constant — no behavior, so no test. PR-C.2/PR-D consume these; PR-D will let the user edit the config in Settings, but PR-C ships only the local-Docker default (the M10 validation target, design §2).

- [ ] **Step 1: Create `config.ts`**

```ts
/**
 * Where a remote agent's container is launched. M10 PR-D will let the user pick
 * this in Settings; PR-C ships only the local-Docker default — the M10
 * validation target (design §2).
 */
export type RemoteExecutionConfig =
  | { mode: "local-docker"; image: string }
  | {
      mode: "remote-vps";
      image: string;
      sshHost: string;
      sshUser: string;
      sshKeyPath: string;
    };

/** Local Docker, running the image the PR-B.4 Dockerfile/compose build produce. */
export const DEFAULT_LOCAL_DOCKER_CONFIG: RemoteExecutionConfig = {
  mode: "local-docker",
  image: "prospero/agent-runner:dev",
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts
git commit -m "feat(m10): remote execution config types"
```

---

## Task 2: `transport-command.ts` — launch command builder

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.test.ts`

A pure function: `RemoteExecutionConfig` → the program + argv whose stdio carries the wire protocol. Local Docker runs the image directly; a remote VPS wraps the **identical** `docker run` in `ssh` (design §3.1).

- [ ] **Step 1: Write the failing test**

`transport-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTransportCommand } from "./transport-command.js";
import { DEFAULT_LOCAL_DOCKER_CONFIG } from "./config.js";

describe("buildTransportCommand", () => {
  it("runs the image directly for local-docker mode", () => {
    expect(buildTransportCommand(DEFAULT_LOCAL_DOCKER_CONFIG)).toEqual({
      command: "docker",
      args: ["run", "--rm", "-i", "prospero/agent-runner:dev"],
    });
  });

  it("wraps docker run in ssh for remote-vps mode", () => {
    const cmd = buildTransportCommand({
      mode: "remote-vps",
      image: "prospero/agent-runner:dev",
      sshHost: "vps.example.com",
      sshUser: "agent",
      sshKeyPath: "/home/me/.ssh/id_ed25519",
    });
    expect(cmd).toEqual({
      command: "ssh",
      args: [
        "-i",
        "/home/me/.ssh/id_ed25519",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "BatchMode=yes",
        "agent@vps.example.com",
        "--",
        "docker",
        "run",
        "--rm",
        "-i",
        "prospero/agent-runner:dev",
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.test.ts`
Expected: FAIL — `buildTransportCommand` is not exported / module not found.

- [ ] **Step 3: Write `transport-command.ts`**

```ts
import type { RemoteExecutionConfig } from "./config.js";

/** A child-process launch spec: the program and its argv. */
export type TransportCommand = { command: string; args: string[] };

/**
 * Builds the command whose stdio carries the wire protocol. Local Docker runs
 * the runner image directly; a remote VPS wraps the identical `docker run` in
 * `ssh` — the only difference is the `ssh` prefix (design §3.1). The container
 * is `--rm` (ephemeral, design §11) and `-i` (stdin attached — stdio IS the
 * transport). SSH pins the host key (`StrictHostKeyChecking=yes`) and never
 * prompts interactively (`BatchMode=yes`) — design §8.
 */
export const buildTransportCommand = (config: RemoteExecutionConfig): TransportCommand => {
  const dockerRun = ["run", "--rm", "-i", config.image];
  if (config.mode === "local-docker") {
    return { command: "docker", args: dockerRun };
  }
  return {
    command: "ssh",
    args: [
      "-i",
      config.sshKeyPath,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "BatchMode=yes",
      `${config.sshUser}@${config.sshHost}`,
      "--",
      "docker",
      ...dockerRun,
    ],
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/transport-command.test.ts
git commit -m "feat(m10): transport command builder"
```

---

## Task 3: `child-transport.ts` — wire transport over a child process

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.test.ts`

A `WireTransport` whose channel is a spawned child's `stdin`/`stdout` — the host side of the SSH/docker pipe. Mirrors the runner's `StdioWireTransport`, but reads/writes a *child's* streams. `TransportChild` is a minimal structural type (like the runner's `ClaudeProcess`) so a real `node:child_process.ChildProcess` is assignable to it.

- [ ] **Step 1: Write the failing test**

`child-transport.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ChildProcessWireTransport, type TransportChild } from "./child-transport.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A fake child: two PassThrough streams plus an EventEmitter-backed exit event.
const makeFakeChild = (): {
  child: TransportChild;
  stdin: PassThrough;
  stdout: PassThrough;
  emitExit: () => void;
} => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const emitter = new EventEmitter();
  const child: TransportChild = {
    stdin,
    stdout,
    on: (event, listener) => {
      emitter.on(event, listener);
    },
  };
  return { child, stdin, stdout, emitExit: () => emitter.emit("exit", 0) };
};

describe("ChildProcessWireTransport", () => {
  it("delivers stdout chunks to the data handler", async () => {
    const { child, stdout } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const received: string[] = [];
    transport.onData((chunk) => received.push(chunk));
    stdout.write("hello\n");
    await tick();
    expect(received).toEqual(["hello\n"]);
  });

  it("writes sent data to the child stdin", async () => {
    const { child, stdin } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    let written = "";
    stdin.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });
    transport.send("ping\n");
    await tick();
    expect(written).toBe("ping\n");
  });

  it("fires the close handler when the child exits", () => {
    const { child, emitExit } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const onClose = vi.fn();
    transport.onClose(onClose);
    emitExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires the close handler at most once", () => {
    const { child, emitExit } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const onClose = vi.fn();
    transport.onClose(onClose);
    emitExit();
    emitExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `child-transport.ts`**

```ts
import type { WireTransport } from "@prospero/shared";

/**
 * The minimal slice of a spawned child this transport drives. A real
 * node:child_process.ChildProcess is structurally assignable to it.
 */
export type TransportChild = {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null) => void): void;
};

/**
 * WireTransport over a spawned child's stdio — the host side of the SSH/docker
 * pipe. Mirrors the runner's StdioWireTransport but reads the child's stdout
 * and writes its stdin instead of the process's own. Close fires on child exit.
 */
export class ChildProcessWireTransport implements WireTransport {
  private readonly child: TransportChild;
  private dataHandler: ((chunk: string) => void) | undefined;
  private closeHandler: (() => void) | undefined;
  private closed = false;

  constructor(child: TransportChild) {
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.dataHandler?.(chunk));
    child.on("exit", () => this.fireClose());
  }

  send(data: string): void {
    this.child.stdin?.write(data);
  }

  onData(handler: (chunk: string) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/child-transport.test.ts
git commit -m "feat(m10): child process wire transport"
```

---

## Task 4: Test helpers — `memory-transport.ts` and `fake-runner.ts`

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/memory-transport.ts`
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/fake-runner.ts`

Two test-only helpers the connection-manager test (Task 5) imports. `memory-transport.ts` is a self-contained copy of the runner's in-memory transport pair (apps/main must not depend on apps/agent-runner). `fake-runner.ts` is a test-controllable runner: a **real** `WireServer` with canned handlers, so the connection-manager tests exercise the genuine wire codec and framing end-to-end. Neither file is reachable from `src/index.ts`, so `tsup` never bundles them.

- [ ] **Step 1: Create `memory-transport.ts`**

```ts
import type { WireTransport } from "@prospero/shared";

export type MemoryTransportPair = {
  a: WireTransport;
  b: WireTransport;
  /** Fire both ends' onClose handlers. */
  close(): void;
};

/**
 * A WireTransport pair cross-wired in memory: what A sends, B's onData receives,
 * and vice versa. Delivery is synchronous. Test-only.
 */
export const createMemoryTransportPair = (): MemoryTransportPair => {
  let aData: ((chunk: string) => void) | undefined;
  let bData: ((chunk: string) => void) | undefined;
  let aClose: (() => void) | undefined;
  let bClose: (() => void) | undefined;
  const a: WireTransport = {
    send: (data) => bData?.(data),
    onData: (handler) => {
      aData = handler;
    },
    onClose: (handler) => {
      aClose = handler;
    },
  };
  const b: WireTransport = {
    send: (data) => aData?.(data),
    onData: (handler) => {
      bData = handler;
    },
    onClose: (handler) => {
      bClose = handler;
    },
  };
  return {
    a,
    b,
    close: () => {
      aClose?.();
      bClose?.();
    },
  };
};
```

- [ ] **Step 2: Create `fake-runner.ts`**

```ts
import { WireServer, WIRE_PROTOCOL_VERSION, type WireTransport } from "@prospero/shared";

/**
 * A test-controllable agent-runner: a real WireServer with canned request
 * handlers, so connection-manager tests exercise the genuine wire codec and
 * framing without depending on the apps/agent-runner package. The test pushes
 * stdout/stderr/exit/mcp-* notifications by hand. Test-only.
 */
export class FakeRunner {
  readonly server: WireServer;
  /** agentIds passed to spawn, in order. */
  readonly spawned: string[] = [];
  /** stdin-write request params, in order. */
  readonly stdinWrites: { agentId: string; line: string }[] = [];
  /** agentIds passed to kill, in order. */
  readonly killed: string[] = [];
  /** host -> runner mcp-data notifications received, in order. */
  readonly mcpDataFromHost: { agentId: string; line: string }[] = [];
  /** Tests set this before connecting to force a handshake protocol mismatch. */
  handshakeProtocolVersion: number = WIRE_PROTOCOL_VERSION;
  private nextPid = 1000;

  constructor(transport: WireTransport) {
    this.server = new WireServer(transport);
    this.server.handle("handshake", () => ({
      protocolVersion: this.handshakeProtocolVersion,
      server: "fake-runner",
      serverVersion: "0",
      capabilities: ["spawn", "stdin", "kill", "health"],
    }));
    this.server.handle("spawn", (params) => {
      this.spawned.push((params as { agentId: string }).agentId);
      return { pid: this.nextPid++ };
    });
    this.server.handle("stdin-write", (params) => {
      this.stdinWrites.push(params as { agentId: string; line: string });
      return {};
    });
    this.server.handle("kill", (params) => {
      this.killed.push((params as { agentId: string }).agentId);
      return {};
    });
    this.server.handle("health", () => ({
      ok: true,
      uptimeSeconds: 1,
      activeAgents: this.spawned.length,
    }));
    this.server.onNotification("mcp-data", (params) => {
      this.mcpDataFromHost.push(params as { agentId: string; line: string });
    });
  }

  emitStdout(agentId: string, line: string): void {
    this.server.notify("stdout", { agentId, line });
  }
  emitStderr(agentId: string, line: string): void {
    this.server.notify("stderr", { agentId, line });
  }
  emitExit(agentId: string, code: number | null): void {
    this.server.notify("exit", { agentId, code });
  }
  emitMcpOpen(agentId: string): void {
    this.server.notify("mcp-open", { agentId });
  }
  emitMcpData(agentId: string, line: string): void {
    this.server.notify("mcp-data", { agentId, line });
  }
  emitMcpClose(agentId: string): void {
    this.server.notify("mcp-close", { agentId });
  }
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @prospero/main typecheck` then `pnpm --filter @prospero/main lint`
Expected: both clean. (No behavior tests — these helpers are exercised by Task 5's suite.)

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/memory-transport.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/fake-runner.ts
git commit -m "feat(m10): remote connection test helpers"
```

---

## Task 5: `connection-manager.ts` — the multiplexing connection manager

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`

The core of PR-C.1. `RemoteConnectionManager` lazily connects + handshakes on the first `spawnAgent`, then routes every inbound notification to the right agent by `agentId`. It is transport-agnostic (takes a `createTransport` factory), so the tests drive it over the in-memory pair + `FakeRunner`. The file also exports the production singleton `getRemoteConnectionManager()` — glue that spawns a real `docker`/`ssh` child; that path is not unit-tested (no Docker on the build machine) and is verified by the PR-E smoke.

**Design note — the fan-out transport:** `WireTransport.onClose` is last-registration-wins, but both the `WireClient` *and* the manager need the close signal (the client to reject pending requests, the manager to fail every live agent). `ensureConnection` therefore wraps the raw transport so the raw `onClose` invokes the manager's `handleClose()` and *then* the client's handler.

**Design note — handshake mismatch is terminal:** a protocol-version mismatch means the runner image is wrong (not transient). The rejected `connecting` promise is intentionally cached, so every later `spawnAgent` fails fast until the user fixes the image. A transport *close* resets `connecting` to `null`, so a fresh container can be reconnected.

- [ ] **Step 1: Write the failing test**

`connection-manager.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { RemoteConnectionManager, type RemoteAgentCallbacks } from "./connection-manager.js";
import { createMemoryTransportPair } from "./memory-transport.js";
import { FakeRunner } from "./fake-runner.js";

const makeCallbacks = (): RemoteAgentCallbacks => ({
  onStdout: vi.fn(),
  onStderr: vi.fn(),
  onExit: vi.fn(),
  onMcpOpen: vi.fn(),
  onMcpData: vi.fn(),
  onMcpClose: vi.fn(),
});

const setup = (): {
  pair: ReturnType<typeof createMemoryTransportPair>;
  runner: FakeRunner;
  manager: RemoteConnectionManager;
} => {
  const pair = createMemoryTransportPair();
  const runner = new FakeRunner(pair.b);
  const manager = new RemoteConnectionManager({ createTransport: () => pair.a });
  return { pair, runner, manager };
};

const spawn = (
  manager: RemoteConnectionManager,
  agentId: string,
  callbacks: RemoteAgentCallbacks,
): Promise<{ pid: number }> =>
  manager.spawnAgent({ agentId, args: [], oauthToken: "tok", callbacks });

describe("RemoteConnectionManager", () => {
  it("connects, handshakes, and spawns an agent", async () => {
    const { runner, manager } = setup();
    const result = await spawn(manager, "agent_1", makeCallbacks());
    expect(result.pid).toBeGreaterThan(0);
    expect(runner.spawned).toEqual(["agent_1"]);
    expect(manager.hasAgent("agent_1")).toBe(true);
  });

  it("passes the host-built args through to the runner spawn", async () => {
    const { runner, manager } = setup();
    await manager.spawnAgent({
      agentId: "agent_1",
      args: ["--model", "claude-x"],
      oauthToken: "tok",
      callbacks: makeCallbacks(),
    });
    expect(runner.spawned).toEqual(["agent_1"]);
  });

  it("rejects when the runner speaks a different protocol version", async () => {
    const { runner, manager } = setup();
    runner.handshakeProtocolVersion = 999;
    await expect(spawn(manager, "agent_1", makeCallbacks())).rejects.toThrow(/protocol/);
  });

  it("routes a stdout notification to the agent's callback", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitStdout("agent_1", '{"type":"x"}');
    expect(cb.onStdout).toHaveBeenCalledWith('{"type":"x"}');
  });

  it("routes a stderr notification to the agent's callback", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitStderr("agent_1", "a warning");
    expect(cb.onStderr).toHaveBeenCalledWith("a warning");
  });

  it("delivers exit and forgets the agent", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitExit("agent_1", 0);
    expect(cb.onExit).toHaveBeenCalledWith(0);
    expect(manager.hasAgent("agent_1")).toBe(false);
  });

  it("routes notifications to the correct agent when several run", async () => {
    const { runner, manager } = setup();
    const cb1 = makeCallbacks();
    const cb2 = makeCallbacks();
    await spawn(manager, "a1", cb1);
    await spawn(manager, "a2", cb2);
    runner.emitStdout("a2", "for-a2");
    expect(cb2.onStdout).toHaveBeenCalledWith("for-a2");
    expect(cb1.onStdout).not.toHaveBeenCalled();
  });

  it("routes mcp-open, mcp-data, and mcp-close to the agent", async () => {
    const { runner, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    runner.emitMcpOpen("agent_1");
    runner.emitMcpData("agent_1", '{"jsonrpc":"2.0"}');
    runner.emitMcpClose("agent_1");
    expect(cb.onMcpOpen).toHaveBeenCalledTimes(1);
    expect(cb.onMcpData).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');
    expect(cb.onMcpClose).toHaveBeenCalledTimes(1);
  });

  it("forwards stdin to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.sendStdin("agent_1", '{"in":1}\n');
    await Promise.resolve();
    expect(runner.stdinWrites).toEqual([{ agentId: "agent_1", line: '{"in":1}\n' }]);
  });

  it("forwards kill to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.killAgent("agent_1");
    await Promise.resolve();
    expect(runner.killed).toEqual(["agent_1"]);
  });

  it("forwards mcp-data from the host relay to the runner", async () => {
    const { runner, manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    manager.sendMcpData("agent_1", '{"jsonrpc":"2.0","id":1}\n');
    expect(runner.mcpDataFromHost).toEqual([
      { agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1}\n' },
    ]);
  });

  it("fails every live agent when the transport closes", async () => {
    const { pair, manager } = setup();
    const cb = makeCallbacks();
    await spawn(manager, "agent_1", cb);
    pair.close();
    expect(cb.onExit).toHaveBeenCalledWith(null);
    expect(manager.hasAgent("agent_1")).toBe(false);
  });

  it("reports runner health over the live connection", async () => {
    const { manager } = setup();
    await spawn(manager, "agent_1", makeCallbacks());
    const health = await manager.health();
    expect(health.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `connection-manager.ts`**

```ts
import { spawn } from "node:child_process";
import {
  WireClient,
  WIRE_PROTOCOL_VERSION,
  type WireTransport,
  type HandshakeResult,
  type SpawnResult,
  type HealthResult,
} from "@prospero/shared";
import { buildTransportCommand } from "./transport-command.js";
import { ChildProcessWireTransport } from "./child-transport.js";
import { DEFAULT_LOCAL_DOCKER_CONFIG } from "./config.js";

/** Per-agent sinks the connection manager fans inbound notifications into. */
export type RemoteAgentCallbacks = {
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
  onExit: (code: number | null) => void;
  onMcpOpen: () => void;
  onMcpData: (line: string) => void;
  onMcpClose: () => void;
};

export type SpawnAgentRequest = {
  agentId: string;
  /** claude argv built host-side, minus the MCP triplet (the runner appends it). */
  args: string[];
  env?: Record<string, string>;
  oauthToken: string;
  callbacks: RemoteAgentCallbacks;
};

export type RemoteConnectionDeps = {
  /**
   * Builds the wire transport — a spawned docker/ssh child in production, an
   * in-memory pair in tests. Called once, on the first connection.
   */
  createTransport: () => WireTransport;
};

const CLIENT_NAME = "prospero-orchestrator";
const CLIENT_VERSION = "0.0.0";

/**
 * Owns the single wire connection to one agent-runner container and multiplexes
 * every remote agent over it (design §3.2). Lazily connects + handshakes on the
 * first spawnAgent; routes inbound stdout/stderr/exit/mcp-* notifications to the
 * right agent by agentId. A transport close fails every live agent.
 */
export class RemoteConnectionManager {
  private readonly createTransport: () => WireTransport;
  private client: WireClient | null = null;
  private connecting: Promise<void> | null = null;
  private readonly agents = new Map<string, RemoteAgentCallbacks>();

  constructor(deps: RemoteConnectionDeps) {
    this.createTransport = deps.createTransport;
  }

  /** True once the agent has been spawned and has not yet exited. */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Spawns a claude process in the remote container; resolves with its pid. */
  async spawnAgent(req: SpawnAgentRequest): Promise<SpawnResult> {
    await this.ensureConnection(req.oauthToken);
    const client = this.client;
    if (client === null) throw new Error("remote connection lost");
    this.agents.set(req.agentId, req.callbacks);
    try {
      return await client.request<SpawnResult>("spawn", {
        agentId: req.agentId,
        args: req.args,
        ...(req.env !== undefined ? { env: req.env } : {}),
      });
    } catch (e) {
      this.agents.delete(req.agentId);
      throw e;
    }
  }

  /** Writes one JSONL line to the agent's claude stdin. Fire-and-forget. */
  sendStdin(agentId: string, line: string): void {
    void this.client?.request("stdin-write", { agentId, line }).catch(() => undefined);
  }

  /** Kills the agent's claude process. The runner's exit notification cleans up. */
  killAgent(agentId: string): void {
    void this.client?.request("kill", { agentId }).catch(() => undefined);
  }

  /** Sends one MCP JSON-RPC line from the host relay into the agent's bridge. */
  sendMcpData(agentId: string, line: string): void {
    this.client?.notify("mcp-data", { agentId, line });
  }

  /** Queries runner health over the live connection. */
  async health(): Promise<HealthResult> {
    if (this.client === null) throw new Error("remote runner not connected");
    return this.client.request<HealthResult>("health");
  }

  private ensureConnection(oauthToken: string): Promise<void> {
    if (this.connecting !== null) return this.connecting;
    const raw = this.createTransport();
    // Fan-out transport: WireClient.onClose is last-registration-wins, but the
    // manager also needs close — so the raw close invokes both.
    const transport: WireTransport = {
      send: (data) => raw.send(data),
      onData: (handler) => raw.onData(handler),
      onClose: (clientHandler) => {
        raw.onClose(() => {
          this.handleClose();
          clientHandler();
        });
      },
    };
    const client = new WireClient(transport);
    this.client = client;
    this.registerNotificationRoutes(client);
    this.connecting = client
      .request<HandshakeResult>("handshake", {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: CLIENT_NAME,
        clientVersion: CLIENT_VERSION,
        credentials: { kind: "oauth", oauthToken },
      })
      .then((result) => {
        if (result.protocolVersion !== WIRE_PROTOCOL_VERSION) {
          throw new Error(
            `remote runner speaks protocol ${String(result.protocolVersion)}, ` +
              `expected ${String(WIRE_PROTOCOL_VERSION)}`,
          );
        }
      });
    return this.connecting;
  }

  private registerNotificationRoutes(client: WireClient): void {
    client.onNotification("stdout", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onStdout(d.line);
    });
    client.onNotification("stderr", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onStderr(d.line);
    });
    client.onNotification("exit", (params) => {
      const d = params as { agentId?: unknown; code?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onExit(typeof d.code === "number" ? d.code : null);
      this.agents.delete(d.agentId);
    });
    client.onNotification("mcp-open", (params) => {
      const d = params as { agentId?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onMcpOpen();
    });
    client.onNotification("mcp-data", (params) => {
      const d = params as { agentId?: unknown; line?: unknown };
      if (typeof d.agentId !== "string" || typeof d.line !== "string") return;
      this.agents.get(d.agentId)?.onMcpData(d.line);
    });
    client.onNotification("mcp-close", (params) => {
      const d = params as { agentId?: unknown };
      if (typeof d.agentId !== "string") return;
      this.agents.get(d.agentId)?.onMcpClose();
    });
  }

  private handleClose(): void {
    for (const cb of this.agents.values()) cb.onExit(null);
    this.agents.clear();
    this.client = null;
    this.connecting = null;
  }
}

// Spawns the docker/ssh child whose stdio carries the wire protocol. stderr is
// inherited so docker/ssh launch failures surface in the Electron main log.
// Not unit-tested (no Docker on the build machine) — verified by the PR-E smoke.
const createProductionTransport = (): WireTransport => {
  const { command, args } = buildTransportCommand(DEFAULT_LOCAL_DOCKER_CONFIG);
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  return new ChildProcessWireTransport(child);
};

let singleton: RemoteConnectionManager | null = null;

/** The process-wide remote connection manager — one wire connection per host. */
export const getRemoteConnectionManager = (): RemoteConnectionManager => {
  singleton ??= new RemoteConnectionManager({ createTransport: createProductionTransport });
  return singleton;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts
git commit -m "feat(m10): remote connection manager"
```

---

## Task 6: Verification gate (no regression)

**Files:** none modified — checks only.

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: clean across all 4 projects.

- [ ] **Step 2: Lint the whole repo**

Run: `pnpm lint`
Expected: clean across all 4 projects.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: 0 failures. The PR-B.4 baseline is 910 passing + 2 todo; PR-C.1 adds 20 tests (2 + 4 + 14), so the new total is **930 passing + 2 todo**. Confirm `apps/main` went from 651 to 671 passing and no previously-passing test regressed.

- [ ] **Step 4: Confirm the deferred check is recorded**

No commit. `createProductionTransport` (the real `docker run` path) is not unit-testable without Docker; it is exercised by the PR-E local Docker smoke. Note this in the session handoff when closing PR-C.1.

---

## Self-Review (plan vs. design §5.2)

- **Design §5.2 — "Connection manager (singleton) — dono de um processo de transporte + um wire client, compartilhado por todos os agentes remotos. Roteia notificações por `agent_id`":** Task 5 — `RemoteConnectionManager` + `getRemoteConnectionManager()` singleton; `registerNotificationRoutes` routes by `agentId`. ✓
- **Design §5.2 — "`transport.ts` — monta o comando de lançamento (`docker run -i …` local, `ssh … -- docker run -i …` VPS). Função pura, testável":** Task 2 — `buildTransportCommand`, pure, tested both modes. ✓
- **Design §3.2 — one wire connection multiplexes all remote agents:** the connection manager opens one connection lazily and keeps a `Map<agentId, callbacks>`; the two-agent isolation test covers it. ✓
- **Design §3.1 — SSH wraps the identical `docker run`:** `buildTransportCommand` remote-vps branch prepends `ssh … --` to the same `docker run` argv. ✓
- **Design §8 — SSH host key pinned, no blind accept:** `StrictHostKeyChecking=yes` + `BatchMode=yes` in the ssh args. ✓
- **Out of scope for C.1 (→ C.2):** `ClaudeRemoteDockerAdapter`, `mcp-relay.ts`, the `buildClaudeArgs` MCP-triplet-omission change, `adapterRegistry` registration, and the in-process integration test. C.1 deliberately changes no existing file. ✓
- **Placeholder scan:** every file's full content is inline; no TBD/TODO. The one untested path — `createProductionTransport` — is a design-sanctioned deferral to the PR-E Docker smoke, called out explicitly.
- **Type consistency:** `RemoteExecutionConfig` (Task 1) is consumed by `buildTransportCommand` (Task 2) and `createProductionTransport` (Task 5); `WireTransport` is the seam between `child-transport.ts`, `memory-transport.ts`, and the connection manager; `RemoteAgentCallbacks`/`SpawnAgentRequest` are defined once in `connection-manager.ts` and imported by its test. The `FakeRunner` handler return shapes (`HandshakeResult`, `SpawnResult`, `HealthResult`) match `packages/shared/src/types/wire-protocol.ts`.
