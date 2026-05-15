# M10 PR-A — Wire-Protocol Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M10 wire-protocol foundation in `packages/shared` — message types, codec, line framing, and the client/server primitives — that the host adapter (PR-C) and the agent-runner (PR-B) will both speak.

**Architecture:** A transport-agnostic, newline-delimited JSON protocol. A `WirePeer` abstract base owns chunk reassembly and notification pub/sub; `WireClient` adds request/response correlation, `WireServer` adds request dispatch. All pure TypeScript — no Node APIs, no zod — so it is safe for every bundle that consumes `packages/shared` (main, renderer, preload, and the future agent-runner).

**Tech Stack:** TypeScript, vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md` (this PR is row **A** of §10; see §4 for the wire-protocol revisions).

**Baseline:** 831 tests passing. This PR adds ~30 tests, all in `packages/shared`, and changes no runtime behavior (nothing imports the new code yet).

---

## File Structure

**Created:**
- `packages/shared/src/types/wire-protocol.ts` — envelope, method, error-code, and param/result types (types + the runtime const objects).
- `packages/shared/src/wire/transport.ts` — the `WireTransport` channel interface.
- `packages/shared/src/wire/codec.ts` — `encodeWireMessage`, `decodeWireMessage`, `LineFramer`.
- `packages/shared/src/wire/peer.ts` — `WirePeer` abstract base (transport + framing + notification pub/sub).
- `packages/shared/src/wire/client.ts` — `WireClient`, `WireRequestError`.
- `packages/shared/src/wire/server.ts` — `WireServer`, `WireHandlerError`.
- `packages/shared/tests/wire-protocol.test.ts`, `wire-codec.test.ts`, `wire-test-utils.ts`, `wire-test-utils.test.ts`, `wire-client.test.ts`, `wire-server.test.ts`, `wire-exports.test.ts`.

**Modified:**
- `packages/shared/src/types/index.ts` — re-export `wire-protocol.js`.
- `packages/shared/src/index.ts` — re-export the `wire/` modules.
- `docs/m10-adapter-wire-protocol.md` — revised to match the implemented protocol.

**Conventions (verified against the package):**
- `packages/shared` has no build step (`main` points at `./src/index.ts`); imports use explicit `.js` extensions.
- Tests live in `packages/shared/tests/`, named `*.test.ts`, importing from `../src/...`.
- `pnpm lint` only covers `src/` — test files are typechecked but not linted.
- Run one test file: `pnpm --filter @prospero/shared exec vitest run tests/<file>`.

---

## Task 1: Wire-protocol types

**Files:**
- Create: `packages/shared/src/types/wire-protocol.ts`
- Test: `packages/shared/tests/wire-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WIRE_PROTOCOL_VERSION,
  WireErrorCode,
  WireMethod,
  type WireMessage,
} from "../src/types/wire-protocol.js";

