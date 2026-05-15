# M10 PR-E — Docs + Smoke + Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close M10 (and v1) by documenting the shipped `claude-oauth-remote-docker` adapter — refreshed SECURITY.md threat model, a concise VPS setup runbook with a local-Docker smoke checklist, and the roadmap marked v1-complete in all three places.

**Architecture:** Documentation-only PR — no code, no tests. The 973-test baseline is untouched. Four artifacts: rewrite the outdated `claude-oauth-remote-docker` entry in `SECURITY.md` (it describes the rejected WSS+mTLS design), create `docs/m10-vps-setup-runbook.md` (provisioning + smoke checklist), and update `ROADMAP.md` + `docs/roadmap.html` to v1-complete state. The `roadmap.html` M10 section currently describes the fully rejected design (WSS, multi-VPS manager, JWT, Caddy) and gets a full rewrite to the shipped SSH-stdio architecture.

**Tech Stack:** Markdown, HTML. No build step for these docs. Verification = the existing `pnpm typecheck && pnpm lint && pnpm test` stay green and stale-string greps come back empty.

**Pre-req closed:** M10 PR-A + PR-B + PR-C + PR-D merged. HEAD `580b284`, 973 tests passing + 2 todo. Spec: §8/§10/§13 of `docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md`.

**Conventions:**
- commitlint rejects uppercase / `+` / `%` in the subject line. Use lowercase `docs(m10): ...`.
- Work commits directly to `main` (project pattern for M10 PRs A–D).
- Line numbers below are as of HEAD `580b284` — if they have shifted, locate the quoted anchor text instead.
- End commit messages with the `Co-Authored-By` trailer.

---

## File Structure

**Created:**
- `docs/m10-vps-setup-runbook.md` — operator runbook: provision a VPS, install Docker, set up the SSH key, build/transfer the runner image, wire up Settings; plus a local-Docker smoke checklist section.

**Modified:**
- `SECURITY.md` — the `### claude-oauth-remote-docker (M10 future)` entry rewritten to the shipped SSH-stdio design and promoted to `✅`.
- `ROADMAP.md` — header "Última atualização" line, the layperson "🎯 Configuração de agente" + "🚧 O que ainda NÃO funciona" sections, the "Status atual" table.
- `docs/roadmap.html` — `/00` layperson future list, `/01` progress track (M10 step + progress-meta), `/03` the M10 `<article>` (full rewrite).

Each task produces one self-contained, committable doc change.

---

## Task 1: Rewrite the `claude-oauth-remote-docker` threat model in SECURITY.md

The current entry (lines ~95–106) describes the **rejected** design: "mutual TLS over WSS", "pinned cert", "host iptables policy". The shipped design is SSH stdio, host-authoritative MCP tunnel (M10 spec §2, §8). Replace it.

**Files:**
- Modify: `SECURITY.md` (the `### claude-oauth-remote-docker (M10 future)` section)

- [ ] **Step 1: Replace the threat-model entry**

In `SECURITY.md`, replace this exact block:

```markdown
### `claude-oauth-remote-docker` (M10 future)

- **Locus:** different machine — a hardened VPS running the agent runner inside
  a non-root Docker container.
- **Credentials:** OAuth token is sent over the wire-protocol channel (mutual
  TLS over WSS, see `docs/m10-adapter-wire-protocol.md`) and held only in the
  container's memory.
- **Primary threats:** in-flight credential interception, Docker escape, host
  network egress from a compromised container.
- **Mitigations:** mutual TLS with pinned cert, container runs as a non-root
  user behind `tini`, host iptables policy denies outbound except to the
  Anthropic API endpoint, container has no mounted host paths.
```

with:

