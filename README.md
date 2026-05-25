# Prospero

> **[🇧🇷 Leia em Português](README.pt-BR.md)**

[![Version](https://img.shields.io/badge/version-0.1.10-blue)](https://github.com/HeversonSilva-gif/Prospero/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](https://github.com/HeversonSilva-gif/Prospero/releases/latest)
[![Tests](https://img.shields.io/badge/tests-1757_passing-brightgreen)](#status)

---

**Build a one-person business backed by a whole company of AI.**

Prospero runs a hierarchy of Claude Code agents on your Windows desktop — CEO, engineers, QA, PM — coordinating automatically, using the **Claude Max plan you already pay for**. You describe what you want; the CEO proposes a plan and who to hire; agents do the work; you review what matters.

No separate API key. No cloud. Your data stays in SQLite on your machine.

> ⚠️ **This is vibecoded.** Prospero was built almost entirely by Claude Code, driven conversationally with a human steering direction and testing each step. It's an experimental personal project — not a hardened commercial product. Read the [Disclaimer](#disclaimer) before running it.

---

<!-- DEMO PLACEHOLDER — screenshot / GIF coming soon with Brand Kit -->
> 🎬 *Screenshot and demo GIF coming soon.*

---

## What it is

- **A local agent orchestrator** — Electron desktop app (Windows x64). All data in SQLite. Nothing in the cloud.
- **A hierarchy of Claude agents** — CEO plans and delegates, specialists execute. Up to 4 agents run in parallel (Claude Max's safe concurrency limit).
- **Memory and skills that grow** — agents accumulate cross-session memory and reusable skills. What one agent learns, the whole company keeps.
- **Outcome-driven work** — goals carry explicit success criteria; work is verified before it's marked done.
- **A trust ladder** — agents that build a verified track record earn more autonomy over time. You are always in control.

## Why Claude Max instead of an API key

If you already pay for Claude Max, you shouldn't need a separate Anthropic API key just to run agents. Prospero uses `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) so all agent activity counts against your existing subscription — no extra billing surface.

Three auth modes are supported, choosable per agent:

| Mode | When to use |
|---|---|
| **Claude Max OAuth** (default) | You have a Claude Max plan — zero extra cost |
| **Anthropic API key** | Pay-per-token, no subscription needed |
| **Remote Docker (VPS)** | Agents run in isolated containers on a server you control |

## Install

**Download the installer (easiest)**

Go to the [Releases page](https://github.com/HeversonSilva-gif/Prospero/releases/latest) and download `Prospero-Setup-x.y.z.exe` (Windows x64).

The installer is currently **unsigned** — Windows SmartScreen will warn on first run. Choose **More info → Run anyway**. After that, the app keeps itself up to date automatically.

**Prerequisites:** [Claude Code CLI](https://docs.anthropic.com/claude-code) installed, plus a token from `claude setup-token`.

**Run from source**

```bash
git clone https://github.com/HeversonSilva-gif/Prospero.git
cd Prospero
pnpm install
pnpm dev        # launches the app in watch mode
```

Other scripts:

```bash
pnpm test       # unit tests (vitest) — 1 757 passing
pnpm typecheck  # tsc across all packages
pnpm lint       # eslint
pnpm dist:win   # build the Windows installer into ./release
```

The repo is a pnpm monorepo: `apps/main` (Electron main + orchestrator), `apps/renderer` (React UI), `apps/agent-runner`, and `packages/shared`. Requires Node 20+ and pnpm 9+.

## Status

**v0.1.10 — all v1 milestones complete (M1–M18), V2 features shipping.**

| What works today |
|---|
| Hire a team of Claude agents with roles, personas, and skills |
| CEO plans work: describe a goal → CEO proposes agents + issues → you approve |
| Kanban board (5 columns, drag-and-drop) with real-time agent collaboration |
| Agent memory and skills — knowledge persists across sessions and transfers between agents |
| Outcome verification — explicit criteria must pass before an issue is marked done |
| Trust ladder — agents earn autonomy through verified results |
| Morning briefing — what needs your attention, at a glance |
| Cost tracking with soft-stop budgets (per agent, per issue, per day) |
| Remote Docker adapter — run agents in isolated containers on a VPS |
| 1 757 tests passing · 0 lint/typecheck errors |

See [`ROADMAP.md`](ROADMAP.md) for the full milestone history and what's next.

## Disclaimer

Prospero spawns Claude Code agents on your machine using **your** Claude Max OAuth token. Agents can access your filesystem, run shell commands, and use the network within the limits you configure.

**You are responsible for reviewing agent permissions and supervising autonomous modes.** The authors assume no liability for actions taken by agents on your behalf. Because this is experimental and vibecoded, run it on projects you can afford to have an agent touch — and keep backups.

See [`SECURITY.md`](SECURITY.md) for the full threat model, token rotation instructions, and mitigation details.

## Contributing

Prerequisites: Node 20+, pnpm 9+, gitleaks, Windows 11 (primary platform).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch conventions, commit style (Conventional Commits), and the CI gate checklist (lint · typecheck · test · build · gitleaks).

When reporting issues, **redact paths, project names, and conversation content** before submitting.

## License

MIT — see [LICENSE](LICENSE).
