# M10 — VPS setup runbook + local-Docker smoke

How to run Prospero agents inside Docker — locally for validation, or on a
remote VPS over SSH. This is the operator guide for the
`claude-oauth-remote-docker` adapter shipped in M10.

Architecture recap (full detail in
`docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md`): only the
`claude` process runs in the container. The database, MCP server, and
permission handshake stay on the host. The host talks to the container over a
single SSH stdio channel — `docker run -i` for local Docker, `ssh … -- docker
run -i` for a VPS. No open ports, no TLS certificates.

---

## Part A — Local Docker (validation path)

Use this first. It exercises the exact same adapter, runner, and image as the
VPS path — only the transport prefix differs.

### A.1 Install Docker

Install Docker Engine (Linux) or Docker Desktop (Windows/macOS). Confirm:

```bash
docker --version
docker run --rm hello-world
```

### A.2 Build the runner image

From the repo root (the build context must be the repo root — the Dockerfile
needs every workspace `package.json` for `--frozen-lockfile`):

```bash
docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .
```

The image tag `prospero/agent-runner:dev` is fixed — Prospero always launches
that tag and it is not configurable in the UI.

### A.3 Configure Prospero

1. Launch Prospero. Open **Settings → Remote execution**.
2. Tick **Enable remote execution**.
3. Leave the target on **Local Docker**.
4. Click **Test connection** — expect **Connection OK**.

Local Docker is ready. Skip Part B unless you want a remote VPS.

---

## Part B — Remote VPS

### B.1 Provision the VPS

Any x86-64 Linux host reachable over SSH (Ubuntu 22.04 LTS or newer is a safe
default). Create a non-root login user for Prospero to SSH in as.

### B.2 Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
docker run --rm hello-world
```

### B.3 Set up the SSH key

Prospero connects with `StrictHostKeyChecking=yes` and `BatchMode=yes` — it
never answers interactive prompts. Two consequences:

1. **Use a dedicated key with no passphrase** (Prospero cannot type one):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/prospero_vps -N ""
   ssh-copy-id -i ~/.ssh/prospero_vps.pub <user>@<vps-host>
   ```

2. **Pin the host key first.** `StrictHostKeyChecking=yes` rejects any host not
   already in `~/.ssh/known_hosts`. Connect once interactively to record it:

   ```bash
   ssh -i ~/.ssh/prospero_vps <user>@<vps-host> "echo host key pinned"
   ```

   Answer `yes` at the fingerprint prompt. If the VPS host key ever changes,
   Prospero's connection will fail until you re-pin it.

### B.4 Get the runner image onto the VPS

Either build on a machine that has Docker and copy it over:

```bash
docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .
docker save prospero/agent-runner:dev | ssh -i ~/.ssh/prospero_vps <user>@<vps-host> docker load
```

…or copy the repo to the VPS and run the `docker build` command from B.4 there.
Confirm on the VPS: `docker image ls | grep prospero/agent-runner`.

### B.5 Configure Prospero

1. **Settings → Remote execution → Enable remote execution**.
2. Target: **Remote VPS**.
3. Fill in **VPS host**, **SSH user**, and **SSH key path** (the private key,
   e.g. `~/.ssh/prospero_vps`).
4. Click **Test connection** — expect **Connection OK**.

New agents created with location **Remote**, and existing agents switched to
**Remote** in Agent Studio, now run on the VPS.

---

## Part C — Local-Docker smoke checklist

Run this once after A.1–A.3 to confirm the adapter end-to-end (M10 design §13
definition of done). It is a manual check — it needs a real Docker daemon.

- [ ] `docker build -f infra/docker/agent-runner/Dockerfile -t prospero/agent-runner:dev .` succeeds.
- [ ] Settings → Remote execution → enabled, target Local Docker, **Test connection** returns OK.
- [ ] Hire a new agent with location **Remote** (or switch an existing agent to
      Remote in Agent Studio → Config).
- [ ] Assign that agent an issue, or send it a message.
- [ ] `docker ps` shows a running `prospero/agent-runner:dev` container while
      the agent works.
- [ ] The agent uses MCP tools — an issue comment or artifact it produces
      appears in the UI (this proves the host-tunnelled MCP relay works).
- [ ] The agent reports back and the turn completes without error.
- [ ] `/costs` attributes the turn's tokens; the `cost_events` row carries
      `adapter_name = claude-oauth-remote-docker`.

If every box is checked, the local Docker path is validated and the VPS path —
identical except for the `ssh` transport prefix — is de-risked.