```markdown
### `claude-oauth-remote-docker` (M10, 2026-05-15 ✅)

- **Locus:** the `claude` process runs inside a Docker container — local Docker
  for the validation path, or a VPS via SSH. Everything stateful (SQLite, MCP
  server, permission handshake, the chokidar watcher) stays on the host: the
  container runs only `claude` plus a "dumb" agent-runner that proxies stdio.
- **Transport:** a single SSH stdio channel (`docker run -i` locally; `ssh …
  -- docker run -i` for a VPS). SSH supplies auth, encryption, and the pipe —
  there is no open port, no WSS, and no X.509 certificate lifecycle. WSS+mTLS
  was considered and rejected (M10 design §2, §11).
- **Credentials:** the OAuth token travels once, in the wire-protocol
  `handshake` message, encrypted by the SSH transport (loopback only for local
  Docker). The runner injects it as the `CLAUDE_CODE_OAUTH_TOKEN` environment
  variable of the spawned `claude` child — never written to disk in the
  container, never logged (the runner redacts tokens in stderr before
  forwarding via `redactSecrets`).
- **Primary threats:** in-flight credential interception, Docker escape, host
  network egress from a compromised container.
- **Mitigations:** SSH provides transport auth + encryption; the SSH host key
  is pinned (`StrictHostKeyChecking=yes`, `BatchMode=yes` — a forged host fails
  the connection, no interactive trust prompt). The container runs as a
  non-root user behind `tini` as PID 1, with `--strict-mcp-config` (the
  generated `mcp.json` only references the loopback MCP bridge) and no mounted
  host paths. The container work directory is ephemeral — removed when the
  `--rm` container exits.
- **MCP / DB isolation:** the SQLite database never leaves the host. The MCP
  server (`mcp/server.js`) is spawned on the host by an `McpRelay`; the
  container reaches it only through the tunnelled wire-protocol channel. The
  `gate.ts` command blocklist therefore still runs host-side on every MCP
  call — Docker isolation **plus** the command gate is defense-in-depth, not a
  replacement (see "Blocklist `gate.ts §8.3` persists across adapters" above).
- **Concurrency cap:** counts against the 4-agent OAuth cap in `lifecycle.ts`,
  same as `claude-oauth-local` — `isOauth` covers both adapter names.
- **Setup:** see `docs/m10-vps-setup-runbook.md` for VPS provisioning and the
  local-Docker smoke checklist.
```

- [ ] **Step 2: Verify the stale design strings are gone**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && grep -nE "mutual TLS|WSS|iptables" SECURITY.md`
Expected: no output (the rejected-design phrases no longer appear in `SECURITY.md`).

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs(m10): refresh remote docker adapter threat model"
```

---

## Task 2: Create the VPS setup runbook + local-Docker smoke checklist

A concise operational runbook (chosen depth: essential steps, no deep OS hardening). One file, with the smoke checklist as its final section.

**Files:**
- Create: `docs/m10-vps-setup-runbook.md`

- [ ] **Step 1: Write the runbook file**

Create `docs/m10-vps-setup-runbook.md` with exactly this content:

````markdown
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
````

- [ ] **Step 2: Verify the file is well-formed**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && test -f docs/m10-vps-setup-runbook.md && grep -c "^#" docs/m10-vps-setup-runbook.md`
Expected: a non-zero count of heading lines (the file exists and has Markdown headings).

- [ ] **Step 3: Commit**

```bash
git add docs/m10-vps-setup-runbook.md
git commit -m "docs(m10): add vps setup runbook and smoke checklist"
```

---

## Task 3: Update ROADMAP.md to v1-complete

Mark M10 closed across the two maintenance-rule sections (layperson + technical) plus the header line and the status table.

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update the "Última atualização" header line**

Replace the line starting `> **Última atualização:** 2026-05-14` (line ~9) with:

```markdown
> **Última atualização:** 2026-05-15 — **M10 ✅ MERGEADO COMPLETO · v1 fechado (14/14 milestones).** 5 PRs (A–E): wire protocol (`packages/shared/src/wire/`), `apps/agent-runner/` + Dockerfile real, host adapter `ClaudeRemoteDockerAdapter` + connection manager + MCP relay, Settings `RemoteExecutionSection` + per-agent location selector + `agents:set-adapter`/`remote:test-connection` IPCs, e docs (SECURITY.md + `docs/m10-vps-setup-runbook.md`). Arquitetura: SSH stdio, host-authoritative, MCP tunelado. **973 testes** (63 shared + 50 agent-runner + 148 renderer + 712 main; +2 todo).
```

- [ ] **Step 2: Move the VPS item out of "O que ainda NÃO funciona"**

In the `### 🚧 O que ainda NÃO funciona (próximas releases)` section, delete this bullet:

```markdown
- ☁️ **Rodar agentes numa VPS remota (Docker)** — escolha per-agent: local (CEO, latência baixa) ou remoto (engenheiros, isolamento) → M10
```

