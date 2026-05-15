# M10 (future): VPS Docker remote adapter runner.
# See docs/m10-adapter-wire-protocol.md for the wire protocol this image will
# implement. Until M10 lands, this image is non-functional; it exists so we can
# wire compose.yml, healthchecks, and CI image builds incrementally.

FROM node:22-alpine

# TODO (M10): copy adapter wire-protocol server binary (compiled from
# apps/agent-runner/) and install the claude CLI from anthropic releases.
# TODO (M10): switch to non-root user, add tini as PID 1, expose
# /healthz HTTP endpoint on $HEALTH_PORT.

LABEL org.opencontainers.image.source="https://github.com/HeversonSilva-gif/Prospero"
LABEL org.opencontainers.image.description="Prospero agent runner (M10 stub)"

CMD ["echo", "M10 stub — not implemented yet"]
