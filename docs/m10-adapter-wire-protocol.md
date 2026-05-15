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

- **Local Docker** (validation): `docker run -i dashboard-agent/agent-runner`
- **Remote VPS**: `ssh <user>@<host> -- docker run -i dashboard-agent/agent-runner`

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

| code | name                   | meaning                                       |
| ---- | ---------------------- | --------------------------------------------- |
| 1000 | unsupportedProtocol    | handshake `protocolVersion` not understood    |
| 1001 | unsupportedCredentials | runner rejects the credential kind            |
| 1010 | agentNotFound          | request references an unknown `agentId`       |
| 1020 | spawnFailed            | the `claude` child failed to start            |
| 1030 | protocolMismatch       | unknown method, or a message fails its schema |
| 1040 | unauthorised           | credentials rejected                          |
| 1090 | internalError          | unexpected runner failure                     |

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
