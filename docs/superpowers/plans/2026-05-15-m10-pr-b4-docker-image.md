# M10 PR-B.4 — Real agent-runner Docker image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `infra/docker/agent-runner/` stub Dockerfile and `infra/docker/compose.yml` into a real, buildable image that packages `apps/agent-runner` plus the `claude` CLI for the M10 VPS Docker remote adapter.

**Architecture:** A two-stage Docker build. The **builder** stage installs only the `@prospero/agent-runner` subtree with pnpm and runs tsup, producing two self-contained ESM bundles (`index.js` + `mcp-bridge.js`). The **runtime** stage (`node:22-slim`) installs the `claude` CLI globally, adds `tini` as PID 1, copies the runner bundle, drops to the unprivileged `node` user, and runs the runner over stdin/stdout — stdio *is* the wire transport, so the image exposes no ports and runs no service.

**Tech Stack:** Docker multi-stage build, `node:22-slim` (Debian — avoids the Alpine/musl risk for the `claude` CLI per design §12), pnpm workspaces with `--filter`, tsup, tini, `@anthropic-ai/claude-code`.

---

## Context for the implementer

This is the 4th and final sub-PR of M10 PR-B. PR-B.1/B.2/B.3 already built `apps/agent-runner` — a Node app whose `tsup.config.ts` emits two bundles into `apps/agent-runner/dist/`:

- `dist/index.js` — the wire-protocol server; `apps/agent-runner/src/index.ts` runs it over `process.stdin`/`process.stdout` and prints `agent-runner: ready (wire protocol v1)` to stderr.
- `dist/mcp-bridge.js` — the MCP stdio↔loopback bridge that `claude` launches as its `dashboard` MCP server.

Both bundles are **fully self-contained**: `tsup.config.ts` sets `noExternal: ["@prospero/shared", "zod"]`, so the only runtime dependencies are Node built-ins. The runtime image therefore needs **no `node_modules` for the runner** — just Node, the two `dist` files, and the `claude` CLI on `PATH`.

Key facts the image must satisfy (verified against the runner source):

- `apps/agent-runner/src/handlers/spawn.ts` spawns the agent with `command: "claude"` — the `claude` CLI must be resolvable on `PATH`.
- `apps/agent-runner/src/runner.ts` `defaultBridgePath()` resolves `mcp-bridge.js` as a sibling of `index.js` — both bundles must land in the **same directory** (`/app`).
- `apps/agent-runner/src/container-mcp-config.ts` writes `mcp.json` with `command: process.execPath` — i.e. the container's `node` binary launches the bridge.
- `apps/agent-runner/src/sandbox.ts` `AGENT_STATE_ROOT = "/var/lib/agent-state"` — the runner `mkdirSync`s `<agentId>/config` and `<agentId>/work` under it at spawn time, so that root must be **writable by the runtime user**.
- The runner spawns `claude` children; `tini` as PID 1 reaps them.

**This PR ships configuration artifacts only — no runtime code.** There is nothing to unit-test. Docker is **not installed on the build machine**, so the actual `docker build` is intentionally deferred to the PR-E local Docker smoke (design §2, §10). Verification here is limited to: (a) the runner bundle still builds and runs, and (b) the existing 910-test suite, typecheck, and lint stay green. Each artifact task ends with a careful self-review against an explicit checklist instead of an automated test.

### File structure

| File | Responsibility |
|---|---|
| `.dockerignore` (repo root, **create**) | Trims the build context — the context is the repo root, so installed deps, build output, and runner-irrelevant trees are excluded. |
| `infra/docker/agent-runner/Dockerfile` (**rewrite**) | Two-stage build: builder compiles the runner; runtime packages it with the `claude` CLI, `tini`, and a non-root user. |
| `infra/docker/compose.yml` (**rewrite**) | Reduced to a convenience build target — the stdio model has no ports/volumes/service. |

---

## Task 1: `.dockerignore` at the repo root

**Files:**
- Create: `.dockerignore`

The Docker build context for the Dockerfile is the **repo root** (the builder needs `pnpm-lock.yaml`, `pnpm-workspace.yaml`, every workspace `package.json`, and the `packages/shared` + `apps/agent-runner` source). `.dockerignore` keeps that context lean and reproducible: installed `node_modules` and `dist` output must never enter the context, so the image always reinstalls and rebuilds from source.

