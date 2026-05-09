# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
