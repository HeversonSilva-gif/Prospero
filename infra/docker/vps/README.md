# Prospero VPS deployment

Run the full Prospero Electron app on a Linux VPS and access it from any
browser. The container exposes a noVNC desktop behind Traefik + Authelia
(TOTP 2FA required).

> **Heads up — security tradeoff.** This deployment exposes a desktop
> shell to the public internet (gated by Authelia 2FA). The Electron
> AppImage runs with `--no-sandbox` because the container has no
> `CAP_SYS_ADMIN`. Read [`../../../SECURITY.md`](../../../SECURITY.md) §
> "VPS Deployment Threat Model" before going live.

## What you get

- The same Prospero desktop UI you'd get on Windows, served as a noVNC
  webpage. Anyone who can log in (2FA enforced) gets a real desktop
  session, not a thin wrapper.
- Persistent SQLite, settings, and workspaces — survive container restart.
- TLS via your existing Let's Encrypt resolver in Traefik.
- Authelia in front, requiring TOTP on every fresh session.

## What you need before starting

1. **A VPS running Ubuntu 22.04+ (or any Debian-based distro)** with
   Docker and `docker compose` plugin installed.
2. **An existing Traefik on the host**, attached to a docker network
   called `traefik-public` (or edit `docker-compose.yml` if yours is
   named differently). Traefik must already have:
   - An entrypoint `websecure` on `:443`.
   - A certresolver named `letsencrypt`.
3. **Two DNS A records pointing to the VPS:** one for Prospero (e.g.
   `prospero.example.com`) and one for Authelia (e.g.
   `auth.example.com`). Both must be covered by your Let's Encrypt
   resolver.
4. **A Linux-built AppImage** in `./release/` at the repo root — see
   step 0 below.
5. **A Claude Max OAuth token** — run `claude setup-token` on any
   desktop where Claude Code CLI is already authenticated and copy the
   printed token.

## 0. Build the AppImage

You need a Linux toolchain to build the AppImage because `better-sqlite3`
has a native ABI that must match the runtime platform. **The official,
supported path is Docker-in-Docker on your dev machine** — it works
identically on Windows, macOS, and Linux as long as you have Docker
available:

```bash
# Run from the repo root. Output lands in ./release/.
docker run --rm -v "$PWD":/repo -w /repo node:20-bookworm-slim bash -c "\
  corepack enable && \
  pnpm install --frozen-lockfile && \
  pnpm dist:linux"
```

This is the one rope we pull. If something breaks in this build, that's
the regression we fix — anything else is on you.

Two alternatives, neither tested as carefully:

- **Build on the VPS itself.** Clone the repo into the VPS, `pnpm install`,
  `pnpm dist:linux`. Useful if you can't run Docker locally.
- **CI Linux runner.** A GitHub Actions `ubuntu-latest` job running the
  same `pnpm dist:linux` works fine and is the path a real release would
  use.

Once `release/Prospero-<version>-x64.AppImage` exists at the repo root,
the Dockerfile picks it up via a wildcard glob.

## 1. Clone and configure

```bash
git clone https://github.com/HeversonSilva-gif/Prospero.git
cd Prospero/infra/docker/vps
cp .env.example .env
$EDITOR .env   # fill in CLAUDE_CODE_OAUTH_TOKEN, PROSPERO_HOST, AUTHELIA_HOST
```

## 2. Provision Authelia secrets and user

```bash
# Three random secrets. Authelia loads them via _FILE env vars.
mkdir -p authelia/secrets authelia/data
for f in jwt session storage; do
  openssl rand -hex 48 > authelia/secrets/$f
done

# Hash your password. Authelia prints the hash to stdout — copy it.
docker run --rm authelia/authelia:4.38 \
  authelia crypto hash generate argon2

# Create your users file from the template and paste the hash.
cp authelia/users_database.yml.example authelia/users_database.yml
$EDITOR authelia/users_database.yml   # username, displayname, password hash, email

# Edit the configuration to set your hostnames.
$EDITOR authelia/configuration.yml    # replace REPLACE_ME_* placeholders
```

## 3. Organize project workspaces on the host

```bash
sudo mkdir -p /opt/prospero/workspaces /opt/prospero/data
sudo chown -R 1000:1000 /opt/prospero/workspaces /opt/prospero/data
```

