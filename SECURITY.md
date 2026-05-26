# Security Policy

Prospero is a desktop application that runs a multi-agent AI system on your machine. Each agent has access to your local filesystem and shell, authenticated via your Claude OAuth token. Because Prospero holds privileged credentials and can execute system commands, security is foundational — not optional.

This document describes what Prospero protects, the threat model we reason against, our security architecture, and how to report vulnerabilities responsibly.

---

## What Prospero Accesses and Protects

**Credentials**
- Your Claude OAuth token (or API key), used to authenticate all agent activity.
- Stored encrypted via the operating system's secure storage: Windows DPAPI, macOS Keychain, or Linux libsecret — via Electron `safeStorage`.
- No credentials are transmitted to Prospero servers. All authentication is local.

**Filesystem**
- Each agent operates inside an isolated sandbox directory per agent.
- Access outside that sandbox requires explicit approval via the permission gate.
- A blocklist of sensitive path prefixes (SSH keys, cloud provider credentials, OS credential stores) is enforced unconditionally — no approval can override it.

**Shell**
- Agents may request shell command execution.
- Commands matching a blocklist of destructive or data-exfiltration patterns are denied unconditionally before reaching the approval gate.
- All other shell requests go through the approval gate (CEO agent or human user, depending on configuration).

**Network**
- Prospero itself makes no outbound requests beyond Claude API calls.
- Agent-initiated network operations are subject to the same permission gate and blocklist.

---

## Threat Model

We actively reason against these threat scenarios:

**T1 — Prompt injection via crafted input**
An agent receives malicious content (via a message, a file it reads, or a memory entry) that attempts to redirect its behavior, exfiltrate credentials, or execute unauthorized commands. Mitigations: permission gate, command blocklist, sandbox isolation, injection-pattern detection on memory and skill writes.

**T2 — OAuth token or API key exfiltration**
An agent or compromised subprocess attempts to extract credentials from the runtime environment. Mitigations: credential isolation architecture, OS secure storage, environment hardening (active area of improvement — see "Active Hardening" below).

**T3 — Filesystem sandbox escape**
An agent attempts to read or write outside its designated sandbox using absolute paths or path traversal. Mitigations: per-agent CWD isolation, zone classification system (company/agent zone enforcement), path blocklist.

**T4 — Cross-agent privilege escalation**
A lower-privilege agent attempts to access another agent's credentials or working directory. Mitigations: per-agent isolated config directories, zone classification enforced at the gate layer.

**T5 — Renderer XSS → privileged API access**
Malicious content rendered in the Electron UI (e.g., via crafted Markdown in a chat message) attempts to access privileged APIs exposed to the renderer. Mitigations: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Content Security Policy, HTML sanitization before rendering (active area of improvement — see "Active Hardening" below).

**T6 — Prompt injection via memory or skills**
Hostile strings stored in agent memory or skill bodies are injected into future agent system prompts. Mitigations: injection-pattern sanitizer on all write paths, human approval required for skill promotion, read-only status for pinned memories.

**T7 — Supply chain compromise**
A compromised dependency gains runtime access. Mitigations: lockfile pinning, `gitleaks` pre-push hook for accidental secret commits, OS-level process isolation.

---

## Security Architecture