(The `🧠 Empresa que aprende…` bullet stays — that is M11.)

- [ ] **Step 3: Add the shipped capability to the layperson section**

In `### 🎯 Configuração de agente (Agent Studio)`, append this bullet as the last item of that section's list:

```markdown
- **Escolher onde o agente roda** — local (no seu PC) ou numa VPS remota via Docker. Define na contratação ou troca depois no Agent Studio. Settings tem a seção "Execução remota" com teste de conexão (M10, 2026-05-15)
```

- [ ] **Step 4: Update the "Status atual" table**

In the `## Status atual` table, replace these four rows:

```markdown
| Milestones fechados | M1, M2, M3, M4, M5, M6, **M7**, **M7.5**, **M7.7**, **M7.6**, **M8**, **M8.5**, **M8.6** (13/14 do v1) |
| Concluído | **M9 — 6/6 PRs** ✅. PR-A/B/C/D/E/F.1/F.2.1/F.2.2/F.2.3 todos mergeados em 2026-05-14. Próximo: M10 (VPS adapter) fecha v1. |
| Testes | **831 passing** (651 main + 33 shared + 147 renderer + 2 todo), 0 lint/typecheck errors |
```

and

```markdown
| Restante pra v1 | M10 (~4-6 dias). **M9 fechado em 2026-05-14 (6/6 PRs).** |
```

with:

```markdown
| Milestones fechados | M1–M6, **M7**, **M7.5**, **M7.7**, **M7.6**, **M8**, **M8.5**, **M8.6**, **M9**, **M10** (14/14 do v1 ✅) |
| Concluído | **v1 fechado** 2026-05-15 — **M10 — 5/5 PRs** ✅ (A wire protocol · B agent-runner + Docker image · C host adapter + MCP relay · D Settings + UX · E docs + roadmap). |
| Testes | **973 passing + 2 todo** (712 main + 63 shared + 50 agent-runner + 148 renderer), 0 lint/typecheck errors |
```

and

```markdown
| Restante pra v1 | **Nada — v1 fechado em 2026-05-15.** Próximo: M11 (V2 anchor). |
```

- [ ] **Step 5: Verify the stale claims are gone**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && grep -nE "13/14|831 passing|M10 \(~4-6 dias\)" ROADMAP.md`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(m10): mark v1 complete in roadmap"
```

---

## Task 4: Update docs/roadmap.html (sections /00, /01, /03)

Three sub-sections. `/03`'s M10 `<article>` describes the entirely rejected design (WSS, multi-VPS manager, JWT, Caddy, migration 0008) and is fully rewritten.

**Files:**
- Modify: `docs/roadmap.html`

- [ ] **Step 1: /00 — move the VPS item out of the "NÃO funciona" list**

In the `<div class="layperson-future">` block, delete this `<li>`:

```html
            <li>
              ☁️ <strong>Rodar agentes numa VPS remota (Docker)</strong> — escolha per-agent: local
              (CEO, latência baixa) ou remoto (engenheiros, isolamento) → M10
            </li>
```

(The `🧠` learning-company `<li>` immediately after it stays — that is M11.)

- [ ] **Step 2: /01 — update the progress-track note**

Replace this `<span class="note">` (inside the `/01` section head):

```html
          <span class="note"
            >M1—M10 · M8.6 fechado em 2026-05-14 (live execution &amp; kanban collab) · próximo M9
            Dashboard + multi-empresa + 2º adapter</span
          >
```

with:

```html
          <span class="note"
            >M1—M10 · v1 fechado em 2026-05-15 — M10 VPS Docker adapter (5 PRs A–E) · próximo
            M11 (V2 anchor)</span
          >
```

- [ ] **Step 3: /01 — flip the M10 progress step to done**

Replace:

```html
            <div class="progress-step" data-status="planned">
              <div class="dot"></div>
              <div class="label">M10</div>
            </div>
```

with:

```html
            <div class="progress-step" data-status="done">
              <div class="dot"></div>
              <div class="label">M10</div>
            </div>
```

- [ ] **Step 4: /01 — update the progress-meta "Estágio" block**

Replace this `<div>` (the first child of `<div class="progress-meta">`):

