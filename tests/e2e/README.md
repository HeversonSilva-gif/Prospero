# E2E (Playwright + Electron)

This suite drives the real Electron app end-to-end. It does **not** run in CI;
Windows + Electron + headless is flaky and not yet stable enough to gate
merges. Run locally with:

```
pnpm build           # produce the main + renderer bundles the suite launches
pnpm test:e2e        # headless run
pnpm test:e2e:ui     # Playwright UI for debugging a single spec
```

## How the suite avoids hitting the real API

`PROSPERO_E2E_FAKE_CLAUDE=1` short-circuits the orchestrator's spawn
path: instead of launching the real claude CLI, the adapter runs a stub child
that emits a canned sequence of stream-json events (session-init, an optional
hire_agent tool call, turn-complete). The stub lives in
`apps/main/src/orchestrator/adapters/claude-oauth-local/fake-claude.ts`.

## How the suite isolates state

Every test gets its own `userData` directory created with `mkdtempSync`. The
fixture sets `PROSPERO_USER_DATA` so the main process points its DB,
events dir, permissions dir, and config dir at that throwaway path.

## Per-scenario skip fallback

If a scenario can't be stabilised in one day of tuning, mark it
`test.skip(..., 'TODO: M7.5 follow-up — flake under <symptom>')` and move on.
This is documented in spec §C.4 of
`docs/superpowers/specs/2026-05-11-m7.5-foundations-adapter-design.md`.

## Current status (2026-05-12)

All three specs (and the smoke) are landed as `test.describe.skip(...)` due
to an Electron 33 + Playwright 1.60 incompatibility: Playwright auto-injects
`--remote-debugging-port=0` into the Electron command line, which Electron 33
rejects as `bad option`. The infrastructure (fixture, helpers, fake-claude
stub, env-var bypass for userData + token) is fully in place and tested by
unit/integration suites. When one side upgrades to a compatible pair (or a
Playwright env var lands to suppress the flag injection), unskip the suites.