- [ ] **Step 1: Create `.dockerignore`**

```
# Docker build context for infra/docker/agent-runner/Dockerfile is the repo root.
# Exclude installed deps, build output, and trees the agent-runner build does not
# need — the image reinstalls and rebuilds everything from source.

# Never ship installed dependencies or compiled output.
**/node_modules
**/dist

# VCS, CI, and editor metadata.
.git
.github
.vscode
.husky

# Electron desktop-app build artifacts (apps/main / apps/renderer).
apps/main/release
apps/main/out
apps/renderer/.vite

# Docs and end-to-end tests — irrelevant to the runner bundle.
docs
tests/e2e

# Logs and local-only environment files.
**/*.log
.env
.env.*
```

- [ ] **Step 2: Self-review against the checklist**

Confirm each line:
- `**/node_modules` and `**/dist` — present (forces a clean install + rebuild).
- `.git` — present (large, build-irrelevant).
- Nothing the builder needs is excluded: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `packages/shared/**`, `apps/agent-runner/src/**`, and every `*/package.json` are **not** matched by any pattern. (Every workspace `package.json` must reach the context, or `pnpm install --frozen-lockfile` fails the lockfile-sync check.)
- `apps/agent-runner/tsup.config.ts`, `apps/agent-runner/tsconfig.json` — not excluded (the build needs them).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "feat(m10): docker build context ignore rules"
```

---

## Task 2: Real two-stage `Dockerfile`

**Files:**
- Modify (full rewrite): `infra/docker/agent-runner/Dockerfile`

Replace the M10 stub with a real two-stage image. The builder uses `pnpm install --filter "@prospero/agent-runner..."` so only the runner subtree (runner + `@prospero/shared` + their dev deps) is installed — `apps/main` with its native `better-sqlite3` and Electron is **never** installed or compiled, which keeps the builder fast and free of native-build tooling. The runtime stage is Debian-based (`node:22-slim`) to sidestep the Alpine/musl risk the design flagged for the `claude` CLI (§12).

- [ ] **Step 1: Rewrite `infra/docker/agent-runner/Dockerfile`**

```dockerfile
# Prospero agent-runner image — M10 VPS Docker remote adapter.
#
# Packages apps/agent-runner: a wire-protocol server (docs/m10-adapter-wire-protocol.md)
# that speaks over its own stdin/stdout. The host adapter launches this image with
# `docker run -i prospero/agent-runner:dev` (local Docker) or wraps that call in
# `ssh` (remote VPS) — stdio IS the transport, so the image exposes no ports and
# runs no background service.
#
# Build (from the repo root):
#   docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .

# ── Builder ──────────────────────────────────────────────────────────────────
# Compiles apps/agent-runner into two self-contained ESM bundles (index.js +
# mcp-bridge.js) via tsup. @prospero/shared and zod are bundled in (noExternal in
# tsup.config.ts), so the runtime stage needs no node_modules for the runner.
FROM node:22-slim AS builder

WORKDIR /build

# .dockerignore drops node_modules and dist, so this copies the source tree only.
COPY . .

# corepack pins pnpm to the version in the root package.json (packageManager).
# `--filter "@prospero/agent-runner..."` scopes the install to the runner plus its
# workspace dependency (@prospero/shared) and their dev deps — the Electron app
# (apps/main, native better-sqlite3) is never installed or built.
RUN corepack enable \
 && pnpm install --filter "@prospero/agent-runner..." --frozen-lockfile \
 && pnpm --filter @prospero/agent-runner build

# ── Runtime ──────────────────────────────────────────────────────────────────
# Debian slim (not Alpine): the claude CLI is glibc-friendly; musl is the risk the
# M10 design flagged (§12).
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/HeversonSilva-gif/Prospero"
LABEL org.opencontainers.image.description="Prospero agent runner — M10 VPS Docker remote adapter"

# tini is PID 1: it reaps the `claude` child processes the runner spawns per agent.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

# The claude CLI the runner spawns for each agent. Pin via
# `--build-arg CLAUDE_CODE_VERSION=x.y.z` for a reproducible image; defaults to the
# latest published release.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