The container runs as UID 1000 — match it on the host so writes land
where they should. Put each project Prospero will work on as a
subdirectory of `/opt/prospero/workspaces`.

## 4. Build and start

```bash
# From this directory (infra/docker/vps).
docker compose build
docker compose up -d
```

The first start can take 30–60 seconds — Xvfb + Electron + noVNC
boot in sequence (see `entrypoint.sh`). The healthcheck on `prospero-vps`
hits `http://localhost:6080/`; once it goes `healthy` in
`docker compose ps`, the desktop is ready.

## 5. First login + register 2FA

1. Open `https://prospero.example.com` (substitute your `PROSPERO_HOST`).
2. Authelia redirects you to its login UI on `AUTHELIA_HOST`.
3. Enter username + password from `users_database.yml`.
4. Authelia prompts you to register a TOTP device — scan the QR code with
   Aegis (Android), Authy, or Google Authenticator.
5. Enter the 6-digit code. You're in — the noVNC desktop opens with
   Prospero running.

From now on every fresh session asks for password + a TOTP code.

## Updating to a new Prospero version

```bash
# 1. Rebuild the AppImage with the same official command from step 0.
git pull
docker run --rm -v "$PWD":/repo -w /repo node:20-bookworm-slim bash -c "\
  corepack enable && pnpm install --frozen-lockfile && pnpm dist:linux"

# 2. Rebuild and roll the container.
cd infra/docker/vps
docker compose build --no-cache prospero-vps
docker compose up -d prospero-vps
```

Your data volume (`/opt/prospero/data`) persists across rebuilds.

## Rotating the OAuth token

```bash
# On a desktop where claude is logged in:
claude setup-token
# Paste the new token into .env, then:
docker compose up -d prospero-vps
```

The container restarts and picks up the new env. Old token can be revoked
from your Anthropic account dashboard.

## Troubleshooting

- **Container reports `unhealthy` in `docker compose ps`:** the
  healthcheck couldn't reach `http://localhost:6080/`. Most likely
  Electron crashed during boot. Check `docker compose logs prospero-vps`
  for the entrypoint trace and any AppImage stderr.
- **Blank black screen on noVNC but container is `healthy`:** Electron
  usually needed a second longer than `entrypoint.sh` waited. Restart
  the container — `docker compose restart prospero-vps` — and try again.
- **"FATAL: extracted AppImage not found":** the build context didn't
  include `release/Prospero-*-x64.AppImage`. Confirm the file exists at
  the repo root before `docker compose build`.
- **Authelia exits on boot with "permission denied" on the SQLite store
  or notifications file:** the writable `authelia/data/` directory
  doesn't exist or isn't writable by the Authelia container's UID.
  Re-run `mkdir -p authelia/data` from step 2 and make sure your host
  user owns it.
- **Authelia loops on redirect:** check `authelia/configuration.yml` —
  `session.cookies[0].domain` must be the apex covering both
  `PROSPERO_HOST` and `AUTHELIA_HOST` (e.g. `example.com`).
- **TLS errors:** confirm both A records resolve to the VPS and your
  Traefik certresolver name in `docker-compose.yml` matches the one
  configured on the host (default here: `letsencrypt`).

## Hardening recommendations

- **Restrict source IPs.** Add a Traefik middleware
  `ipallowlist.sourcerange=YOUR.IP.0.0/16` to the prospero router
  before the `authelia` middleware.
- **Disable password reset.** Already done in `configuration.yml`
  (`authentication_backend.password_reset.disable: true`) — keep it
  that way unless you set up SMTP.
- **Rotate Authelia secrets quarterly.** Run the openssl loop in step 2
  again; restart Authelia.
- **Backups.** `/opt/prospero/data` carries SQLite + settings. Snapshot
  that directory on whatever cadence matches your tolerance.

## Alternative: Basic Auth instead of Authelia

If you don't need TOTP and prefer a single static credential, you can
swap the `authelia` middleware for Traefik's built-in `basicauth`:

```yaml
labels:
  - "traefik.http.routers.prospero.middlewares=prospero-auth"
  - "traefik.http.middlewares.prospero-auth.basicauth.users=user:$$2y$$05$$..."
```

(Generate the hash with `htpasswd -nbB user 'password'`.) This is
**not the recommended path** — basic auth has no MFA, no session, and no
audit log. See `../../../SECURITY.md` for the rationale on requiring 2FA
by default.
