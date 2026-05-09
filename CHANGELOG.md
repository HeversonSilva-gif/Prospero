# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
