# Security

## Reporting

If you discover a security issue, please **do not open a public issue**. Email the maintainer directly or open a private security advisory on GitHub.

## Threat model

This app runs agents (Claude Code subprocesses) on your machine with access to:

- Filesystem (Read/Write/Edit) within `allowed_projects_json` of each agent
- Shell commands (Bash) with deny-list of destructive operations
- Network (within tools the agents call)

Threats covered (per Spec §8):

- OAuth token exfiltration → DPAPI encryption + filesystem allowlist + Bash deny-list
- Prompt injection → heuristic detector + auto-mode degradation
- MCP local exploit → ephemeral per-agent tokens
- Supply chain → lockfile + audit + Renovate

## Token rotation

Generate a new token with `claude setup-token`, then paste it in Settings.

## Incident runbook

See `docs/superpowers/specs/2026-05-09-prospero-design.md` §8.9 (full runbook lands in M7+).

## Architectural decisions

### Blocklist `gate.ts §8.3` persists across adapters

Even when M10 lands the remote-Docker adapter, the in-process command blocklist
(`apps/main/src/security/gate.ts`) stays as defense-in-depth on top of Docker
sandboxing. The trade-off is the cost of two filtering layers; the upside is
that we still block a known-bad command if a container escape (mount-based
breakout, missing user namespace on the host kernel, or a misconfigured volume)
defeats the Docker layer.

### Per-agent `CLAUDE_CONFIG_DIR` + `--strict-mcp-config`

Sandbox lockdown from M3 stays in M7.5 PR-A's adapter pattern: every agent gets
its own config directory under `userData/.../agent-<id>`, the OAuth credentials
are copied (not symlinked) into that dir, and the spawned claude CLI runs with
`--strict-mcp-config` pointing at a per-spawn ephemeral MCP server registry.
Without these, an agent could read another agent's session history or load an
attacker-controlled MCP server.

## Adapter threat models

The M7.5 PR-A `AgentAdapter` interface defines a stable extension point. Each
concrete adapter has its own threat surface; they share the gate.ts blocklist
and per-agent config sandbox but differ in credential handling and execution
locus.

### `claude-oauth-local` (current)

- **Locus:** same machine as the app, child process of Electron main.
- **Credentials:** OAuth refresh token decrypted with DPAPI/safeStorage on
  Windows + macOS keychain on macOS + libsecret on Linux. The decrypted plain
  token is passed through the `ANTHROPIC_*` environment of the spawned claude
  child, never written to disk.
- **Primary threat:** an agent uses `Bash` or `Edit` with absolute paths to
  escape its sandbox CWD or read the user's home directory.
- **Mitigations:** gate.ts blocklist (covers `rm`, `chmod`, network exfil), the
  file-fence pattern from M5 (`allowed_projects_json` per agent), per-agent
  `CLAUDE_CONFIG_DIR`, and `--strict-mcp-config` so the agent can't load an
  attacker-controlled MCP server through a stray settings file.

### `claude-api-key-local` (M9 PR-D, 2026-05-14 ✅)

- **Locus:** same machine.
- **Credentials:** Anthropic API key encrypted via `safeStorage` in the `settings`
  table (keys `auth.apikey.{ciphertext,prefix,configured_at}`). Renderer only ever
  sees the masked prefix (`sk-ant-api03-…XXXX`); the raw key never crosses the
  IPC boundary back to the renderer.
- **Spawn shape:** sandbox `CLAUDE_CONFIG_DIR` per agent (same as OAuth), but
  `seedSandboxCredentials` is **skipped** — no `.credentials.json` is written.
  Instead `ANTHROPIC_API_KEY=<decrypted>` is passed via env on spawn.
  `--strict-mcp-config` remains active.
- **Primary threat:** API key in plaintext appearing in process listings,
  command-line history, logs, or crash dumps.
- **Mitigations:** key is passed only via environment (not argv), redacted in
  all log surfaces via `token-redact.ts`, never persisted to a temp file.
- **Concurrency cap:** **no cap** — Anthropic's API gateway enforces the
  account's rate limit. The 4-agent cap from `lifecycle.ts` is gated on
  `agent.adapterName === 'claude-oauth-local'` and skipped for API key agents.
- **Mode selection:** `AppSettings.authMode` (`'oauth' | 'api-key'`, default
  `'oauth'`). Set via Settings UI or Setup Wizard. Changing the mode applies
  to **new agents only**; existing agents keep their `adapter_name` (set at
  creation) until terminated and respawned. Both OAuth and API key blobs
  coexist in `safeStorage` — switching modes does not delete the other.

### `claude-oauth-remote-docker` (M10, 2026-05-15 ✅)

- **Locus:** the `claude` process runs inside a Docker container — local Docker
  for the validation path, or a VPS via SSH. Everything stateful (SQLite, MCP
  server, permission handshake, the chokidar watcher) stays on the host: the
  container runs only `claude` plus a "dumb" agent-runner that proxies stdio.
- **Transport:** a single SSH stdio channel (`docker run -i` locally; `ssh …
  -- docker run -i` for a VPS). SSH supplies auth, encryption, and the pipe —
  there is no open port, no WSS, and no X.509 certificate lifecycle. WSS+mTLS
  was considered and rejected (M10 design §2, §11).
- **Credentials:** the OAuth token travels once, in the wire-protocol
  `handshake` message, encrypted by the SSH transport (loopback only for local
  Docker). The runner injects it as the `CLAUDE_CODE_OAUTH_TOKEN` environment
  variable of the spawned `claude` child — never written to disk in the
  container, never logged (the runner redacts tokens in stderr before
  forwarding via `redactSecrets`).