WORKDIR /app

# Runner bundle only — index.js + mcp-bridge.js (+ sourcemaps). Left root-owned and
# read-only to the unprivileged runtime user, so a sandboxed agent cannot tamper
# with the runner code. defaultBridgePath() expects mcp-bridge.js beside index.js.
COPY --from=builder /build/apps/agent-runner/dist ./

# Per-agent sandboxes (CLAUDE_CONFIG_DIR + work dir) live under this root; the
# runner creates <agentId>/ subdirs at spawn time, so it must be writable by the
# node user. See apps/agent-runner/src/sandbox.ts (AGENT_STATE_ROOT).
RUN mkdir -p /var/lib/agent-state && chown node:node /var/lib/agent-state

# `node` is the unprivileged user (uid 1000) shipped in the base image.
USER node

# tini reaps zombies; the runner reads/writes the wire protocol on stdin/stdout.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/index.js"]
```

- [ ] **Step 2: Self-review against the checklist**

Verify every requirement the runner imposes (see "Context for the implementer"):
- **Build scoping** — `--filter "@prospero/agent-runner..."` is present, so `apps/main` (Electron + native `better-sqlite3`) is excluded; the builder needs no Python/make.
- **`--frozen-lockfile`** — present; safe because `.dockerignore` keeps every workspace `package.json` in the context so the lockfile-sync check passes.
- **Bundles co-located** — `COPY --from=builder /build/apps/agent-runner/dist ./` lands both `index.js` and `mcp-bridge.js` in `/app`; `defaultBridgePath()` resolves the bridge as a sibling of `index.js`. ✓
- **`claude` on PATH** — `npm install -g @anthropic-ai/claude-code` puts `claude` in `/usr/local/bin`; the runner spawns `command: "claude"`. ✓
- **`node` binary** — `container-mcp-config.ts` uses `process.execPath` (`/usr/local/bin/node`) to launch the bridge. Present in the base image. ✓
- **State root writable** — `mkdir -p /var/lib/agent-state && chown node:node` runs before `USER node`; the runner `mkdirSync(..., {recursive:true})`s subdirs as `node`. ✓
- **PID 1** — `ENTRYPOINT ["/usr/bin/tini", "--"]`; `tini` installed via apt at `/usr/bin/tini` on Debian. ✓
- **Non-root** — `USER node` is set before `CMD`. ✓
- **No ports / no service** — no `EXPOSE`, no `HEALTHCHECK`; `CMD` runs the runner in the foreground reading stdio. ✓
- **CMD path** — `["node", "/app/index.js"]` uses an absolute path, independent of `WORKDIR`. ✓

- [ ] **Step 3: Commit**

```bash
git add infra/docker/agent-runner/Dockerfile
git commit -m "feat(m10): real two-stage agent-runner docker image"
```

---

## Task 3: Rewrite `compose.yml` for the stdio model

**Files:**
- Modify (full rewrite): `infra/docker/compose.yml`

The current `compose.yml` is from the abandoned WSS design — it has ports `9700`/`9701`, a `HEALTH_PORT`, a long-lived `restart: unless-stopped` service, and a named `agent-state` volume. None of that fits the stdio model: the container is launched per-connection with `docker run -i`, carries the wire protocol over stdin/stdout, has no ports, and keeps per-agent state in an **ephemeral** in-container directory torn down with the container (design §11). The file is reduced to a convenience build target.

- [ ] **Step 1: Rewrite `infra/docker/compose.yml`**

```yaml
# Prospero agent-runner — M10 VPS Docker remote adapter.
#
# The agent-runner is NOT a long-lived service. The host adapter launches one
# container per wire connection with `docker run -i prospero/agent-runner:dev`
# (local Docker) — or that call wrapped in `ssh` for a remote VPS — and stdin/
# stdout carry the wire protocol. There are no ports and no volumes: per-agent
# state lives in an ephemeral in-container directory torn down with the container
# (see docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md §11).
#
# This file exists only as a convenient build target:
#   docker compose -f infra/docker/compose.yml build
# which is equivalent to, from the repo root:
#   docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .
#
# Do NOT `docker compose up` this — the runner needs an attached stdio peer.

