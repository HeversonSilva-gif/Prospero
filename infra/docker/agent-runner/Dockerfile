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