```html
            <div>
              <strong>Estágio:</strong> M9 fechado em 2026-05-14 (6/6 PRs). PR-F.2.3 entrega o
              IssueReviewBlock embutido no IssueDetailModal: diff side-by-side via
              react-diff-viewer-continued + comment box + 3 botões (approve/request changes/reject)
              que disparam <code>issues:update</code> + <code>issues:add-comment</code> existentes —
              sem migração nova. <strong>831 testes passing</strong> (+12 helpers puros).
              <strong>14/14 milestones</strong> do v1 quando M10 fechar. Próximo:
              <strong>M10 VPS adapter — fecha v1</strong>.
            </div>
```

with:

```html
            <div>
              <strong>Estágio:</strong> v1 fechado em 2026-05-15. M10 entregou o adapter
              <code>claude-oauth-remote-docker</code> em 5 PRs (A–E): wire protocol, app
              <code>agent-runner</code> + imagem Docker, host adapter + MCP relay tunelado,
              Settings + seletor de localização per-agente, docs. Arquitetura SSH stdio,
              host-authoritative — o SQLite nunca sai do host. <strong>973 testes passing</strong>
              (+2 todo). <strong>14/14 milestones</strong> do v1 ✅. Próximo:
              <strong>M11 — Agent Memory (âncora V2)</strong>.
            </div>
```

- [ ] **Step 5: /03 — rewrite the M10 milestone article**

Replace the entire M10 `<article>` — from `<!-- ──── M10 ──── -->` through its
closing `</article>` (immediately before `<!-- ──── M11 ──── -->`) — with:

```html
          <!-- ──── M10 ──── -->
          <article class="milestone" data-status="done">
            <div class="ms-rail">
              <div class="num">M10</div>
              <div class="status-row"><span class="status-dot"></span>done</div>
              <div class="meta">fechou v1 · 2026-05-15</div>
            </div>
            <div class="ms-body">
              <h3>VPS Docker Remote Adapter</h3>
              <p class="tagline">
                Terceiro adapter <code>claude-oauth-remote-docker</code> sobre a foundation do
                M7.5. O processo <code>claude</code> roda num container Docker — local ou numa VPS
                via SSH. Per-agent: <em>localização local | remoto</em>.
                <strong>Fechou v1 com distribuição hybrid.</strong>
              </p>
              <div class="design-note">
                <span class="label">Arquitetura</span>
                SSH stdio, não WSS+mTLS (SSH já entrega auth + cripto + pipe; sem porta aberta, sem
                ciclo de cert X.509). Host-authoritative: só o <code>claude</code> roda remoto —
                SQLite, MCP server, permission handshake e o watcher chokidar ficam no host. As
                ferramentas MCP do agente remoto chegam ao host por um túnel sobre o wire protocol.
                Defense-in-depth: o blocklist do <code>gate.ts</code> roda host-side mesmo com
                isolamento Docker.
              </div>
              <div class="feature-group">
                <div class="group-name">PR-A — Wire protocol</div>
                <ul class="feature-list">
                  <li><code>packages/shared/src/wire/</code> — tipos, codec, framing</li>
                  <li>Primitivas <code>WireClient</code> / <code>WireServer</code> / transporte</li>
                  <li>Doc <code>docs/m10-adapter-wire-protocol.md</code></li>
                </ul>
              </div>
              <div class="feature-group">
                <div class="group-name">PR-B — Agent runner + imagem</div>
                <ul class="feature-list">
                  <li>App novo <code>apps/agent-runner/</code> — wire server, spawn de <code>claude</code></li>
                  <li>Sandbox container-side + <code>mcp-bridge</code> (stdio ↔ wire)</li>
                  <li>Dockerfile multi-stage real (<code>node:22-slim</code>, não-root, <code>tini</code> PID 1)</li>
                </ul>
              </div>
              <div class="feature-group">
                <div class="group-name">PR-C — Host adapter + MCP relay</div>
                <ul class="feature-list">
                  <li><code>ClaudeRemoteDockerAdapter</code> + connection manager (1 conexão por host)</li>
                  <li>Transport launcher: <code>docker run</code> local / <code>ssh … -- docker run</code></li>
                  <li><code>McpRelay</code> per-agente — spawna o <code>mcp/server.js</code> real no host</li>
                </ul>
              </div>
              <div class="feature-group">
                <div class="group-name">PR-D — Settings + UX</div>
                <ul class="feature-list">
                  <li><code>AppSettings.remoteExecution</code> + seção "Execução remota" no Settings</li>
                  <li>Seletor de localização per-agente (contratação + Agent Studio)</li>
                  <li>IPCs <code>agents:set-adapter</code> + <code>remote:test-connection</code></li>
                </ul>
              </div>
              <div class="feature-group">
                <div class="group-name">PR-E — Docs</div>
                <ul class="feature-list">
                  <li><code>SECURITY.md</code> — threat model do adapter remoto refinado</li>
                  <li><code>docs/m10-vps-setup-runbook.md</code> — setup VPS + checklist de smoke</li>
                  <li>Roadmap em 3 lugares · v1 fechado</li>
                </ul>
              </div>
              <div class="feature-group">
                <div class="group-name">Segurança</div>
                <ul class="feature-list">
                  <li>OAuth token só no <code>handshake</code>, criptografado pelo SSH; vira env <code>CLAUDE_CODE_OAUTH_TOKEN</code>, nunca em disco</li>
                  <li>SSH host key pinada (<code>StrictHostKeyChecking=yes</code> + <code>BatchMode=yes</code>)</li>
                  <li>Container não-root, <code>--strict-mcp-config</code>, sem mounts de host, work dir efêmero</li>
                </ul>
              </div>
            </div>
          </article>
```