| Layer | Mechanism |
|---|---|
| Credential storage | OS secure storage (DPAPI / Keychain / libsecret) via Electron `safeStorage` |
| Renderer isolation | `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, CSP |
| Per-agent sandbox | Isolated config directory + working directory per agent |
| Permission gate | Every agent tool call evaluated before execution; sensitive operations require approval |
| Blocklist | Always-denied shell command patterns and sensitive path prefixes |
| Zone classification | Enforced boundaries between agent and company data zones |
| Memory sanitization | Injection-pattern detection on all memory and skill writes |
| Approval flow | Human-in-the-loop gate for sensitive operations; CEO agent as intermediate approver |
| Trust ladder | Per-agent trust tiers; auto-approve limited to read-only tools for non-novice agents |
| Update integrity | SHA512 verification of downloads via `electron-updater`; HTTPS from GitHub Releases |

---

## Active Hardening (May 2026)

The following categories of risk were identified in our internal Wave 1 security audit and are actively being addressed in the current release cycle. We are disclosing these categories publicly to set honest expectations; we are withholding specific exploit paths until fixes are shipped:

- **Credential environment isolation:** Ensuring OAuth credentials are not reachable via process environment inspection by agent subprocesses.
- **Sandbox boundary coverage:** Expanding zone classification to fully cover agent working directories and credential files within the sandbox.
- **Renderer Content Security Policy:** Implementing CSP to constrain script execution in the renderer and prevent UI-based attacks on privileged APIs.
- **Build environment bypass guards:** Ensuring development-only authentication shortcuts are inactive in production builds.

We will update this document as fixes land. Researchers who discover issues in these categories are welcome to report them — we will coordinate disclosure timing with the fix schedule.

---

## VPS Deployment Threat Model

The default Prospero distribution is a single-user Windows desktop app — the
threat model above assumes a hostile network is on the other side of the
internet, not on the same machine.

A second deployment mode (see `infra/docker/vps/`) ships the same Electron
app inside a Linux Docker container, exposed via noVNC behind Traefik +
Authelia. This changes the surface area meaningfully. The notes below
catalogue what becomes harder to defend and which compensating controls are
mandatory in this mode.

**Attack surface delta (VPS mode vs. desktop mode)**

| Attribute | Desktop (Windows) | VPS (Docker + noVNC) |
|---|---|---|
| Exposed to public internet? | No | Yes — TLS-terminated noVNC over HTTPS |
| Pre-authentication path | OS login | Authelia (password + TOTP) |
| Chrome sandbox | Active | **Disabled** (`--no-sandbox`) |
| Credential store backing `safeStorage` | DPAPI | libsecret (falls back to a basic in-memory store on a headless host with no keyring; the OAuth token comes in via env var and is never written to safeStorage in this mode) |
| Process isolation | OS user account | Docker container, non-root UID 1000 |
| Persistence of agent data | `%APPDATA%/Prospero` | `/opt/prospero/data` (volume) |
| Shell access from the desktop session | Local only | A logged-in user gets a real desktop session reachable from any browser |

**Mandatory controls in VPS mode**

1. **Authelia with 2FA must be the front door.** The Traefik labels in
   `docker-compose.yml` enforce `policy: two_factor` for the Prospero host.
   Basic Auth is documented as an alternative in `infra/docker/vps/README.md`
   but explicitly *not* recommended — it has no MFA, no session, and no
   audit. If you swap it in anyway, you accept the risk of credential
   replay against an unbounded desktop shell.
2. **TLS is mandatory.** The compose file routes only through the
   `websecure` (`:443`) entrypoint with a Let's Encrypt resolver. Do not
   add a plain-HTTP route — noVNC over plaintext leaks every keystroke
   and every screen update.
3. **Restrict source IPs when feasible.** If you operate from a stable
   set of locations, add a Traefik
   `ipallowlist.sourcerange=YOUR.IP.0.0/16` middleware in front of the
   Authelia one. The README shows the snippet.
4. **Guard the OAuth token.** `CLAUDE_CODE_OAUTH_TOKEN` is injected via
   the container env from `.env` (gitignored). It must never appear in
   container logs, in git history, in screenshots of the desktop, or in
   any chat with an agent. Rotation procedure is in the VPS README.
5. **Workspace volumes are the blast radius.** Anything you mount at
   `/opt/prospero/workspaces` is what agents can reach. Mount only
   projects you are willing to let agents read and write — never mount
   `/`, never mount `~`, never mount the docker socket.

**Why the chrome sandbox is disabled (`--no-sandbox`)**

Chromium's sandbox requires either `CAP_SYS_ADMIN` (which would mean
`privileged: true` — broad host access we explicitly refuse) or a
setuid helper binary that the AppImage doesn't ship in a form the
container can use. We launch the AppImage with `--no-sandbox` instead.

What this attenuates: a renderer-level RCE (T5 in the table above)
loses one layer of containment before it reaches the rest of the
container. The compensating layers — `contextIsolation: true`,
`nodeIntegration: false`, the docker container itself, the non-root
UID — all remain in place. We consider the tradeoff acceptable given
the threat model of a single-user deploy gated by 2FA, but a future
hardening pass should re-evaluate (e.g. by shipping a setuid
chrome-sandbox helper inside the image, or by switching to a kernel
that exposes user-namespaces such that the sandbox can be re-enabled).

**Workspace isolation between agents**

The desktop threat model (T3, T4) assumes per-agent sandbox directories
plus the M13 zone classifier. Both are still active in VPS mode — the
container does not weaken them. What the container *adds* is a hard
outer boundary: even a full sandbox escape lands the agent inside a
non-root container with only the explicitly mounted volumes reachable.
The docker daemon socket is never mounted; agents have no path to
break out into the host.

**Logging hygiene**

`entrypoint.sh` does not log the contents of any env var. Agent activity
logs continue to be written to the SQLite database under
`/opt/prospero/data` and follow the same scrub rules as the desktop
build. If you change the entrypoint to add logging, audit any new line
that touches `$CLAUDE_CODE_OAUTH_TOKEN` or `$ANTHROPIC_API_KEY` for
accidental disclosure.

---

## Scope

**In scope for responsible disclosure:**
- Exfiltration of the user's OAuth token, API key, or other credentials managed by Prospero
- Escape from the agent sandbox to arbitrary filesystem access
- Bypass of the permission gate or command blocklist
- Cross-agent privilege escalation (one agent reading another agent's credentials or data)
- XSS or other renderer attacks that access privileged contextBridge APIs
- Prompt injection via agent memory, skills, or messages leading to unauthorized action
- Unauthorized action taken by an agent without user approval
- Vulnerabilities in the update mechanism that could allow a tampered binary to be installed

**Out of scope:**
- Denial of service against the local application
- Attacks requiring physical access to the user's machine
- Vulnerabilities in third-party dependencies (report to the respective maintainer; also notify us if Prospero is directly affected)
- Social engineering of the user
- Vulnerabilities in Claude itself (report to [Anthropic](https://www.anthropic.com/security))
- Theoretical issues without a practical exploit path on a default installation

---

## Responsible Disclosure Policy

We follow a **coordinated disclosure** model.

1. **Report privately** — use the contact below. Do not publish or share details publicly before a fix is available and users have had time to update.
2. **We acknowledge within 48 hours** — you will receive confirmation that your report is being reviewed.
3. **We triage within 5 business days** — we will assess severity and confirm whether the issue is in scope.
4. **Fix timeline targets:**
   - Critical: 30 days
   - High: 60 days
   - Medium / Low: 90 days
   We will communicate progress and may request an extension for complex issues.
5. **Coordinated release** — we agree on a disclosure date with you. Default: once a fix is available and users have had reasonable time to update.
6. **Credit** — with your permission, we will acknowledge your contribution in the release notes.

We ask that you:
- Give us reasonable time to develop and ship a fix before publishing
- Limit your testing to your own installation — do not access, modify, or exfiltrate other users' data
- Avoid automated scanning that could degrade service for other users

---

## Reporting a Vulnerability

**GitHub private security advisory (preferred):**
Use the [Security tab](../../security/advisories/new) on this repository to open a private advisory. This keeps the report confidential and gives us a shared workspace to coordinate.

**Email:**
security@prospero.app *(replace with actual contact before publishing)*

**What to include:**
- Description of the vulnerability and its potential impact
- Steps to reproduce (Prospero version, OS, configuration)
- Proof-of-concept code, screenshots, or logs (redact any personal data)
- Your preferred contact for follow-up

We do not currently offer a monetary bug bounty, but we are happy to discuss recognition and public attribution.

---

## Supported Versions

| Version | Security support |
|---|---|
| Latest release | ✅ Supported |
| Older releases | ❌ No — please update |

Prospero is in early development. We strongly recommend always running the latest release. The auto-updater (`electron-updater`) will notify you of new versions at launch.

---

## Security Contact

For non-vulnerability security questions — threat model, architecture, compliance — open a GitHub Discussion or issue tagged `security-question`.

For vulnerabilities, use the private channels above. **Do not open a public GitHub issue for security vulnerabilities.**

---

*Last updated: May 2026. Post Wave 1 internal security audit.*
