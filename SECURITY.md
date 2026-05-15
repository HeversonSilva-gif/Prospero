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

### `claude-oauth-remote-docker` (M10 future)

- **Locus:** different machine — a hardened VPS running the agent runner inside
  a non-root Docker container.
- **Credentials:** OAuth token is sent over the wire-protocol channel (mutual
  TLS over WSS, see `docs/m10-adapter-wire-protocol.md`) and held only in the
  container's memory.
- **Primary threats:** in-flight credential interception, Docker escape, host
  network egress from a compromised container.
- **Mitigations:** mutual TLS with pinned cert, container runs as a non-root
  user behind `tini`, host iptables policy denies outbound except to the
  Anthropic API endpoint, container has no mounted host paths.

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
