#!/usr/bin/env bash
# Prospero VPS entrypoint — boots a virtual X server, a window manager,
# the Electron AppImage, and a noVNC websocket bridge in front of x11vnc.
#
# Layout:
#   Xvfb        :99   (virtual framebuffer, no real GPU needed)
#   fluxbox     →     (lightweight WM so Electron has a parent to talk to)
#   Prospero AppImage --no-sandbox (the app itself)
#   x11vnc      :5900 (loopback only — Authelia/Traefik gate the public side)
#   websockify  6080  (noVNC websocket bridge — exposed via Traefik)
#
# Tini is PID 1 (set in the Dockerfile) so this script and its descendants
# get reaped cleanly on container stop.

set -euo pipefail

export DISPLAY=:99
export HOME="${HOME:-/home/prospero}"

# Refuse to start without a token — fail loud, do NOT default to anonymous.
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "[entrypoint] FATAL: neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set" >&2
  echo "[entrypoint] Generate one via 'claude setup-token' on a desktop and pass it via env." >&2
  exit 1
fi

# Locate the AppImage. We extract it (--appimage-extract) at image-build time
# rather than running it directly: --appimage-extract avoids needing FUSE
# inside the container, which would require --device /dev/fuse and is fragile
# in non-privileged setups.
APPDIR="/opt/prospero/squashfs-root"
if [[ ! -x "${APPDIR}/AppRun" ]]; then
  echo "[entrypoint] FATAL: extracted AppImage not found at ${APPDIR}/AppRun" >&2
  exit 1
fi

# Mark each background process so we can wait on them and surface failures.
declare -A PIDS

start() {
  local name="$1"; shift
  "$@" &
  PIDS["$name"]=$!
  echo "[entrypoint] started $name (pid ${PIDS[$name]})"
}

# 1. Xvfb on :99 — 24-bit truecolor, 1920x1080 is enough for any sane layout.
start xvfb Xvfb :99 -screen 0 1920x1080x24 -ac +extension RANDR

# Give Xvfb a moment. The classic race is the WM connecting before the
# server is listening — a tiny sleep here saves a lot of grief.
sleep 1

# 2. Fluxbox — Electron expects a window manager for focus/decoration hints.
start fluxbox fluxbox

sleep 1

# 3. The AppImage itself. --no-sandbox is required because the container
# lacks CAP_SYS_ADMIN and a setuid helper for chrome-sandbox. This is a
# deliberate tradeoff documented in SECURITY.md.
start prospero "${APPDIR}/AppRun" --no-sandbox --disable-dev-shm-usage

sleep 2

# 4. x11vnc bound to loopback only. The "auth" is provided by Traefik +
# Authelia at the HTTP layer; exposing VNC directly on the public interface
# would defeat 2FA. -nopw is safe because nothing outside the container
# can reach :5900 (no port mapping, no host network).
start x11vnc x11vnc -display :99 -forever -shared -nopw -localhost \
  -rfbport 5900 -quiet -bg
# x11vnc with -bg double-forks; cancel its tracking entry.
unset 'PIDS[x11vnc]'

sleep 1

# 5. noVNC websocket bridge on 6080. Traefik proxies to this port.
start websockify websockify --web=/usr/share/novnc/ 6080 localhost:5900

# Wait on any child; first one to exit takes the container down.
wait -n
EXIT=$?
echo "[entrypoint] a child exited with code $EXIT — shutting down"
exit "$EXIT"
