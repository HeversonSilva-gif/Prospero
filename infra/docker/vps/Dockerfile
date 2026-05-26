# Prospero VPS deployment image.
#
# Runs the full Electron app inside a virtual X server, exposes the desktop
# over noVNC, and is intended to sit behind Traefik + Authelia (forward-auth
# with TOTP 2FA). See infra/docker/vps/README.md for the full setup.
#
# Build (from the repo root, with release/Prospero-*.AppImage already built):
#   docker build -f infra/docker/vps/Dockerfile -t prospero/vps:dev .
#
# Or via compose:
#   docker compose -f infra/docker/vps/docker-compose.yml build

FROM node:20-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/HeversonSilva-gif/Prospero"
LABEL org.opencontainers.image.description="Prospero — full Electron app served via noVNC for VPS deployment"
LABEL org.opencontainers.image.licenses="MIT"

# ── System dependencies ──────────────────────────────────────────────────────
# Three groups, kept together for layer-cache friendliness:
#
#  (a) X server + WM + VNC + noVNC bridge — the display chain.
#  (b) Electron / Chromium runtime libs — what AppImage will dlopen at start.
#      Validated empirically by running the AppImage until ldd-resolved.
#      libsecret-1-0 is required by Electron safeStorage on Linux (it talks to
#      the host's libsecret implementation, which on a headless container
#      falls back to a basic in-memory store — acceptable for VPS since the
#      OAuth token comes from the env, not from safeStorage).
#  (c) Misc — tini for PID-1 reaping, ca-certs for HTTPS to api.anthropic.com.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    libgtk-3-0 \
    libnss3 \
    libxss1 \
    libasound2 \
    libgbm1 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libsecret-1-0 \
    fonts-liberation \
    tini \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

# ── Claude Code CLI ──────────────────────────────────────────────────────────
# Pin via --build-arg CLAUDE_CODE_VERSION=x.y.z for reproducible builds.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# ── AppImage ─────────────────────────────────────────────────────────────────
# The AppImage is built locally on a Linux host (`pnpm dist:linux`) and placed
# in ./release/ before docker build. We copy it in and extract it (rather than
# running it directly) so we don't need FUSE inside the container.
#
# The build context is the repo root. We use a wildcard so the build doesn't
# depend on the exact version string.
WORKDIR /opt/prospero
COPY release/Prospero-*-x64.AppImage /opt/prospero/Prospero.AppImage
RUN chmod +x /opt/prospero/Prospero.AppImage \
 && /opt/prospero/Prospero.AppImage --appimage-extract \
 && rm /opt/prospero/Prospero.AppImage
# Extraction leaves ./squashfs-root with AppRun at the root.

# ── Non-root user ────────────────────────────────────────────────────────────
RUN useradd --create-home --shell /bin/bash --uid 1000 prospero \
 && mkdir -p /opt/prospero/workspaces /opt/prospero/data \
 && chown -R prospero:prospero /opt/prospero /home/prospero

# Electron writes config under $HOME/.config; point it at the volume-backed
# data dir so settings + SQLite survive container restarts.
ENV HOME=/home/prospero
ENV XDG_CONFIG_HOME=/opt/prospero/data/config
ENV XDG_DATA_HOME=/opt/prospero/data/local
ENV ELECTRON_DISABLE_SECURITY_WARNINGS=1

COPY infra/docker/vps/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER prospero
WORKDIR /opt/prospero

# noVNC websocket. Traefik forwards to this; not published to the host
# directly when Traefik is on the same docker network.
EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
