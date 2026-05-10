# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

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
