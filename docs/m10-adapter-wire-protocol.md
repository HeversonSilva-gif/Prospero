# M10 Adapter Wire Protocol

> **Status:** design draft, not implemented. Lands with M10 (Docker remote
> adapter `claude-oauth-remote-docker`).

This document defines the JSON-RPC schema that the orchestrator (Electron main
process) and the remote agent runner (Docker container on a VPS) speak. The
same protocol works over two transports — stdio for local-subprocess testing
and WSS for the production remote case — so the orchestrator's adapter code is
identical except for the transport bootstrap.

## Versioning

A single integer `protocol_version` field is sent in the handshake; the current
version is **1**. Breaking changes bump the integer; non-breaking additions
(new optional fields, new notification kinds the receiver may ignore) keep it.

## Transports

### `stdio` (local testing)

The orchestrator launches the runner as a child process, communicates over the
child's stdin/stdout (line-delimited JSON, one message per line), and reads
diagnostic logs from stderr. No framing beyond `\n`.

### `wss` (production)

The orchestrator opens a WebSocket Secure connection to
`wss://<vps-host>:9700/v1/agent`. Both peers present X.509 certificates
(mutual TLS). The orchestrator pins the runner's certificate fingerprint from
settings. Each message is one WebSocket text frame containing one JSON object.

## Message envelope

Every message has at minimum:

```json
{
  "type": "request" | "response" | "notification",
  "id": "msg_<uuid>",
  "method": "<name>",
  "params": { ... }
}
```

`response` objects mirror the `id` of the original request and add either
`result` or `error`. `notification` objects omit `id`.

## Methods

### `handshake` (request → response)

First message. Negotiates protocol version and credentials.

```json
{
  "type": "request",
  "id": "msg_h1",
  "method": "handshake",
  "params": {
    "protocol_version": 1,
    "client": "dashboard-agent",
    "client_version": "0.7.5",
    "credentials": {
      "kind": "oauth",
      "oauth_token": "<redacted>"
    }
  }
}
```

Response on success:

```json
{
  "type": "response",
  "id": "msg_h1",
  "result": {
    "protocol_version": 1,
    "server": "agent-runner",
    "server_version": "0.1.0",
    "capabilities": ["spawn", "stdin", "kill", "health"]
  }
}
```

### `spawn` (request → response)

Asks the runner to start a claude child for one agent.

```json
{
  "type": "request",
  "id": "msg_s1",
  "method": "spawn",
  "params": {
    "agent_id": "agent_42",
    "args": ["--model", "claude-sonnet-4-6", "--strict-mcp-config", "--mcp-config", "..."],
    "env": { "ANTHROPIC_API_URL": "..." },
    "cwd": "/var/lib/agent-state/agent_42"
  }
}
```

Response:

```json
{ "type": "response", "id": "msg_s1", "result": { "pid": 1234 } }
```

### `stdin-write` (request → response)

Sends one line of JSONL to the spawned child's stdin.

```json
{
  "type": "request",
  "id": "msg_in1",
  "method": "stdin-write",
  "params": { "agent_id": "agent_42", "line": "{\"type\":\"user\",...}\n" }
}
```

### `kill` (request → response)

Terminates the spawned child.

```json
{ "type": "request", "id": "msg_k1", "method": "kill", "params": { "agent_id": "agent_42" } }
```

### `event` (notification)

Runner pushes parsed events from the child's stdout to the orchestrator.

```json
{
  "type": "notification",
  "method": "event",
  "params": {
    "agent_id": "agent_42",
    "event": { "kind": "assistant-message", "blocks": [...] }
  }
}
```

### `stderr` (notification)

Runner forwards diagnostic stderr lines.

```json
{
  "type": "notification",
  "method": "stderr",
  "params": { "agent_id": "agent_42", "line": "..." }
}
```

### `exit` (notification)

Child exited; runner reports the code.

```json
{
  "type": "notification",
  "method": "exit",
  "params": { "agent_id": "agent_42", "code": 0 }
}
```

### `health` (request → response)

Liveness check.

```json
{ "type": "request", "id": "msg_hl1", "method": "health" }
```

Response:

```json
{
  "type": "response",
  "id": "msg_hl1",
  "result": { "ok": true, "uptime_seconds": 120, "active_agents": 3 }
}
```

## Error codes

| code | name                      | meaning                                                      |
| ---- | ------------------------- | ------------------------------------------------------------ |
| 1000 | `unsupported_protocol`    | handshake `protocol_version` not understood                  |
| 1001 | `unsupported_credentials` | runner doesn't accept the provided credential kind           |
| 1010 | `agent_not_found`         | request references an `agent_id` the runner doesn't have    |
| 1020 | `spawn_failed`            | claude child failed to start (binary missing, etc.)          |
| 1030 | `protocol_mismatch`       | message doesn't match the schema for its `method`            |
| 1040 | `unauthorised`            | TLS auth failed or token rejected by Anthropic               |
| 1090 | `internal_error`          | unexpected runner crash                                      |

## Security

- **mutual TLS over WSS** with pinned certificate fingerprint.
- **credentials in handshake only** — never sent again; future calls reference
  the established session.
- **stderr lines are redacted** by the runner before forwarding (regex strip of
  any token shape).
- **healthchecks expose only counts**, never agent IDs or content.
- **rate limits** at runner edge: max 100 `stdin-write` per agent per second
  (anti-abuse if orchestrator misbehaves).

## Local-subprocess equivalence

The local `claude-oauth-local` adapter does not speak this protocol; it spawns
claude directly. The same wire-protocol is used by a future local-Docker
adapter (`claude-oauth-local-docker`, optional, not in M10 scope) for users who
want container isolation on their own machine.
