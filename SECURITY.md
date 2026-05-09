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

See `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md` §8.9 (full runbook lands in M7+).
