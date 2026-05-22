# Prospero

Run a whole company of Claude Code agents from your desktop. One person commands
a hierarchy of AI employees — a CEO who plans and delegates, specialists who
execute and report back — all on your machine, using your existing Claude Max
subscription instead of a separate API key.

> ⚠️ **This is vibecoded.** Prospero was built almost entirely by AI — Claude
> Code, driven conversationally ("vibe coding") with a human steering the
> direction and testing each step. It's a personal, experimental project, not a
> hardened commercial product. Expect rough edges, and please read the
> [Disclaimer](#disclaimer) before running it.

## What it is

An Electron desktop app (Windows for now) that orchestrates multiple Claude Code
agents hierarchically. You describe what you want in plain language; a CEO agent
turns it into a plan, proposes an org of specialist agents for you to approve,
creates issues, and delegates the work — while you stay in the loop and approve
the things that matter.

Under the hood, agents are more than one-shot prompts:

- **Memory & skills** — each agent accumulates persistent, cross-session memory
  (facts, rules, preferences) and reusable procedural skills. When an issue is
  closed or an agent recovers from an error, a background pipeline derives a
  reviewable skill candidate you can accept, edit, or reject.
- **Outcomes & verification** — goals carry an Ideal State and explicit success
  criteria; work is verified against them before it's marked done.
- **Trust ladder** — agents that build a verified track record earn more
  autonomy over time, and you get a morning briefing of what needs you.
- **Org knowledge** — skills can be promoted from a single agent to a role or
  the whole company, so what one agent learns outlives it.

Inspired by [Paperclip](https://github.com/paperclipai/paperclip), but built
around your Claude Max login rather than an Anthropic API key.

## Why Claude Max instead of an API key

If you already pay for Claude Max, you shouldn't need a separate API key just to
orchestrate agents. Prospero can use `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`) so all agent activity counts against your existing
subscription. Three auth modes are supported, choosable per agent: **Claude Max
OAuth**, **Anthropic API key**, and a **remote Docker** host.

## Install

Download the latest installer from the
[Releases page](https://github.com/HeversonSilva-gif/Prospero/releases/latest)
(`Prospero-Setup-x.y.z.exe`, Windows x64). The installer is currently unsigned,
so Windows SmartScreen may warn on first run — choose **More info → Run anyway**.
After that, the app keeps itself up to date automatically.

You'll need the Claude Code CLI installed and, for the default auth mode, a token
from `claude setup-token`.

## Running from source

```bash
pnpm install
pnpm dev        # launches the app in watch mode
```

Useful scripts:

```bash
pnpm test       # unit tests (vitest)
pnpm typecheck  # tsc across all packages
pnpm lint       # eslint
pnpm dist:win   # build the Windows installer into ./release
```

The repo is a pnpm monorepo: `apps/main` (Electron main + orchestrator),
`apps/renderer` (React UI), `apps/agent-runner`, and `packages/shared`.

## Status

The v1 product (M1–M10) is complete, plus the V2 line: agent memory & learning
(M11), org/role definition + charters (M12), outcomes & verification (M13),
morning briefing & trust ladder (M14), routines (M15), the plain-language UI
redesign (M16), packaging + auto-update (M17), and hardening from real-app
testing (M18). See [`ROADMAP.md`](ROADMAP.md) for the full milestone history and
[`docs/superpowers/specs/2026-05-09-prospero-design.md`](docs/superpowers/specs/2026-05-09-prospero-design.md)
for the original design.

## Disclaimer

Prospero spawns Claude Code agents on your machine using **your** Claude Max
OAuth token. Agents can access your filesystem, run shell commands, and use the
network within the limits you configure. You are responsible for reviewing agent
permissions and supervising autonomous modes. The authors assume no liability
for actions taken by agents on your behalf. Because it's vibecoded and
experimental, run it on projects you can afford to have an agent touch, and keep
backups.

## License

MIT — see [LICENSE](LICENSE).