describe("wire-protocol types", () => {
  it("WIRE_PROTOCOL_VERSION is 1", () => {
    expect(WIRE_PROTOCOL_VERSION).toBe(1);
  });

  it("WireErrorCode carries the documented codes", () => {
    expect(WireErrorCode.unsupportedProtocol).toBe(1000);
    expect(WireErrorCode.unsupportedCredentials).toBe(1001);
    expect(WireErrorCode.agentNotFound).toBe(1010);
    expect(WireErrorCode.spawnFailed).toBe(1020);
    expect(WireErrorCode.protocolMismatch).toBe(1030);
    expect(WireErrorCode.unauthorised).toBe(1040);
    expect(WireErrorCode.internalError).toBe(1090);
  });

  it("WireMethod covers requests and notifications", () => {
    expect(WireMethod.handshake).toBe("handshake");
    expect(WireMethod.spawn).toBe("spawn");
    expect(WireMethod.stdinWrite).toBe("stdin-write");
    expect(WireMethod.kill).toBe("kill");
    expect(WireMethod.health).toBe("health");
    expect(WireMethod.stdout).toBe("stdout");
    expect(WireMethod.stderr).toBe("stderr");
    expect(WireMethod.exit).toBe("exit");
    expect(WireMethod.mcpOpen).toBe("mcp-open");
    expect(WireMethod.mcpData).toBe("mcp-data");
    expect(WireMethod.mcpClose).toBe("mcp-close");
  });

  it("a request envelope is structurally valid", () => {
    const msg: WireMessage = {
      type: "request",
      id: "msg_1",
      method: "spawn",
      params: { agentId: "a1" },
    };
    expect(msg.type).toBe("request");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-protocol.test.ts`
Expected: FAIL — cannot resolve `../src/types/wire-protocol.js`.

- [ ] **Step 3: Create the types module**

Create `packages/shared/src/types/wire-protocol.ts`:

```ts
// Wire protocol shared between the orchestrator (apps/main) and the remote
// agent-runner (apps/agent-runner). Types + plain runtime constants only — no
// zod (packages/shared is bundled into the preload sandbox; each app adds its
// own zod validation). See docs/m10-adapter-wire-protocol.md.

export const WIRE_PROTOCOL_VERSION = 1;

/** Error codes returned in WireResponse.error. */
export const WireErrorCode = {
  unsupportedProtocol: 1000,
  unsupportedCredentials: 1001,
  agentNotFound: 1010,
  spawnFailed: 1020,
  protocolMismatch: 1030,
  unauthorised: 1040,
  internalError: 1090,
} as const;
export type WireErrorCode = (typeof WireErrorCode)[keyof typeof WireErrorCode];

/** Method names. Requests go host→runner; notifications cross both ways. */
export const WireMethod = {
  handshake: "handshake",
  spawn: "spawn",
  stdinWrite: "stdin-write",
  kill: "kill",
  health: "health",
  stdout: "stdout",
  stderr: "stderr",
  exit: "exit",
  mcpOpen: "mcp-open",
  mcpData: "mcp-data",
  mcpClose: "mcp-close",
} as const;
export type WireMethod = (typeof WireMethod)[keyof typeof WireMethod];

export type WireError = { code: number; message: string };

// --- Envelope --------------------------------------------------------------

export type WireRequest = {
  type: "request";
  id: string;
  method: string;
  params?: unknown;
};
export type WireResponse = {
  type: "response";
  id: string;
  result?: unknown;
  error?: WireError;
};
export type WireNotification = {
  type: "notification";
  method: string;
  params?: unknown;
};
export type WireMessage = WireRequest | WireResponse | WireNotification;

// --- Credentials -----------------------------------------------------------

export type WireCredentials = { kind: "oauth"; oauthToken: string };

// --- Request params / results ----------------------------------------------

export type HandshakeParams = {
  protocolVersion: number;
  client: string;
  clientVersion: string;
  credentials: WireCredentials;
};
export type HandshakeResult = {
  protocolVersion: number;
  server: string;
  serverVersion: string;
  capabilities: string[];
};

export type SpawnParams = {
  agentId: string;
  /** claude argv built host-side by buildClaudeArgs, minus the MCP triplet. */
  args: string[];
  /** Extra env for the claude child (e.g. ANTHROPIC_API_URL). Usually empty. */
  env?: Record<string, string>;
};
export type SpawnResult = { pid: number };

export type StdinWriteParams = { agentId: string; line: string };

export type KillParams = { agentId: string };

export type HealthResult = {
  ok: boolean;
  uptimeSeconds: number;
  activeAgents: number;
};

// --- Notification params ---------------------------------------------------

export type StdoutNotification = { agentId: string; line: string };
export type StderrNotification = { agentId: string; line: string };
export type ExitNotification = { agentId: string; code: number | null };
export type McpOpenNotification = { agentId: string };
export type McpDataNotification = { agentId: string; line: string };
export type McpCloseNotification = { agentId: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-protocol.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/types/wire-protocol.ts packages/shared/tests/wire-protocol.test.ts
git commit -m "feat(m10): wire protocol message types"
```

---

## Task 2: Codec — encode / decode

**Files:**
- Create: `packages/shared/src/wire/codec.ts`
- Test: `packages/shared/tests/wire-codec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-codec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeWireMessage, encodeWireMessage } from "../src/wire/codec.js";
import type { WireMessage } from "../src/types/wire-protocol.js";

describe("wire codec", () => {
  it("encode appends exactly one trailing newline", () => {
    const line = encodeWireMessage({
      type: "notification",
      method: "stdout",
      params: { agentId: "a1", line: "x" },
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });

  it("encode then decode round-trips a request", () => {
    const msg: WireMessage = {
      type: "request",
      id: "msg_1",
      method: "kill",
      params: { agentId: "a1" },
    };
    expect(decodeWireMessage(encodeWireMessage(msg))).toEqual(msg);
  });

  it("decode tolerates a trailing newline", () => {
    expect(decodeWireMessage('{"type":"notification","method":"exit"}\n')).toEqual({
      type: "notification",
      method: "exit",
    });
  });

  it("decode throws on malformed JSON", () => {
    expect(() => decodeWireMessage("{not json")).toThrow(/malformed JSON/);
  });

  it("decode throws on a request missing id", () => {
    expect(() => decodeWireMessage(JSON.stringify({ type: "request", method: "kill" }))).toThrow(
      /missing id/,
    );
  });

  it("decode throws on an unknown message type", () => {
    expect(() => decodeWireMessage(JSON.stringify({ type: "bogus" }))).toThrow(
      /unknown message type/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-codec.test.ts`
Expected: FAIL — cannot resolve `../src/wire/codec.js`.

- [ ] **Step 3: Create the codec module**

Create `packages/shared/src/wire/codec.ts`:

```ts
import type { WireMessage } from "../types/wire-protocol.js";

/** Serialize a wire message to a single newline-terminated line. */
export const encodeWireMessage = (msg: WireMessage): string => JSON.stringify(msg) + "\n";

/**
 * Parse one line into a WireMessage. Throws on malformed JSON or an envelope
 * that is not a valid request/response/notification. `JSON.parse` tolerates a
 * trailing newline, so a framed line may be passed with or without "\n".
 */
export const decodeWireMessage = (line: string): WireMessage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`wire: malformed JSON: ${line.slice(0, 120)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("wire: message is not an object");
  }
  const m = parsed as Record<string, unknown>;
  switch (m["type"]) {
    case "request":
      if (typeof m["id"] !== "string" || typeof m["method"] !== "string") {
        throw new Error("wire: request missing id/method");
      }
      return parsed as WireMessage;
    case "response":
      if (typeof m["id"] !== "string") {
        throw new Error("wire: response missing id");
      }
      return parsed as WireMessage;
    case "notification":
      if (typeof m["method"] !== "string") {
        throw new Error("wire: notification missing method");
      }
      return parsed as WireMessage;
    default:
      throw new Error(`wire: unknown message type: ${String(m["type"])}`);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-codec.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/wire/codec.ts packages/shared/tests/wire-codec.test.ts
git commit -m "feat(m10): wire message encode and decode"
```

---

## Task 3: Codec — LineFramer

**Files:**
- Modify: `packages/shared/src/wire/codec.ts`
- Test: `packages/shared/tests/wire-codec.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/tests/wire-codec.test.ts` (add `LineFramer` to the existing `codec.js` import):

```ts
import { LineFramer } from "../src/wire/codec.js";

describe("LineFramer", () => {
  it("returns each complete line from one chunk", () => {
    const framer = new LineFramer();
    expect(framer.push("a\nb\n")).toEqual(["a", "b"]);
  });

  it("returns nothing for a chunk with no newline", () => {
    const framer = new LineFramer();
    expect(framer.push("partial")).toEqual([]);
  });

  it("buffers a partial line across chunk boundaries", () => {
    const framer = new LineFramer();
    expect(framer.push("hel")).toEqual([]);
    expect(framer.push("lo\nwor")).toEqual(["hello"]);
    expect(framer.push("ld\n")).toEqual(["world"]);
  });

  it("handles many lines in one chunk", () => {
    const framer = new LineFramer();
    expect(framer.push("1\n2\n3\n")).toEqual(["1", "2", "3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-codec.test.ts`
Expected: FAIL — `LineFramer` is not exported by `codec.js`.

- [ ] **Step 3: Add `LineFramer` to the codec module**

Append to `packages/shared/src/wire/codec.ts`:

```ts
/**
 * Reassembles newline-delimited lines from arbitrary stream chunks. A chunk may
 * carry zero, one, or many lines, and a line may span chunk boundaries.
 */
export class LineFramer {
  private buffer = "";

  /** Feed a chunk; return the lines it completed (newline stripped). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 1);
      idx = this.buffer.indexOf("\n");
    }
    return lines;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-codec.test.ts`
Expected: PASS — 10 tests (6 + 4).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/wire/codec.ts packages/shared/tests/wire-codec.test.ts
git commit -m "feat(m10): line framer for stream reassembly"
```

---

## Task 4: Transport interface + in-memory test pair

**Files:**
- Create: `packages/shared/src/wire/transport.ts`
- Create: `packages/shared/tests/wire-test-utils.ts`
- Test: `packages/shared/tests/wire-test-utils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-test-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("createMemoryTransportPair", () => {
  it("delivers what A sends to B's onData handler", () => {
    const pair = createMemoryTransportPair();
    const received: string[] = [];
    pair.b.onData((chunk) => received.push(chunk));
    pair.a.send("hello\n");
    expect(received).toEqual(["hello\n"]);
  });

  it("delivers what B sends to A's onData handler", () => {
    const pair = createMemoryTransportPair();
    const received: string[] = [];
    pair.a.onData((chunk) => received.push(chunk));
    pair.b.send("hi\n");
    expect(received).toEqual(["hi\n"]);
  });

  it("close() fires both ends' onClose handlers", () => {
    const pair = createMemoryTransportPair();
    let aClosed = false;
    let bClosed = false;
    pair.a.onClose(() => {
      aClosed = true;
    });
    pair.b.onClose(() => {
      bClosed = true;
    });
    pair.close();
    expect([aClosed, bClosed]).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-test-utils.test.ts`
Expected: FAIL — cannot resolve `./wire-test-utils.js`.

- [ ] **Step 3: Create the transport interface**

Create `packages/shared/src/wire/transport.ts`:

```ts
/**
 * A bidirectional line channel. The wire protocol runs over anything that can
 * ship strings: a child process's stdio (SSH / docker-run) in production, or an
 * in-memory pair in tests. The transport carries raw chunks; reassembly into
 * messages is the WirePeer's job.
 */
export type WireTransport = {
  /** Write an already-encoded message (its trailing newline included). */
  send(data: string): void;
  /** Register the handler for inbound raw chunks. Last registration wins. */
  onData(handler: (chunk: string) => void): void;
  /** Register the handler for transport close. */
  onClose(handler: () => void): void;
};
```

- [ ] **Step 4: Create the in-memory test pair**

Create `packages/shared/tests/wire-test-utils.ts`:

```ts
import type { WireTransport } from "../src/wire/transport.js";

export type MemoryTransportPair = {
  a: WireTransport;
  b: WireTransport;
  /** Fire both ends' onClose handlers. */
  close(): void;
};

/**
 * A WireTransport pair cross-wired in memory: what A sends, B's onData receives,
 * and vice versa. Delivery is synchronous, which keeps request/response tests
 * free of tick juggling.
 */
export const createMemoryTransportPair = (): MemoryTransportPair => {
  let aData: ((chunk: string) => void) | undefined;
  let bData: ((chunk: string) => void) | undefined;
  let aClose: (() => void) | undefined;
  let bClose: (() => void) | undefined;
  const a: WireTransport = {
    send: (data) => {
      bData?.(data);
    },
    onData: (handler) => {
      aData = handler;
    },
    onClose: (handler) => {
      aClose = handler;
    },
  };
  const b: WireTransport = {
    send: (data) => {
      aData?.(data);
    },
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

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-test-utils.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/wire/transport.ts packages/shared/tests/wire-test-utils.ts packages/shared/tests/wire-test-utils.test.ts
git commit -m "feat(m10): wire transport interface and memory test pair"
```

---

## Task 5: WirePeer base + WireClient

**Files:**
- Create: `packages/shared/src/wire/peer.ts`
- Create: `packages/shared/src/wire/client.ts`
- Test: `packages/shared/tests/wire-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WireClient, WireRequestError } from "../src/wire/client.js";
import { decodeWireMessage, encodeWireMessage } from "../src/wire/codec.js";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("WireClient", () => {
  it("resolves a request with the matching response result", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        pair.b.send(encodeWireMessage({ type: "response", id: msg.id, result: { pong: true } }));
      }
    });
    expect(await client.request("health")).toEqual({ pong: true });
  });

  it("rejects a request when the response carries an error", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        pair.b.send(
          encodeWireMessage({ type: "response", id: msg.id, error: { code: 1020, message: "boom" } }),
        );
      }
    });
    await expect(client.request("spawn")).rejects.toBeInstanceOf(WireRequestError);
    await expect(client.request("spawn")).rejects.toMatchObject({ code: 1020, message: "boom" });
  });

  it("sends params on the request envelope", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    let seenParams: unknown;
    pair.b.onData((chunk) => {
      const msg = decodeWireMessage(chunk);
      if (msg.type === "request") {
        seenParams = msg.params;
        pair.b.send(encodeWireMessage({ type: "response", id: msg.id, result: {} }));
      }
    });
    await client.request("kill", { agentId: "a9" });
    expect(seenParams).toEqual({ agentId: "a9" });
  });

  it("dispatches inbound notifications to subscribers", () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    const seen: unknown[] = [];
    const unsubscribe = client.onNotification("stdout", (params) => seen.push(params));
    pair.b.send(
      encodeWireMessage({ type: "notification", method: "stdout", params: { agentId: "a1", line: "hi" } }),
    );
    expect(seen).toEqual([{ agentId: "a1", line: "hi" }]);
    unsubscribe();
    pair.b.send(
      encodeWireMessage({ type: "notification", method: "stdout", params: { agentId: "a1", line: "x" } }),
    );
    expect(seen).toHaveLength(1);
  });

  it("rejects pending requests when the transport closes", async () => {
    const pair = createMemoryTransportPair();
    const client = new WireClient(pair.a);
    const pending = client.request("health");
    pair.close();
    await expect(pending).rejects.toThrow(/transport closed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-client.test.ts`
Expected: FAIL — cannot resolve `../src/wire/client.js`.

- [ ] **Step 3: Create the WirePeer base**

Create `packages/shared/src/wire/peer.ts`:

```ts
import { decodeWireMessage, encodeWireMessage, LineFramer } from "./codec.js";
import type { WireTransport } from "./transport.js";
import type { WireMessage, WireNotification } from "../types/wire-protocol.js";

type NotificationCallback = (params: unknown) => void;

/**
 * Shared base for WireClient and WireServer: owns the transport, reassembles
 * lines, decodes messages, and provides the notification pub/sub both peers
 * need. Subclasses implement handleMessage() for their request/response half.
 */
export abstract class WirePeer {
  protected readonly transport: WireTransport;
  private readonly framer = new LineFramer();
  private readonly notificationHandlers = new Map<string, Set<NotificationCallback>>();

  constructor(transport: WireTransport) {
    this.transport = transport;
    transport.onData((chunk) => {
      for (const line of this.framer.push(chunk)) {
        let msg: WireMessage;
        try {
          msg = decodeWireMessage(line);
        } catch {
          continue; // drop undecodable lines
        }
        this.handleMessage(msg);
      }
    });
    transport.onClose(() => this.handleClose());
  }

  /** Send a fire-and-forget notification to the peer. */
  notify(method: string, params?: unknown): void {
    const msg: WireNotification = {
      type: "notification",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.transport.send(encodeWireMessage(msg));
  }

  /** Subscribe to inbound notifications of one method. Returns an unsubscribe fn. */
  onNotification(method: string, cb: NotificationCallback): () => void {
    const existing = this.notificationHandlers.get(method);
    // `const set` (never reassigned) so the unsubscribe closure captures a
    // non-undefined type without a strict-mode narrowing complaint.
    const set = existing ?? new Set<NotificationCallback>();
    if (existing === undefined) this.notificationHandlers.set(method, set);
    set.add(cb);
    return (): void => {
      set.delete(cb);
    };
  }

  protected dispatchNotification(method: string, params: unknown): void {
    const set = this.notificationHandlers.get(method);
    if (set === undefined) return;
    for (const cb of set) cb(params);
  }

  /** Each half routes inbound requests/responses differently. */
  protected abstract handleMessage(msg: WireMessage): void;

  /** Overridable; WireClient rejects pending requests here. */
  protected handleClose(): void {
    /* default: nothing */
  }
}
```

- [ ] **Step 4: Create the WireClient**

Create `packages/shared/src/wire/client.ts`:

```ts
import { encodeWireMessage } from "./codec.js";
import { WirePeer } from "./peer.js";
import type { WireError, WireMessage, WireRequest } from "../types/wire-protocol.js";

/** Thrown when a wire request receives an error response. */
export class WireRequestError extends Error {
  readonly code: number;
  constructor(error: WireError) {
    super(error.message);
    this.name = "WireRequestError";
    this.code = error.code;
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

/**
 * The request-initiating half of the wire protocol (the orchestrator's adapter).
 * Sends requests and correlates responses by id; dispatches inbound notifications.
 */
export class WireClient extends WirePeer {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  /** Send a request; resolve with its result, or reject on error / close. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("wire: transport closed"));
    const id = `msg_${String(++this.seq)}`;
    const msg: WireRequest = {
      type: "request",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.send(encodeWireMessage(msg));
    });
  }

  protected handleMessage(msg: WireMessage): void {
    if (msg.type === "response") {
      const p = this.pending.get(msg.id);
      if (p === undefined) return;
      this.pending.delete(msg.id);
      if (msg.error !== undefined) p.reject(new WireRequestError(msg.error));
      else p.resolve(msg.result);
    } else if (msg.type === "notification") {
      this.dispatchNotification(msg.method, msg.params);
    }
    // inbound requests are not expected on the client; ignore
  }

  protected handleClose(): void {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("wire: transport closed"));
    this.pending.clear();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-client.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/wire/peer.ts packages/shared/src/wire/client.ts packages/shared/tests/wire-client.test.ts
git commit -m "feat(m10): wire peer base and request client"
```

---

## Task 6: WireServer

**Files:**
- Create: `packages/shared/src/wire/server.ts`
- Test: `packages/shared/tests/wire-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WireClient } from "../src/wire/client.js";
import { WireHandlerError, WireServer } from "../src/wire/server.js";
import { createMemoryTransportPair } from "./wire-test-utils.js";

describe("WireServer", () => {
  it("routes a request to its handler and returns the result", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("health", () => ({ ok: true, uptimeSeconds: 5, activeAgents: 0 }));
    expect(await client.request("health")).toEqual({ ok: true, uptimeSeconds: 5, activeAgents: 0 });
  });

  it("passes request params to the handler", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    let seen: unknown;
    server.handle("kill", (params) => {
      seen = params;
      return {};
    });
    await client.request("kill", { agentId: "a7" });
    expect(seen).toEqual({ agentId: "a7" });
  });

  it("awaits an async handler before responding", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", async () => {
      await Promise.resolve();
      return { pid: 42 };
    });
    expect(await client.request("spawn")).toEqual({ pid: 42 });
  });

  it("returns protocolMismatch (1030) for an unknown method", async () => {
    const pair = createMemoryTransportPair();
    new WireServer(pair.b);
    const client = new WireClient(pair.a);
    await expect(client.request("nope")).rejects.toMatchObject({ code: 1030 });
  });

  it("maps a thrown WireHandlerError to an error response", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", () => {
      throw new WireHandlerError(1020, "no binary");
    });
    await expect(client.request("spawn")).rejects.toMatchObject({ code: 1020, message: "no binary" });
  });

  it("maps an unexpected throw to internalError (1090)", async () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    server.handle("spawn", () => {
      throw new Error("kaboom");
    });
    await expect(client.request("spawn")).rejects.toMatchObject({ code: 1090 });
  });

  it("delivers notifications from the server to the client", () => {
    const pair = createMemoryTransportPair();
    const server = new WireServer(pair.b);
    const client = new WireClient(pair.a);
    const seen: unknown[] = [];
    client.onNotification("exit", (params) => seen.push(params));
    server.notify("exit", { agentId: "a1", code: 0 });
    expect(seen).toEqual([{ agentId: "a1", code: 0 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-server.test.ts`
Expected: FAIL — cannot resolve `../src/wire/server.js`.

- [ ] **Step 3: Create the WireServer**

Create `packages/shared/src/wire/server.ts`:

```ts
import { encodeWireMessage } from "./codec.js";
import { WirePeer } from "./peer.js";
import { WireErrorCode } from "../types/wire-protocol.js";
import type { WireError, WireMessage, WireResponse } from "../types/wire-protocol.js";

/** Thrown by a method handler to return a specific wire error to the caller. */
export class WireHandlerError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "WireHandlerError";
    this.code = code;
  }
}

type MethodHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * The request-handling half of the wire protocol (the agent-runner). Dispatches
 * inbound requests to registered handlers; can send and receive notifications.
 */
export class WireServer extends WirePeer {
  private readonly handlers = new Map<string, MethodHandler>();

  /** Register the handler for one request method. */
  handle(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  protected handleMessage(msg: WireMessage): void {
    if (msg.type === "request") {
      void this.runHandler(msg.id, msg.method, msg.params);
    } else if (msg.type === "notification") {
      this.dispatchNotification(msg.method, msg.params);
    }
    // inbound responses are not expected on the server; ignore
  }

  private async runHandler(id: string, method: string, params: unknown): Promise<void> {
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      this.sendError(id, {
        code: WireErrorCode.protocolMismatch,
        message: `unknown method: ${method}`,
      });
      return;
    }
    try {
      const result = await handler(params);
      const response: WireResponse = { type: "response", id, result };
      this.transport.send(encodeWireMessage(response));
    } catch (e) {
      if (e instanceof WireHandlerError) {
        this.sendError(id, { code: e.code, message: e.message });
      } else {
        this.sendError(id, {
          code: WireErrorCode.internalError,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  private sendError(id: string, error: WireError): void {
    const response: WireResponse = { type: "response", id, error };
    this.transport.send(encodeWireMessage(response));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-server.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/wire/server.ts packages/shared/tests/wire-server.test.ts
git commit -m "feat(m10): wire request server"
```

---

## Task 7: Barrel exports

**Files:**
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/wire-exports.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/wire-exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WIRE_PROTOCOL_VERSION,
  WireClient,
  WireServer,
  WireRequestError,
  WireHandlerError,
  encodeWireMessage,
  decodeWireMessage,
  LineFramer,
} from "../src/index.js";

describe("wire protocol public exports", () => {
  it("exposes the wire API from the package root", () => {
    expect(WIRE_PROTOCOL_VERSION).toBe(1);
    expect(typeof WireClient).toBe("function");
    expect(typeof WireServer).toBe("function");
    expect(typeof WireRequestError).toBe("function");
    expect(typeof WireHandlerError).toBe("function");
    expect(typeof encodeWireMessage).toBe("function");
    expect(typeof decodeWireMessage).toBe("function");
    expect(typeof LineFramer).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-exports.test.ts`
Expected: FAIL — the wire symbols are not exported from `../src/index.js`.

- [ ] **Step 3: Add the type re-export**

In `packages/shared/src/types/index.ts`, add this line at the end:

```ts
export * from "./wire-protocol.js";
```

- [ ] **Step 4: Add the wire-module re-exports**

In `packages/shared/src/index.ts`, add these lines after the existing exports:

```ts
export * from "./wire/transport.js";
export * from "./wire/codec.js";
export * from "./wire/client.js";
export * from "./wire/server.js";
```

(Do not export `./wire/peer.js` — `WirePeer` is an internal base class, not public API.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/shared exec vitest run tests/wire-exports.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @prospero/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/types/index.ts packages/shared/src/index.ts packages/shared/tests/wire-exports.test.ts
git commit -m "feat(m10): export wire protocol from shared package"
```

---

## Task 8: Revise the wire-protocol doc

**Files:**
- Modify: `docs/m10-adapter-wire-protocol.md` (full rewrite)

- [ ] **Step 1: Replace the document**

Overwrite `docs/m10-adapter-wire-protocol.md` with the content below. It revises the M7.5 draft to match what PR-A implements: a single SSH/docker-run stdio transport (no WSS), camelCase params, raw `stdout` lines instead of parsed `event`s, semantic `spawn` args, and the new MCP relay channel.

````markdown
# M10 Adapter Wire Protocol

> **Status:** implemented incrementally by M10. The transport and message types
> land in M10 PR-A; the agent-runner that serves it lands in PR-B; the host
> adapter that drives it lands in PR-C.

This document defines the protocol that the orchestrator (Electron main
process) and the remote agent runner (a Docker container — local, or on a VPS)
speak. It is transport-agnostic: it runs over any bidirectional byte channel as
newline-delimited JSON, one message per line.

## Transport

The orchestrator launches the runner as a child process and speaks the protocol
over that child's stdin/stdout; the child's stderr carries diagnostic logs.
There is no framing beyond `\n`.

The child process is one of:

- **Local Docker** (validation): `docker run -i prospero/agent-runner`
- **Remote VPS**: `ssh <user>@<host> -- docker run -i prospero/agent-runner`

SSH supplies authentication, encryption, and the pipe — no port is exposed and
no TLS certificate is managed. The two cases differ only by the `ssh` prefix, so
the adapter code is identical.

## Versioning

A single integer `protocolVersion` is sent in the handshake; the current
version is **1**. Breaking changes bump it; non-breaking additions (new optional
fields, new notification kinds a receiver may ignore) keep it.

## Message envelope

Every message is one line of JSON. Object keys are camelCase.

```json
{ "type": "request" | "response" | "notification",
  "id": "msg_<n>", "method": "<name>", "params": { } }
```

`response` objects mirror their request's `id` and carry either `result` or
`error`. `notification` objects omit `id`. `id` is any string unique within one
connection — the client uses a monotonic `msg_<n>` counter.

## Requests (host → runner)

### handshake

First message. Negotiates protocol version and forwards credentials.

- params: `{ protocolVersion, client, clientVersion, credentials: { kind: "oauth", oauthToken } }`
- result: `{ protocolVersion, server, serverVersion, capabilities: string[] }`

### spawn

Starts a `claude` child for one agent. `args` is the `claude` argv built
host-side by `buildClaudeArgs`, **minus the MCP triplet** — the runner appends
`--mcp-config <container path>` / `--strict-mcp-config` /
`--permission-prompt-tool mcp__dashboard__request_permission` itself, and
chooses the working directory.

- params: `{ agentId, args: string[], env?: Record<string,string> }`
- result: `{ pid }`

### stdin-write

Writes one line of JSONL to a spawned child's stdin.

- params: `{ agentId, line }`

### kill

Terminates a spawned child.

- params: `{ agentId }`

### health

Liveness check.

- params: none
- result: `{ ok, uptimeSeconds, activeAgents }`

## Notifications

### stdout (runner → host)

One raw line from a child's stdout. The host parses it with `stream-parser.ts`.

- params: `{ agentId, line }`

### stderr (runner → host)

One diagnostic stderr line, with token-shaped substrings redacted.

- params: `{ agentId, line }`

### exit (runner → host)

A child exited.

- params: `{ agentId, code: number | null }`

### mcp-open (runner → host)

`claude`'s MCP bridge connected; the host spawns its `mcp/server.js` subprocess
for this agent.

- params: `{ agentId }`

### mcp-data (both directions)

One line of MCP JSON-RPC. Runner → host carries the bridge's stdout; host →
runner carries the host MCP server's stdout, to be written to the bridge.

- params: `{ agentId, line }`

### mcp-close (runner → host)

The MCP bridge disconnected; the host tears down the MCP subprocess.

- params: `{ agentId }`

## Error codes

| code | name                  | meaning                                          |
| ---- | --------------------- | ------------------------------------------------ |
| 1000 | unsupportedProtocol   | handshake `protocolVersion` not understood       |
| 1001 | unsupportedCredentials| runner rejects the credential kind               |
| 1010 | agentNotFound         | request references an unknown `agentId`          |
| 1020 | spawnFailed           | the `claude` child failed to start               |
| 1030 | protocolMismatch      | unknown method, or a message fails its schema    |
| 1040 | unauthorised          | credentials rejected                             |
| 1090 | internalError         | unexpected runner failure                        |

## Security

- **Transport security is SSH's** — authentication and encryption come from the
  SSH connection; for local Docker the channel never leaves the host.
- **Credentials travel once**, in the `handshake`; the runner sets them as the
  `claude` child's environment and never writes them to disk or logs them.
- **stderr is redacted** by the runner — token-shaped substrings are stripped
  before forwarding.
- **health exposes only counts**, never agent IDs or content.
- **The host stays authoritative** — the SQLite DB, the MCP server, the events
  watcher and the permission gate all run host-side; only `claude` runs in the
  container.
````

- [ ] **Step 2: Commit**

```bash
git add docs/m10-adapter-wire-protocol.md
git commit -m "docs(m10): revise wire protocol for ssh stdio and mcp relay"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every package**

Run: `pnpm -r typecheck`
Expected: all packages green, no errors.

- [ ] **Step 2: Lint every package**

Run: `pnpm -r lint`
Expected: all packages green. (`packages/shared` lints `src/` only; the new `src/wire/` files must be clean.)

- [ ] **Step 3: Run the whole test suite**

Run: `pnpm -r test`
Expected: all suites green. The 831 baseline tests still pass; the new wire-protocol tests add 30 (4 + 10 + 3 + 5 + 7 + 1), so the `packages/shared` count rises from 33 to ~63.

- [ ] **Step 4: Confirm no behavior change**

Confirm `git log --oneline` for this PR shows 8 commits (Tasks 1–8) and that nothing under `apps/` was modified — PR-A is foundation only; `apps/main` and the future `apps/agent-runner` consume this code in PR-C and PR-B.

---

## Self-Review notes

- **Spec coverage (§10 row A):** shared types ✓ (Task 1), encode/decode/framing ✓ (Tasks 2–3), client+server primitives ✓ (Tasks 5–6), error codes ✓ (Task 1), revised wire-protocol doc ✓ (Task 8). "Pure, no behavior change" ✓ (Task 9 Step 4).
- **Spec §4 revisions:** SSH stdio (doc Transport section) ✓, raw `stdout` notification ✓, semantic `spawn` args ✓, MCP relay channel `mcp-open`/`mcp-data`/`mcp-close` ✓ — all defined in `wire-protocol.ts` (Task 1) and documented (Task 8).
- **Out of scope for PR-A (later PRs):** zod validation of params (apps add it — PR-B/PR-C), the real stdio `WireTransport` over a child process (PR-C), the `agent-runner` that uses `WireServer` (PR-B), registering `claude-oauth-remote-docker` in `adapters/index.ts` (PR-C).
- **Type consistency:** `WireTransport` (send/onData/onClose) is consumed identically by `WirePeer`, `WireClient`, `WireServer`, and `createMemoryTransportPair`. `WireMessage`/`WireRequest`/`WireResponse`/`WireNotification` are used consistently across codec, peer, client, server. Error codes referenced by number in tests match `WireErrorCode` values.