- **Primary threats:** in-flight credential interception, Docker escape, host
  network egress from a compromised container.
- **Mitigations:** SSH provides transport auth + encryption; the SSH host key
  is pinned (`StrictHostKeyChecking=yes`, `BatchMode=yes` — a forged host fails
  the connection, no interactive trust prompt). The container runs as a
  non-root user behind `tini` as PID 1, with `--strict-mcp-config` (the
  generated `mcp.json` only references the loopback MCP bridge) and no mounted
  host paths. The container work directory is ephemeral — removed when the
  `--rm` container exits.
- **MCP / DB isolation:** the SQLite database never leaves the host. The MCP
  server (`mcp/server.js`) is spawned on the host by an `McpRelay`; the
  container reaches it only through the tunnelled wire-protocol channel. The
  `gate.ts` command blocklist therefore still runs host-side on every MCP
  call — Docker isolation **plus** the command gate is defense-in-depth, not a
  replacement (see "Blocklist `gate.ts §8.3` persists across adapters" above).
- **Concurrency cap:** counts against the 4-agent OAuth cap in `lifecycle.ts`,
  same as `claude-oauth-local` — `isOauth` covers both adapter names.
- **Setup:** see `docs/m10-vps-setup-runbook.md` for VPS provisioning and the
  local-Docker smoke checklist.

## Containment zones (M13 PR-E)

A declared map of privacy zones layered on top of the per-agent sandbox CWD.
Every absolute path that an FS tool tries to touch is classified by
`apps/main/src/security/zones.ts`:

- `companies/<cid>/...` and the equivalent suffix under the `agent-instructions/`
  and `memory/` prefixes → **company** zone (when the path doesn't dive into a
  specific agent).
- `companies/<cid>/agents/<aid>/...` (and the equivalent under the other two
  prefixes) → **agent** zone.
- Anything outside this tree → no opinion (the existing path-fence decides).

The gate denies any access that falls into a known zone the actor cannot
reach:

- An agent can touch its own agent zone and the company zone it belongs to.
- Cross-company, cross-agent, and system zones are denied.

Every deny is audited as a `security.zone_blocked` activity event and (since
M13 PR-F) creates a non-actionable inbox card with the attempted path and
reason, de-duplicated within a 5-minute window so an agent loop cannot spam
the inbox. **This is defense-in-depth**: the path-fence is still the primary
filter — the zone check can only add denials, never lift them.

## Verification as an attack surface (M13 PR-B)

The verification engine treats an issue as "done" when its criteria pass.
That makes the criterion-check path itself a target: a misbehaving agent
might mark criteria as `passed` without actually doing the work.

Current mitigations:

- `criterion_judge` records the `verified_by` agent id (audit row); a
  judgment from agent A is always attributable to agent A.
- Deterministic criteria (command, artifact, metric) cannot be self-judged
  via `criterion_judge`; they only flip when the engine runs the check.

Known gap (tracked for V2):

- `criterion_check` is self-reported by the agent doing the work. There is
  no enforcement that the judge of a judgment criterion is a different agent
  than the implementer. A bad-actor agent that knows the gate exists can
  still mark its own judgment criteria passed.

The right hardening is forcing `criterion_judge` to require an actor distinct
from the issue's assignee. Spec'd, not implemented in v1.

## Memory and skills as injection vectors

Memory entries and skill bodies are injected verbatim into every agent system
prompt (`buildMemoryBlock` in `apps/main/src/orchestrator/system-prompt-memory.ts`).
A hostile string stored in memory or a skill body would appear in the system
prompt of every future session, making these write paths a critical attack
surface.

**Shared sanitizer.** `apps/main/src/memory/sanitizer.ts` runs on all write
paths before any string is persisted: the agent-facing MCP tools
(`skill_create`, `skill_update`, `memory_add`), and the derivation pipeline
output. The pipeline produces LLM-generated text and is treated as equally
untrusted as agent input. The sanitizer blocks prompt-injection phrases
("ignore previous instructions", system-prompt disclosure requests, XML-style
instruction tags) and the same shell-command and sensitive-path blocklists used
by `gate.ts`.

**Skill candidates require human review.** Derivation-produced skill candidates
go through an Accept / Edit / Reject step in the Inbox before a `skills` row
and `SKILL.md` file are created. The user is the reviewer; the sanitizer has
already run on the candidate body before it appears in the review UI.

**Pinned memories and promoted skills are read-only to agents.** `memory_remove`
rejects pinned entries. `skill_update` rejects promoted skills. Only the user
can modify these through the Settings or Inbox UI.

**`user.md` is the trusted authoring path.** The file is written by the user
via the Settings Memory editor, and the sanitizer does not run on it — the user
is the trusted author. The content is hard-truncated at 1 024 characters at
injection time, so an unexpectedly large file cannot inflate the system prompt
beyond that bound.

## Approvals and artifacts storage (foundation)

M7.5 PR-B introduced two new persistence surfaces; both intentionally avoid
storing secrets.

- `approvals.payload_json` records the operation an agent asked for permission
  to perform (tool name, arguments). It must not contain credentials. The
  audit history is single-user and local; if it grows to include team data,
  add field-level redaction.
- `issue_artifacts.content_preview` is capped at 4 KB by Zod validation in the
  `record_artifact` MCP tool (`apps/main/src/mcp/tools.ts`). Preview text is
  raw user-visible content (no parsing), so it cannot escape its column.
- The pre-push `gitleaks` hook catches accidental secret commits across all
  paths.