services:
  agent-runner:
    image: prospero/agent-runner:dev
    build:
      context: ../..
      dockerfile: infra/docker/agent-runner/Dockerfile
```

- [ ] **Step 2: Self-review against the checklist**

- **No `version:` key** — modern Compose treats the top-level `version` as obsolete and warns on it; omitted. ✓
- **`build.context: ../..`** — `compose.yml` lives in `infra/docker/`, so `../..` resolves to the repo root, matching the Dockerfile's context expectation. ✓
- **`build.dockerfile`** — `infra/docker/agent-runner/Dockerfile`, relative to the context (repo root). ✓
- **`image:`** — `prospero/agent-runner:dev`, the tag the host adapter (PR-C) will `docker run`. ✓
- **WSS leftovers gone** — no `ports`, no `HEALTH_PORT`/`environment`, no `volumes`, no `restart`. ✓

- [ ] **Step 3: Commit**

```bash
git add infra/docker/compose.yml
git commit -m "feat(m10): stdio-model compose build target"
```

---

## Task 4: Verification gate (no regression)

**Files:** none modified — this task only runs checks.

Docker is not installed on the build machine, so the actual `docker build` is **intentionally deferred to the PR-E local Docker smoke** (design §2 / §10). What is verifiable here: the runner bundle the image packages still builds and starts, and the existing suite/typecheck/lint are unaffected by the new config files.

- [ ] **Step 1: Build the runner bundle the image will package**

Run: `pnpm --filter @prospero/agent-runner build`
Expected: tsup succeeds; `apps/agent-runner/dist/index.js` and `apps/agent-runner/dist/mcp-bridge.js` exist afterward.

- [ ] **Step 2: Smoke-run the built bundle**

Run: `node apps/agent-runner/dist/index.js`
Expected: stderr prints `agent-runner: ready (wire protocol v1)`; the process stays up waiting on stdin. Stop it with Ctrl-C. This confirms the exact artifact `CMD ["node", "/app/index.js"]` runs in the image is healthy.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: 910 passing + 2 todo, same as the PR-B.3 baseline — config-only files add no tests and regress none.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck` then `pnpm lint`
Expected: both clean. (Neither touches the Docker artifacts, but run them to confirm the baseline.)

- [ ] **Step 5: Confirm the deferred check is recorded**

No commit. Confirm the PR-E smoke checklist (written in PR-E) will cover the actual image build:
`docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .` followed by `docker run -i prospero/agent-runner:dev` exercising a real agent. This deferral is by design (§2) — note it in the session handoff when closing PR-B.4.

---

## Self-Review (plan vs. design §5.4)

- **Design §5.4 — "`node:22`, claude CLI instalado, usuário não-root, `tini` como PID 1, runner empacotado":** Task 2 — `node:22-slim` (Debian, per the §12 Alpine fallback), `npm install -g @anthropic-ai/claude-code`, `USER node`, `ENTRYPOINT tini`, `COPY --from=builder` of the runner bundle. ✓
- **Design §5.4 — "`compose.yml` reescrito pra largar as portas WSS (`9700`/`9701`)":** Task 3 removes ports, env, volume, and the service lifecycle. ✓
- **Design §11 — ephemeral container work dir:** Task 3 drops the named `agent-state` volume; state stays in-container. ✓
- **Design §12 — Alpine/CLI risk:** mitigated by choosing `node:22-slim` (Debian/glibc) for both stages. ✓
- **Design §10 PR-B scope — "Dockerfile real + `compose.yml` reescrito":** Tasks 1-3. The `apps/agent-runner` runner code itself shipped in PR-B.1/B.2/B.3; this PR is packaging only. ✓
- **Design §13 — "831+ testes verdes; nenhum regride":** Task 4 runs the full suite (910 baseline) + typecheck + lint. ✓
- **Placeholder scan:** no TBD/TODO-style placeholders; every file's full content is inline. The one `TODO`-shaped item — the real `docker build` — is an explicit, design-sanctioned deferral to PR-E, not a plan gap.
- **Path consistency:** `/app` (bundle), `/var/lib/agent-state` (`sandbox.ts` `AGENT_STATE_ROOT`), `/usr/bin/tini`, `prospero/agent-runner:dev` (Dockerfile build command, compose `image:`, design §3.1) are used identically across all tasks.