- [ ] **Step 6: Verify the rejected-design strings are gone**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && grep -nE "HTTPS\+WSS|gerenciador de VPS|Caddy auto-TLS|JWT signed|vps_audit_events|831 testes" docs/roadmap.html`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add docs/roadmap.html
git commit -m "docs(m10): mark v1 complete in roadmap html"
```

---

## Task 5: Final verification

PR-E touches no code — confirm the build/test gates are still green and the docs are consistent.

**Files:** none — verification only.

- [ ] **Step 1: Confirm the test suite, typecheck, and lint are untouched**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && pnpm typecheck && pnpm lint && pnpm test 2>&1 | grep -E "Tests |passed|failed"`
Expected: typecheck and lint clean; **973 passed + 2 todo** total across the four packages (no change from PR-D — this PR adds no tests).

- [ ] **Step 2: Confirm no stale design strings survive anywhere**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && grep -rnE "mutual TLS|HTTPS\+WSS|gerenciador de VPS" SECURITY.md ROADMAP.md docs/roadmap.html docs/m10-vps-setup-runbook.md`
Expected: no output — every reference to the rejected WSS/multi-VPS design is gone.

- [ ] **Step 3: Confirm the new runbook is referenced from SECURITY.md**

Run: `cd "D:/Projetos pessoais/DashboardAgent" && grep -n "m10-vps-setup-runbook" SECURITY.md`
Expected: one match (the "Setup:" line added in Task 1).

- [ ] **Step 4: Push to origin**

```bash
git push origin main
```

Expected: the PR-E commits land on `origin/main`. M10 — and v1 — are complete.

---

## Self-Review

**Spec coverage (M10 design spec §8/§10/§13):**
- §8 SECURITY.md — Task 1 rewrites the `claude-oauth-remote-docker` entry: SSH stdio transport, OAuth-in-handshake, non-root + tini + `--strict-mcp-config`, host key pinning, ephemeral work dir, host-side `gate.ts`. ✓
- §10 PR-E scope — SECURITY.md (Task 1), VPS runbook (Task 2), local-Docker smoke checklist (Task 2 Part C), roadmap in three places (Tasks 3–4). ✓
- §13 definition of done — the smoke checklist (Task 2 Part C) is the deliverable; the actual end-to-end run is a manual step for the user (no Docker on the build machine — stated in the runbook and Task 2). The roadmap now records 14/14 / v1 closed. ✓

**Placeholder scan:** No "TBD"/"add appropriate"/"similar to Task N". Every step quotes the exact current text to replace and the exact replacement. The runbook content is given in full.

**Consistency check:** Test count `973 passing + 2 todo` is used identically in Task 3 (ROADMAP.md), Task 4 (roadmap.html), and Task 5 (verification). The adapter name `claude-oauth-remote-docker`, the image tag `prospero/agent-runner:dev`, and the doc path `docs/m10-vps-setup-runbook.md` are spelled identically across all tasks. "5 PRs (A–E)" is consistent between Task 3 and Task 4.
