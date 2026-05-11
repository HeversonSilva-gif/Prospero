# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## M6.1 — Smoke-test hardening (2026-05-11)

Follow-up pass on the M6 branch after smoke testing surfaced security gaps,
orchestration bugs, and UX papercuts.

### Security
- **Per-agent sandbox CWD.** Agents previously spawned with `process.cwd()`
  (the Electron main process's own dir), letting `ls`/`pwd`/`cat README.md`
  leak files the agent had no project access to. Now each agent gets
  `userData/agent-sandbox/<id>/cwd/` as its working directory — an empty,
  isolated dir per agent. Project work requires absolute paths (the gate
  validates them).
- **Quoted-path bypass closed.** The gate's `extractPathLikeTokens` split
  commands by whitespace and matched `^[A-Za-z]:[\\/]` at token start —
  `ls "D:\Projetos pessoais\MTT"` produced `["\"D:\\Projetos", "pessoais\\MTT\""]`,
  neither matching the pattern, so quoted absolute paths bypassed the check.
  Replaced the regex split with a shell-aware tokenizer that respects single
  and double quotes.
- **Bash path outside allowed → `deny` (was `request_user`).** Consistent
  with FS tools. The "always-blocked" branch (sensitive system paths) still
  returns `request_user` so the operator can override with explicit consent.
- **`NO_ACCESS_SENTINEL`** added to `Agent.allowedProjects` semantics:
  `[]` continues to mean "all projects" (existing model), `[NO_ACCESS_SENTINEL]`
  means "no access at all". Without this, revoking the only allowed project
  from an agent would flip back to "all access".
- **Gate path resolution** now uses the agent's CWD (passed via `GateInput.agentCwd`)
  instead of `process.cwd()` for relative-path resolution.

### Orchestration
- **File-based event channel replaces stderr.** MCP-child events (`agent.deliver`,
  `agent.kill`, `agent.spawn-needed`, `issue.created/updated`, new
  `user.message-append`) emitted via JSON files in `userData/agent-events/`
  watched by chokidar. Stderr forwarding from the MCP child through Claude CLI
  was unreliable on Windows — inter-agent delivery was silently dropping.
- **`list_projects` MCP tool** so agents can discover their allowed projects
  by path. Pre-allowed in the per-agent sandbox `settings.json`.
- **`report_to_user` MCP tool** lets an agent message the user in the main
  `[user, agent.id]` thread. Without this, an agent's reply after a delegated
  agent responded landed only in the inter-agent thread (Delegações tab)
  and the user never saw the result.
- **System-prompt preamble** prepended to every agent's `systemPrompt`
  (sandbox contract, `list_projects` discovery, `message_agent` fire-and-forget
  semantics, `report_to_user` after delegation).
- **Issue assignment wake-up.** Creating or reassigning an issue via the UI
  now writes an `agent.deliver` event with `senderKind: "user"` so the
  assignee receives a `[issue assigned]` message and the orchestrator
  spawns/wakes their runner.
- **Post-migration 0003** clears stale `claude_session_id` once after the CWD
  change so Claude doesn't fail with "No conversation found" on the first
  spawn after upgrade. Idempotent via `settings.post_migration_0003_done`.

### UX
- **Chat / Delegações tabs** on the agent view, split by `Message.threadParticipants`
  (threads containing `"user"` → Chat; agent↔agent → Delegações).
- **Delegations panel** groups by other agent with timestamps and directional
  labels (`Bob → CEO`, `CEO → Bob`).
- **Avatar fix** — `MessageList` was hardcoded to "CE" for every non-user
  message; now resolves initials by `senderId` lookup.
- **`AgentAccessSection`** replaces the per-agent popover with tag-style chips
  (click chip to revoke; "+ Agente" picker for ungranted agents).
- **`ConfirmModal`** replaces `window.confirm()` in projects/issues delete
  flows — same overlay style as `ProjectFormModal`.
- **Kanban fluidity** — `issue.onChanged` events now target the changed issue
  via `issues.get(id)` + store-level `replace/upsert/remove`, instead of
  reloading the whole list. Stable array references keep dnd-kit's transient
  state intact through drag/drop.

### Bug fixes
- **`Message.threadParticipants` parsing** — `participants_json` column stores
  a sorted pipe-joined string (`"agent_x|user"`), not JSON. `JSON.parse` was
  throwing in `listByAgentParticipating`, silently failing the map and
  returning empty messages. Split on `|` instead.

### Tests
- 185 → 194 passing. New: gate-quoted-path regression × 3, post-migration 0003 × 3,
  `messages.listByAgentParticipating` × 1 (regression for participants parsing),
  `EVENTS_DIR` propagation.

---

## M6 — Issues + Projects (2026-05-10)

### Added
- Two new tables: `issue_comments` and `issue_events` (migration 0002)
- Auto-migration: `settings.workspaceCwd` becomes a "Default Workspace" project on first M6 startup
- `/projects` route with master/detail layout, folder picker, fixed-palette color picker, per-agent allowlist toggle
- `/issues` kanban (5 status columns) with `@dnd-kit` drag-drop and project/assignee/priority filters
- Issue detail modal (URL `/issues?selected=<id>`) with comments timeline, sub-tasks tree, tool-call history accordion, reassign dropdown
- 5 real MCP tools for agents: `create_issue`, `update_issue`, `assign_issue`, `list_issues`, `check_status`
- `update_issue` with `status=done` writes a `completed` inbox notification
- Real-time renderer updates: orchestrator emits `issue.created`/`issue.updated` → broadcast → kanban refresh

### Changed
- Sandbox: `gate.ts` now accepts `allowedProjectPaths: string[]` (union of projects the agent has access to) instead of a single `workspaceCwd`. Existing tests + permission-watcher updated.
- Agent type gains `allowedProjects: string[]` field (empty = allow all per spec)
- Settings UI: workspace folder picker removed; replaced with deprecation note linking to /projects

### Removed
- Stub `create_issue` MCP tool (returned mocked payload) — replaced with real persistence

### Dependencies
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (~10kb gzipped, MIT)

### Tests
- 147 → 185 passing
- Lint + typecheck: 0 errors
- New regression-guards: project-aware sandbox gate, migration 0002 enums, post-migration idempotency, MCP tools issues

---

## [Unreleased]

### Added — M3 Orchestrator + MCP core (complete)

- Spawn real `claude -p --output-format stream-json --mcp-config ...` per agent, with OAuth token injected via env (never in args, never logged, never crosses to renderer)
- Hard cap of 4 concurrent agents (per Anthropic ToS for OAuth-based personal plans)
- Internal MCP server (`@modelcontextprotocol/sdk`) bundled as separate Node entry, exposing 5 mock orchestration tools (`list_agents`, `hire_agent`, `create_issue`, `message_agent`, `notify_user`)
- Stream-json line parser converts Claude events (session-init, tool-use-start, tool-result, text-delta, message-stop, api-retry) into typed `ParsedEvent`
- Companies, Agents, Messages, Inbox repositories with TDD (33 new tests, 79 total)
- Agent chat UI with message bubbles and tool-call cards rendered in real time as Claude streams
- Sidebar dynamic agents section + "Create demo company" button on Dashboard
- Session resumption via `--resume <session_id>` persisted in `agents.claude_session_id`
- Inbox items auto-created when MCP tool calls fire (parsed from MCP server stderr JSONL)
- i18n keys for agent UI (pt-BR + en-US, fully synchronized)

### Added — M2 Auth & Settings (complete)

- OAuth token storage via Electron `safeStorage` (DPAPI on Windows; never logged or returned raw to renderer)
- SQLite-backed `AppSettings` (language pt-BR/en-US, theme light/dark) with Zod validation
- IPC channels for settings (`get`, `update`) and auth (`status`, `set`, `detect`, `clear`)
- Auto-detection of OAuth token from `~/.claude/.credentials.json` (opt-in via wizard)
- First-run setup wizard with manual paste + step-by-step instructions OR auto-detect
- Settings page showing redacted token preview, source, and clear action
- Theme switcher (☀/☾) and language switcher (PT/EN) in sidebar footer — both persist in SQLite, applied without reload
- React Router 6 (HashRouter for `file://` compatibility) with first-run gate
- Token redact filter + well-formedness check; gitleaks rules updated for placeholder tokens in tests/docs
- 46 unit + integration tests across main process

### Added — M1 Foundation (complete)

- pnpm monorepo skeleton (apps/main, apps/renderer, packages/shared)
- Electron 33 main process with tray icon (hide-on-close keeps app alive)
- React 18 + Vite 5 + Tailwind 3 renderer with Subido PRO palette and Poppins
- IPC bridge (ping/pong) end-to-end via contextBridge with sandbox + contextIsolation
- SQLite (better-sqlite3) with migration runner using PRAGMA user_version
- Initial migration `0001_initial.sql` with 11 tables and 6 indexes (Spec §5.3)
- Strict TypeScript across all workspaces (noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- Pre-commit hooks: gitleaks (rejects fake OAuth tokens), lint-staged (Prettier + ESLint),
  commitlint (Conventional Commits)
- GitHub Actions CI: lint + typecheck + test + build + audit + gitleaks scan
- Auto rebuild of native modules across Node/Electron ABIs (predev/prestart/pretest)
- Open-source seed: LICENSE (MIT), README, SECURITY, CONTRIBUTING, CHANGELOG
