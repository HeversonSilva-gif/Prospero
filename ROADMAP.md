# DashboardAgent — Roadmap

> Living doc. Atualizar a cada feature/fix mergeado em `master`.
>
> **Spec base:** [docs/superpowers/specs/2026-05-09-dashboard-agent-design.md](docs/superpowers/specs/2026-05-09-dashboard-agent-design.md)
> **Referência ativa de UX/código:** [Paperclip](https://github.com/paperclipai/paperclip) — clone funcional via OAuth Max em vez de API key
> **Comparação técnica:** [docs/paperclip-comparison.md](docs/paperclip-comparison.md) — origem dos itens em M7.5 e V2
> **Gaps UX/governance:** [docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md](docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md) — origem dos M7.6, M7.7, M8.5
> **Última atualização:** 2026-05-12 (M7.7 fechado em master via `ea05e2a`. **M7.6 PR-A entregue na branch `feat/m7.6-pr-a`** — backend: migration 0010 (paused_at/terminated_at/pause_reason + status CHECK widening via table recreation) + 9 IPCs novos (setMode/setAlwaysOn/setSkills/pause/resume/terminate/wake-up/reset-session/hire-from-ui) + 6 repo methods novos com activity dual-write + 2 activity actions novas (agent.mode_changed/always_on_changed) + HIRE_AGENT_INPUT_SCHEMA + HIRE_FROM_UI extraídos pra shared + enqueueOrPark backlog pra paused agents (process-lifetime, drains no resume). 457 tests passing (delta +46). Próximo: PR-B UI (header sticky + ConfigTab additions + Runs modal + AgentNew form + Instructions full-screen modal).)
>
> **Distribuição (decisão 2026-05-11):** **hybrid** — Electron desktop continua como default e UI. Adapter pattern (M7.5 foundation, M9 API key, **M10 VPS Docker**) permite spawnar agentes localmente OU em containers Docker numa VPS remota. Usuário escolhe per-agent (CEO local pra latência, engenheiros remotos pra isolamento). Sem rewrite — adapter pattern absorve o segundo lifecycle.

## Status atual

| Métrica | Valor |
|---|---|
| Milestones fechados | M1, M2, M3, M4, M5, M6, **M7**, **M7.5** (8/14 do v1: M1–M10 + M7.5 + M7.6 + M7.7 + M8.5) |
| Em curso | **M7.6 PR-A** ready-to-merge (branch `feat/m7.6-pr-a`, 14 commits, backend done). Próximo: PR-B (UI). |
| Testes | **457 passing** (396 main + 28 renderer + 33 shared), 0 lint/typecheck errors. Delta PR-A: +13 main (lifecycle ×7 + migration ×2 + pause-backlog ×4). |
| Commits no master | ~165 |
| LoC (apps + packages) | ~14k TS/TSX |
| Stack | Electron 33 · React 18 · Vite · Tailwind · zustand · better-sqlite3 (WAL) · MCP SDK · vitest · Playwright (E2E, skipped) |
| Distribuição planejada | Hybrid: desktop default + VPS Docker remote opcional (M10) |

---

## v1 scope tracker (spec §4)

Status por **módulo** funcional do produto. Cada módulo pode estar em vários estados parciais entre milestones.

| Módulo | Status | Notas |
|---|---|---|
| **Multi-empresa** | 🟡 Parcial | Backend pronto (`companies` table, `company:create-demo` IPC). UI: dropdown topo da sidebar pra trocar entre empresas **AINDA NÃO** (M9). Sidebar mostra a primeira company por default. |
| **Dashboard** | 🟡 Stub | Rota `/dashboard` existe (placeholder M2). Widgets §6.4 + Recent Activity + Active Agents **NÃO** (M9 consome Activity stream do M7.7). |
| **Activity stream** | ✅ Completo | Migration 0009 `activity_events` + recorder helper + dual-write em 17 call sites (PR-A). Rota `/activity` com 5 filtros + search + infinite scroll + real-time prepend via `ACTIVITY_NEW` + 700ms animação fade-down (PR-B). Sem `issue_events` migrado — dual-write paralelo. |
| **Inbox** | ✅ Completo | Rota `/inbox` com filter pills (All/Approvals/Completed/Suggestions/Errors/Security). Approve/Reject inline. Auto-mark-read no resolve. Badge unread no sidebar. **M7.5 PR-B:** dual-format handler suporta legacy embedded payload + new `approval_id` pointer. |
| **Issues** | ✅ Completo | MCP tools (create/update/assign/list/check_status/record_artifact) reais. Kanban /issues com 5 colunas + drag-drop. Modal de detail com comments + sub-tasks + tool history. **M7.5 PR-B:** identifier humano `<SLUG>-N` (ex: `BACKEND-7`) em todos call sites + artifacts accordion + soft warning ao marcar `done` sem artifacts. |
| **Projects** | ✅ Completo | Rota /projects master/detail com folder picker + color picker. Auto-cria 'Default Workspace' migration do workspaceCwd legado. Allowlist per agent via chip toggle. |
| **Agents** | 🟡 Parcial | Sidebar com status colors. `/agents/:id` chat unified + right panel M7-C (Config/Issues/Stats). **M7.6 PR-A backend completo**: 9 IPCs novos (pause/resume/terminate/setMode/setAlwaysOn/setSkills/wake-up/reset-session/hire-from-ui), migration 0010 (paused_at/terminated_at/pause_reason + status CHECK widening), enqueueOrPark backlog. UI: header de ações + Runs timeline + form `/agents/new` em PR-B. |
| **Org Chart** | ✅ Completo | Rota `/org` SVG handcrafted vertical tree + click drawer + drag-to-reassign + confirm modal + anti-cycle (backend + UI toast). |
| **Skills** | ✅ Completo (read-only) | Rota `/skills` master-detail (5 roles seedados, tools chips por skill, agentsUsing). Hard-gate via `--allowedTools`. Edit per-agent: M7.6. |
| **Costs** | ❌ Não iniciado | Tabela `costs_log` existe. Tracking automático **NÃO** liga (M8). Rota `/costs` zerada (M8). |
| **Goals + CEO Planning** | ❌ Não iniciado | Tabela `goals`/`goal_plans` não existe. Feature além do Paperclip (CEO-planner automático). M8.5. |
| **Settings** | ✅ Completo | OAuth token (manual + auto-detect M2), language, theme, default model. Defaults de mode/always_on **NÃO** UI ainda — M9. |

---

## Milestones fechados

### ✅ M1 — Foundation (Electron + React + SQLite + IPC)

**Mergeado:** Q1 2026 (commit base)
**Lições:** [project_m1_lessons.md](memory) — sandbox preload CJS, base:./ Vite, ABI rebuild, etc.

- [x] Electron main + renderer com `contextIsolation: true`
- [x] better-sqlite3 com migrations sequenciais
- [x] IPC channels constant (`packages/shared/src/ipc-channels.ts`)
- [x] Schema completo do v1 (companies, projects, agents, issues, threads, messages, inbox_items, costs_log, skills_catalog, role_templates, settings)
- [x] Tray icon (sobrevive janela fechada parcialmente — debt)

### ✅ M2 — Auth & Settings

**Mergeado:** 2026-04-30
**Lições:** [project_m2_lessons.md](memory) — Tailwind CSS vars pra dark mode, store reativo pra routing, i18n cobertura, safeStorage

- [x] OAuth token storage com Electron `safeStorage` (DPAPI no Windows)
- [x] Setup wizard: paste manual OU auto-detect de `~/.claude/.credentials.json`
- [x] Settings UI: language (pt-BR/en-US), theme (light/dark)
- [x] i18n via react-i18next com regra dura (sem mistura)
- [x] Tema claro/escuro com paleta Subido PRO + Poppins (offline-first)

### ✅ M3 — Orchestrator + MCP Core

**Mergeado:** 2026-05-09
**Lições:** [project_m3_lessons.md](memory) — stream-json shapes, persistência sem `-p`, direct .exe spawn em Win+Electron, sandbox lockdown via `CLAUDE_CONFIG_DIR` + `--strict-mcp-config`

- [x] AgentRunner com claude `--input-format stream-json` persistente (não `-p`)
- [x] Stream parser (`session-init`, `assistant-message`, `tool-result`, `turn-complete`, `api-retry`)
- [x] MCP server interno (stdio child, `@modelcontextprotocol/sdk`)
- [x] CEO seed automatic ao criar empresa demo
- [x] Sandbox: CLAUDE_CONFIG_DIR isolado per-spawn + `--strict-mcp-config` (sem MCP global, sem hooks, sem skills)
- [x] Max 4 agentes concorrentes enforced (ToS Anthropic)
- [x] Persistent per-agent CLAUDE_CONFIG_DIR pra `--resume` funcionar across spawns

### ✅ M4 — Security Hardening

**Mergeado:** 2026-05-10
**Lições:** [project_m4_lessons.md](memory) — IPC raw-secret split detect/action, deletar fake-auth, git filter-repo workflow Windows (`py -m`), offline-first via `@fontsource`, lint-staged + commitlint quirks

- [x] **SEC-01:** OAuth token nunca cruza pra renderer — IPC `auth:token-detect` retorna apenas `{found, maskedPrefix}`; novo `auth:token-import-detected` faz save no main
- [x] **SEC-02:** `verifyMcpToken` no-op deletado — stdio é pipe privado pai-filho, não precisa auth aplicacional
- [x] **SEC-03/04:** `git filter-repo` aplicado — email pessoal removido de blobs; author/committer rewriteado pra noreply GitHub
- [x] **SEC-05:** Offline-first fonts via `@fontsource/poppins` (sem `fonts.googleapis.com`)
- [x] Regression-guard tests (token leak, sandbox escape, fence file)

### ✅ M5 — Multi-Agent Orchestration + Security Layer

**Mergeado:** 2026-05-10 (`fbcff14`, 31 commits)
**Lições:** [project_m5_lessons.md](memory) — file-fence pattern, router pure-fn, settings.json `permissions.ask` pra built-ins, request_permission key=`input` (não tool_input), roster em turn-complete (stderr MCP unreliable Win), inbox markRead direto no IPC handler (chokidar race)

- [x] MCP tools reais: `list_agents`, `hire_agent`, `fire_agent`, `message_agent`, `read_thread`, `notify_user`, `request_permission`
- [x] Per-agent message router (FIFO queue, currentTurnThreadId, sender prefix `[from: <name>]`)
- [x] Async cross-thread message routing (CEO ↔ sub-agente threads)
- [x] Bash/Edit/Write gating via `--permission-prompt-tool` + per-spawn `<CLAUDE_CONFIG_DIR>/settings.json` com `permissions.ask`
- [x] Workspace filesystem sandbox (auto-deny path fora de `settings.workspaceCwd`)
- [x] Lista versionada §8.3 always-blocked patterns (curl exfil, .credentials.json, rm -rf /, etc)
- [x] Sidebar: lista agents + 5 status colors (idle/thinking/working/waiting/error) + Inbox link com unread badge
- [x] /inbox route com filter pills + approve/reject inline
- [x] ApprovalCard inline em /agents/:id
- [x] Agent route com unified cross-thread stream
- [x] Settings: workspace folder picker (Electron native dialog)
- [x] Roster broadcast em todo turn-complete (sidebar live)
- [x] Auto-scroll do chat
- [x] Spec v1 §8.5 reescrita (M4 stdio reality) e §8.2 nota pre-Projects-CRUD

**Trade-offs aceitos em M5:**
- Approval gate pra MCP orchestration tools (hire_agent etc) **dropped** — auto-allow via settings.json. Justificativa: side-effects são DB writes visíveis imediato em sidebar/inbox; user observability cobre auditoria sem prompt pré-execução. Fácil reverter movendo de `permissions.allow` pra `permissions.ask`.

### ✅ M6 — Issues + Projects CRUD

**Mergeado:** 2026-05-10 (`3ef6a68`, ~25 commits)
**Lições:** [project_m6_lessons.md](memory)

- [x] Migration 0002 — issue_comments + issue_events tables
- [x] Post-migration: auto-cria "Default Workspace" project a partir do `settings.workspaceCwd` legado
- [x] Projects backend: repository (CRUD + checkPaths) + 6 IPC channels
- [x] /projects route master/detail com ProjectFormModal + AllowlistEditor (chip toggle por agente)
- [x] Sandbox migration: `gate.ts` agora aceita `allowedProjectPaths: string[]` (uniao filtrada por agent.allowed_projects); permission-watcher resolve por agent
- [x] Issues backend: repository com event writer + tool history derivation + comments repo + 7 IPC channels
- [x] 5 MCP tools reais: create_issue (com lookup name OR id), update_issue, assign_issue, list_issues, check_status
- [x] update_issue status=done dispara inbox `completed` notification
- [x] /issues kanban (5 colunas) com @dnd-kit drag-drop + filtros project/assignee/priority
- [x] IssueDetailModal: comments timeline + sub-tasks + tool call history accordion + reassign dropdown
- [x] Real-time: orchestrator emite issue.created/updated → broadcastIssueChanged → renderer
- [x] Settings UI: workspace folder picker removido (link pra /projects)
- [x] Token budget non-regression test (skip-while-zero até user capturar baseline real)

---

## Sequência de milestones (v1)

**Ordem recomendada:**

```
M1–M6 ✅ · M7 ✅ MERGED
  ↓
M7.5 (foundations — adapter pattern, migrations 0004-0007)
  ↓
M7.7 (Activity Stream — FOUNDATION; helper pré-req de M7.6 e M8.5)
  ↓
M7.6 (Agent Studio — completion sobre M7-C)
  ↓
M8  (Costs UI + Token Tracking)
  ↓
M8.5 (Goals + CEO Planning — feature além do Paperclip)
  ↓
M9  (Dashboard + Multi-empresa + Reviews UX + API key)
  ↓
M10 (VPS Docker Remote Adapter)
```

**Antes de cada milestone, consultar Paperclip** (`reference_paperclip` memory) pra UX/código.

---

### ✅ M7 — Org Chart + Skills + Model Selection — **MERGEADO** (`8b03792`)

**Por que junto:** ambos são views/edits sobre dados que já existem (`reports_to` e `skills_json`). Sem novos backend handlers grandes — UI-heavy.

**Decisão arquitetural (após Paperclip comparison):**
- **Org Chart:** SVG handcrafted no client, não React Flow nem D3. ~300 linhas, zero deps. Razão: Paperclip faz server-side com 5 temas; pra nós, SVG no DOM é suficiente, controle total, fácil estender com transitions CSS. ([docs/paperclip-comparison.md §13](docs/paperclip-comparison.md))
- **Skills:** manter modelo tag-based (`agents.skills_json` string array). **NÃO** imitar Paperclip code-module + source sync (GitHub/NPM) — fora do nosso threat model. Hard-gate via system prompt + MCP tool whitelist.
- **Model selection:** preset enum em `packages/shared` + escape "custom". Dropdown mostra **cost hints relativos** (Opus 5× / Sonnet 1× / Haiku 0.2× — referência simbólica). Memory `feedback_token_efficiency` exige aviso ao selecionar Opus pra subagente leve.

- [x] **Org Chart:** — **PR-C 🟢 mergeado em `8b03792`** (2026-05-11)
  - [x] Rota `/org` com tree visual (SVG handcrafted, zero deps — `layoutTree.ts` puro com 6 tests)
  - [x] CEO no topo, sub-agentes filhos via `reports_to` (orphans viram roots)
  - [x] Click num node abre drawer 320px com info do agente + link pra `/agents/:id`
  - [x] Drag pra mudar `reports_to` (com confirm modal + anti-cycle backend/UI toast)
- [x] **Skills:** — **PR-B 🟢 mergeado em `8e8efc7`** (2026-05-11)
  - [x] Rota `/skills` master-detail read-only (5 roles seedados + tools chips agrupados por skill + agentsUsing)
  - [x] Em `/agents/:id` right panel: campo "Skills" mostrando `skills_json` atual (read-only chips com hint sobre role) — **PR-C 🟢**
  - [x] Aplicação real: agente só pode chamar tools listadas em skills — via `--allowedTools` no spawn (hard-gate)
  - [x] Templates de role seedados pelo post-migration 0004 + usados via `role_template_id` no `hire_agent`
- [x] **Seleção de modelo por agente** ⚡ urgente — **PR-A 🟢 mergeado em `0caa31b`** (2026-05-11):
  - [x] Adicionar coluna `agents.model` (TEXT, default `claude-sonnet-4-6`) via migration 0003 + `role_templates.default_model` + index
  - [x] Right panel em `/agents/:id`: dropdown com presets + custom + regex guard — **PR-C 🟢**
  - [x] `lifecycle.ts buildClaudeArgs`: passar `--model <agent.model>` no spawn
  - [x] MCP tool `hire_agent`: aceita `role_template_id` (que carrega default_model) — **PR-B 🟢**
  - [x] Settings: campo "Default model for new agents" (dropdown presets + custom + regex injection guard, i18n en+ptBR)
  - [x] Considerar custo por role: aplicado nos defaults de role em PR-B (Opus pra CEO, Sonnet engineers, Haiku simples)
- [x] **Right panel `/agents/:id`** — **PR-C 🟢** 3 tabs (Config/Issues/Stats): role-change modal com preserveModel checkbox, model dropdown preset+custom, skills read-only, persona textarea (debounced 500ms), agent-centric AllowlistEditor, lista de issues assignee, stats (turns + lastActivity; tokens placeholder até M8).
- [x] **IPC handlers de mutação** — **PR-C 🟢** `agents:set-model` / `:set-role` / `:set-system-prompt` / `:set-reports-to` / `:stats` com `restartIfRunning` (kill+clearSession+broadcast) pras mutações que afetam spawn args.
- [x] **Não-regressão:** 276 tests passing (vs 260 baseline), 0 lint/typecheck errors, build limpo.

---

### ✅ M7.5 — Foundations & Paperclip Refactors (**FECHADO 2026-05-12**)

**Origem:** itens 🔴 (alta prioridade) e parte dos 🟡 da [Paperclip comparison](docs/paperclip-comparison.md). Refatorações estruturais e melhorias UX/governança que preparam M8/M9/M10 — especialmente o **adapter pattern**, que é pré-requisito do API key (M9) e do VPS Docker remote (M10).

**Entregue em 3 PRs sequenciais** (todos mergeados em master):
- **PR-A** (`a633e41`, 2026-05-11) — Adapter pattern foundation + lifecycle.ts shrink 388→72 LOC + composeSystemPrompt + preamble.md external + migration 0004
- **PR-B** (`baca895`, 2026-05-12) — 4 migrations 0005-0008 (issue identifier humano, messages.kind, approvals decoupled, issue_artifacts) + repos + MCP tools
- **PR-C** (`bb9cb39`, 2026-05-12) — UX polish (currentAction granular + IPC delta + 200ms debounce) + auth-mode.ts + SECURITY.md + VPS stubs + E2E setup

**Métricas finais:** 392 testes passing (de 245 antes de M7.5 = +147), bundle renderer 362 kB / 110 kB gzip.

#### Refactors estruturais (prep para próximos milestones)

- [x] **Modularizar `apps/main/src/orchestrator/lifecycle.ts`** — extrair `buildClaudeArgs`, `prepareSandbox`, `resolveBinary`, `mcpHandshake` em arquivos próprios. **PR-A 🟢** (lifecycle.ts 388→72 LOC)
- [ ] **Modularizar `apps/main/src/mcp/tools.ts`** — **adiado pra M8** (529 LOC ainda gerenciável; split sem feature nova é refactor isolado; M8.5 vai adicionar `tools/goals.ts` e aproveita pra splittar)
- [x] **PREAMBLE em arquivo `.md`** — `apps/main/src/orchestrator/preamble.md` lido com `fs.readFileSync` + cache + override opcional `~/.dashboard-agent/preamble.md`. **PR-A 🟢**
- [x] **System prompt composable** — `composeSystemPrompt({preamble?, agentPersona, skills, role?})` builder. **PR-A 🟢**

#### 🔧 Adapter pattern foundation (**critical path para M9 + M10**)

- [x] **Interface `AgentAdapter`** em `packages/shared/src/types/adapter.ts` (stateful, métodos `start/sendInput/onEvent/onStderr/onExit/kill/isAlive/getUsage/getCurrentAction`). **PR-A 🟢**
- [x] **`ClaudeOAuthLocalAdapter`** em `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` (~225 LOC). **PR-A 🟢**
- [x] **Registry** em `apps/main/src/orchestrator/adapters/index.ts` com `createAdapter(name, ctx)` factory. **PR-A 🟢**
- [x] **Testes** — 65 testes novos pós-PR-A (245→310). **PR-A 🟢**

#### Schema & DB

- [x] **Migration 0004 — `agents.adapter_name`** — `TEXT NOT NULL DEFAULT 'claude-oauth-local'`. **PR-A 🟢**
- [x] **Migration 0005 — `issues.identifier` humano (`BACKEND-7`)** — `projects.slug` + `issues.issue_number` + `issues.identifier` + index único `(project_id, issue_number)` + post-migration TS backfill com colisão handling. **PR-B 🟢**
- [x] **Migration 0006 — `messages.kind`** — enum `message | proposal | question | confirmation | observation` + badge no MessageList. **PR-B 🟢**
- [x] **Migration 0007 — `approvals` decoupled do `inbox`** — nova tabela + `inbox_items.approval_id` pointer + `ApprovalsRepository` + dual-format handler. **PR-B 🟢**
- [x] **Migration 0008 — `issue_artifacts`** — tabela + `ArtifactsRepository` + MCP tool `record_artifact` (Zod schema + length checks) + accordion no IssueDetailModal + soft warning quando `status='done'` sem artifacts. **PR-B 🟢**

#### Auth foundation (prep M9 dual auth)

- [x] **`apps/main/src/auth/auth-mode.ts`** — `getActiveAuthMode(): "oauth" | "api-key"` retornando `"oauth"` hoje. Wired em `lifecycle.ts` como defense-in-depth pra adapter selection. **PR-C 🟢**

#### UX & Polish

- [x] **Current action granular** — `apps/main/src/orchestrator/current-action-mapper.ts` pure fn mapeia tool_use → "Reading X" / "Editing Y" / "Running shell" / "Searching" / "Talking to dashboard" (basename only, nunca leaka path/comando). Sidebar mostra linha italica debaixo do nome do agent quando status ∈ {working, thinking}. **PR-C 🟢**
- [x] **Granular IPC events delta** — `AgentEvent` split em `status-changed` + `current-action-changed` + `session-id-changed`. Renderer subscriber usa `switch(ev.kind)` com 3 actions granulares no store (`applyAgentStatus/applyCurrentAction/applySessionId`). 200ms debounce per-agent em `event-throttle.ts` coalesce múltiplos tool_use no mesmo turn. **PR-C 🟢**

#### Testes

- [x] **E2E foundation com Playwright + Electron** — `tests/e2e/{playwright.config, fixtures, helpers, specs}` + `fake-claude.ts` stub gated por `DASHBOARD_AGENT_E2E_FAKE_CLAUDE=1` + env-var bypass (`DASHBOARD_AGENT_USER_DATA`, `DASHBOARD_AGENT_E2E_TOKEN_PATH`). 3 specs (`01-onboarding`, `02-hire-and-message`, `03-issue-lifecycle`) **escritos mas `test.describe.skip(...)` por incompat Electron 33 + Playwright 1.60** (`--remote-debugging-port=0` rejeitado pela Electron). Unskip é one-line change quando upstream resolver. **PR-C 🟢 (infrastructure)** / **bloqueado por incompat (runs)**
- [ ] **Cobertura de orchestrator + MCP tools** — adiado: feedback de campo dirá quais fluxos faltam cobertura
- [ ] **Snapshot tests da blocklist** — adiado pra follow-up trivial pós-M7.5

#### Security

- [x] **SECURITY.md atualizado** — 3 seções novas: Architectural decisions (blocklist persiste + per-agent config dir), Adapter threat models (`claude-oauth-local` atual + `claude-api-key-local` M9 + `claude-oauth-remote-docker` M10), Approvals & artifacts storage. **PR-C 🟢**
- [x] **Decisão consciente registrada**: blocklist `gate.ts §8.3` permanece em todos os adapters como defense-in-depth (documentado em SECURITY.md). **PR-C 🟢**

#### VPS prep (não implementa ainda, prepara terreno)

- [x] **`infra/docker/agent-runner/Dockerfile` stub** — placeholder com `FROM node:22-alpine` + TODOs M10 (non-root user, tini, healthz endpoint, claude CLI install). **PR-C 🟢**
- [x] **`infra/docker/compose.yml` stub** — env vars (`ADAPTER_WIRE_PROTOCOL_VERSION`, `CLAUDE_API_KEY`, `DASHBOARD_MCP_URL`, `HEALTH_PORT`), ports 9700 (wss) + 9701 (health), volume `agent-state`. **PR-C 🟢**
- [x] **Wire protocol document** — [docs/m10-adapter-wire-protocol.md](docs/m10-adapter-wire-protocol.md) com 217 LOC: handshake/spawn/stdin-write/kill/event/stderr/exit/health methods + 7 error codes + transports stdio (local) + WSS (remote) + security section. **PR-C 🟢**

#### Não-regressão

- [x] Tudo do M6.1 smoke-test continua passando — manual check 2026-05-12
- [x] Security suite (token leak, sandbox escape, fence file, blocklist) verde — 46 tests passing
- [x] Token budget non-regression test ainda skip-while-zero (baseline ainda não capturado)

---

### 🆕 M7.7 — Activity Stream — **foundation pra M7.6/M8/M8.5**

**Origem:** [docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md §4](docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md). Print do user mostrou que o Paperclip oferece "visão e controle do todo" via `/activity` cross-cutting — único surface da sidebar COMPANY que não temos equivalente.

**Por que antes do M7.6 apesar do número:** infra do `recordActivity()` vira pré-req de TODO IPC novo que M7.6 introduz (pause/terminate/set-mode/etc). Sem ela, cada novo IPC duplica lógica de logging.

**Decisão arquitetural:**
- **Tabela única `activity_events`** unificada — mas `issue_events` e `inbox_items` existentes **continuam** (dual-write consciente; não migrar dados). Volume cost: `cost.day_summary` (1 row/dia/agente) em vez de `cost.recorded` per-turn.
- **Helper central `recordActivity()`** com Zod payload validation chamado de toda mutation.
- **Distinção clara Activity ↔ Inbox:** Activity = imutável append-only history. Inbox = mutável work surface. Approval triggers ambos.

#### Schema & helper

- [ ] **Migration M7.7-01 — `activity_events`**:
  - Colunas: `id, company_id, actor_kind ('user'|'agent'|'system'), actor_id, action, entity_kind, entity_id, agent_id (denorm), payload_json, created_at`
  - 4 índices: `(company, time desc)`, `(entity_kind, entity_id)`, `(agent, time desc)`, `(action)`
  - Sem FK em entity_id por design — preserva audit quando entidade deletada
- [ ] **`apps/main/src/activity/recorder.ts`** — helper `recordActivity({companyId, actor, action, entityKind, entityId, payload})` que valida payload via Zod + escreve row + broadcasts `ACTIVITY_NEW`
- [ ] **`packages/shared/src/types/activity.ts`** — enum `ActivityAction` (~30 actions v1: `agent.*` 10, `issue.*` 5, `approval.*` 3, `project.*` 3, `goal.*` 4 (defer M8.5), `session.*`/`cost.day_summary` 3, `company.*` 2). Discriminated union de payloads por action.
- [ ] **Dual-write em ~15 call sites** existentes:
  - `agents/repository.ts` setModel/setRole/setSystemPrompt/setReportsTo (M7-C handlers)
  - `issues/repository.ts` create/updateStatus/assignIssue (dual com `issue_events`)
  - `projects/repository.ts` create/update/delete
  - `mcp/tools/*` (hire_agent, fire_agent)
  - `permissions/service.ts` request/resolve

#### IPC + real-time

- [ ] **Novo channel `ACTIVITY_NEW`** em `packages/shared/src/ipc-channels.ts`
- [ ] **Broadcast pattern** igual `AGENT_EVENT` (M5): `BrowserWindow.webContents.send` com payload do evento
- [ ] **Granular delta**, não snapshot completo — alinha com refactor de M7.5

#### UI — Página `/activity`

- [ ] **Rota `apps/renderer/src/routes/Activity.tsx`** (nova)
- [ ] **Sidebar item "Activity"** entre Inbox e Settings
- [ ] **Layout:** flat list desc por `created_at`, infinite scroll (50/chunk)
- [ ] **Filtros:** actor_kind, action, entity_kind, agent_id, date range
- [ ] **Search textual** client-side (FTS5 fica v2)
- [ ] **Click numa entry** → navega pra entity (issue → IssueDetailModal, agent → `/agents/:id`, etc). Entity deletada: tooltip "(deleted)" + click disabled.
- [ ] **Real-time:** subscribe `ACTIVITY_NEW` → prepend com fade-in animation 700ms
- [ ] **Payload truncate** 4KB hard cap + 200 chars preview na listagem
- [ ] **i18n PT-BR + EN-US**

#### Não-regressão

- [ ] `issue_events` continua funcionando (IssueDetailModal não quebra)
- [ ] Inbox flow inalterado
- [ ] Smoke test M6.1 verde
- [ ] Security suite verde
- [ ] Token budget non-regression

**Custos:** 3-4 dias. **Pré-req:** nenhum hard. **Recomendo antes de M7.6** porque M7.6 vai querer logar pause/terminate/etc desde o primeiro dia.

---

### 🆕 M7.6 — Agent Studio — completion sobre M7-C

**Origem:** [docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md §1](docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md). Completa a liberdade de mexer no agente direto pela UI (M7-C entregou base; faltam ações stateful + alguns toggles + form de criação + Runs timeline).

**Decisão arquitetural:**
- **Layout chat-first híbrido** (NÃO Paperclip 1:1 com 6 tabs). Chat segue centro, right panel já existe (M7-C), header sticky novo com ações, modal full-screen pra Runs.
- **Pause como status formal** (retomável) ≠ Terminate (soft-delete, status='terminated', histórico preserva).
- **Form `/agents/new` paralelo a `hire_agent` MCP** — ambos caminhos coexistem (UI direta + CEO orquestra).
- **`recordActivity()`** chamado em cada novo IPC desde o dia 1 (pré-req M7.7).

#### Header sticky de ações em `/agents/:id`

- [ ] **Status badge** (idle/thinking/working/waiting/error/**paused**/terminated) com `currentAction` text
- [ ] **`▶ Pause` toggle** — chama `agents:pause` ou `agents:resume`. Quando paused: badge muda, ícone `⏸`.
- [ ] **`+ Assign Task` button** — abre `IssueCreateModal` pré-preenchido com `assignee_agent_id = current`
- [ ] **`⋯` overflow menu**: Copy Agent ID, Reset Session (limpa `--resume` checkpoint), **Terminate** (confirm modal)

#### Completar ConfigTab (M7-C base)

- [ ] **Reports to dropdown** (lista agents da company exceto si próprio + descendentes) — IPC `agents:set-reports-to` já existe (M7-C); só wire UI
- [ ] **Mode** (radio supervised | auto) — **novo** IPC `agents:set-mode` + handler + repo method
- [ ] **Always-on** (switch) — **novo** IPC `agents:set-always-on` + handler + repo method
- [ ] **Skills** (checkboxes com required/optional segregadas) — **novo** IPC `agents:set-skills` + handler + repo method

#### Schedule sub-section

- [ ] **Always-on switch** (duplica Config; user-friendly aqui)
- [ ] **Manual trigger button** = `agents:wake-up(id, reason)` — força um turn no chat com system message "User requested manual run". Adapta Paperclip `Run Heartbeat` à nossa arch streaming.

#### Runs modal full-screen

- [ ] **`apps/renderer/src/components/AgentRunsModal.tsx`** (novo)
- [ ] Timeline derivada de `messages` (`role='assistant'` + tool calls)
- [ ] Por run: timestamp · trigger · tools chamadas · tokens (deps M8) · duração · status
- [ ] Filtros: date range, trigger source, status
- [ ] Botão "Reset session" inline

#### Form `/agents/new`

- [ ] **Rota `apps/renderer/src/routes/AgentNew.tsx`** (nova)
- [ ] Form: name (required) · role template (gallery) · title · reports_to · model · mode · persona (textarea) · skills (checkboxes) · allowed_projects (chips)
- [ ] Submit → IPC `agents:hire-from-ui` → mesma trans do `hire_agent` MCP (reusa código)

#### IPCs novos (todos gravam em `activity_events` via M7.7 helper)

- [ ] `agents:set-mode`
- [ ] `agents:set-always-on`
- [ ] `agents:set-skills`
- [ ] `agents:pause` / `agents:resume`
- [ ] `agents:terminate`
- [ ] `agents:wake-up`
- [ ] `agents:reset-session`
- [ ] `agents:hire-from-ui`

#### Schema & lifecycle

- [ ] **Migration 0008** — `agents.paused_at`, `agents.terminated_at`, `agents.pause_reason` (INTEGER, INTEGER, TEXT NULL)
- [ ] **Status enum** (string col SQLite) aceita `paused` e `terminated`
- [ ] **Router**: ignorar enqueue pra agente paused (mensagens ficam em backlog até resume)
- [ ] **Lifecycle**: terminated → processo killed, row preservada (soft delete), UI esconde de listas default

#### i18n

- [ ] Cada string nova em PT-BR + EN-US — regra dura

#### Não-regressão

- [ ] Segurança (token leak, sandbox escape, fence file)
- [ ] M6.1 smoke test continua passando
- [ ] Token budget non-regression
- [ ] Todos os fluxos M7-C continuam (não quebrar ConfigTab existente)
- [ ] Activity stream recebe N events novos sem regressões em filtros

**Custos:** 4-5 dias. **Pré-req:** M7-C ✅ + M7.7 (`recordActivity` helper).

---

### 🔄 M8 — Costs UI + Token Tracking

**Decisão arquitetural (após Paperclip comparison):**
- Schema `cost_events` (nome novo, drop legacy `costs_log` se vazio) compatível com adapter pattern do M7.5 — cada adapter reporta cost via interface comum `estimateUsage(events)`.
- **Soft-stop at `turn-complete`** (não heartbeat — não temos heartbeat polling). Agente ultrapassou budget → `notify_user(kind=security_alert)` + `agents.status='paused'` + bloqueia próximo `enqueue` no router. ([docs/paperclip-comparison.md §15 M8 lookahead](docs/paperclip-comparison.md))

- [ ] **Backend:**
  - [ ] Schema `cost_events (id, company_id, agent_id, adapter_name, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_cents_estimate, occurred_at)` — adapter-agnóstico
  - [ ] Persistir `result.usage` via `adapter.estimateUsage(events)` por turn
  - [ ] Calcular % do limite Max baseado no rate_limit_event do stream
  - [ ] Aggregations: por agent, por project, por dia, **por adapter** (preparando M10 dual local/remote)
  - [ ] Enforcement at turn-complete: soft-stop quando budget estourar
- [ ] **UI:**
  - [ ] Rota `/costs` com gráficos (recharts ou similar)
  - [ ] Limite Max + progress bar visível
  - [ ] Filtros: agent, project, date range, **adapter**
  - [ ] Widget "Custos hoje" no Dashboard (alimenta o §6.4 Dashboard widget)
  - [ ] Cost hints relativos no model dropdown (M7a) — usar dados reais quando houver, simbólico caso contrário
- [ ] **Não-regressão:** spec §10.3 hard limit ≤1.3x do baseline
- [ ] **Activity events:** `cost.day_summary` (1 row/dia/agente) gravado via `recordActivity` do M7.7 — NÃO per-turn (volume alto)

---

### 🆕 M8.5 — Goals + CEO Planning — **feature além do Paperclip**

**Origem:** [docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md §2](docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md). User cria Goal → clica "Ask CEO to plan" → CEO lê e propõe **plano estruturado** (agents a contratar, issues a criar, estimates de tempo/tokens/custo, riscos) → user aprova em **PR-review UI** → executor atômico cria agents+issues.

**Por que evolução além do Paperclip:** lá Goals são puramente declarativos (CRUD). O CEO-planner automático é nosso diferencial — combina Goals + agentic planning + approval gate.

**Decisão arquitetural:**
- **Entidade separada** `goals` + `goal_plans` (versionado) — NÃO `issues.kind='goal'`. Plano estruturado em JSON permite include/exclude checkboxes, re-propose (v2), edit-before-approve (v2).
- **PR-review approval-style** (humano sempre aprova v1). Auto-execute = v2.
- **Sub-goals + hierarquia** via `parent_goal_id` (igual Paperclip). Cascade explícito = v2.
- **Plan inline-edit** (texto) = v2; v1 só include/exclude.
- **Goal budget** grava `budget_max_tokens` mas enforcement aproveita hook do M8 (não duplica).

#### Schema (Migration M8.5-01, numeração após M8)

- [ ] **`goals`**: id, company_id, title, description, level ('company'|'team'|'agent'|'task'), status ('draft'|'planning'|'proposed'|'approved'|'in_progress'|'achieved'|'cancelled'), parent_goal_id (self-FK), owner_agent_id, budget_max_tokens, deadline, success_criteria, created_at, updated_at
- [ ] **`goal_plans`**: id, goal_id, version, proposed_by_agent_id, summary, agents_to_hire_json, issues_to_create_json, estimated_total_tokens, estimated_duration_days, estimated_cost_cents, risks_json, status ('proposed'|'approved'|'rejected'|'superseded'), user_feedback, proposed_at, decided_at, decided_by
- [ ] **`issues.goal_id`** (FK opcional)
- [ ] Índices: `(company)`, `(parent_goal_id)`, `(status)`, `(goal_id, version)` unique

#### MCP tools novas (5)

- [ ] `list_goals(company_id?, status?)` → Goal[]
- [ ] `get_goal(id)` → Goal + `{current_plan: GoalPlan | null}`
- [ ] `submit_goal_plan(goal_id, plan_data)` → `{plan_id, version}`. Valida via Zod (rejeita index dangling, deps cyclic, model fora dos presets).
- [ ] `update_goal_status(id, status, reason?)` → Goal
- [ ] `record_subgoal(parent_id, ...)` → Goal (atalho — CEO cria sub-goals durante exec)

#### System prompt CEO

- [ ] **Bloco "Goals & Planning"** plug no `composeSystemPrompt` (foundation M7.5):
  - Como ler GOAL_PLAN_REQUEST
  - Como decompor em agents/issues
  - Como estimar custos baseado em histórico (`list_recent_costs` ou similar de M8)
  - Como identificar riscos
  - **NÃO chamar `hire_agent`/`create_issue` diretamente** — só `submit_goal_plan`. Execução fica gated pelo user.

#### Fluxo end-to-end (backend)

- [ ] **Goal created** (`status='draft'`) → sem plano
- [ ] **User clica "Ask CEO to plan"** → status `'planning'` + orchestrator delivery especial pro CEO: system message `"GOAL_PLAN_REQUEST: ..."`
- [ ] **CEO chama `submit_goal_plan`** → INSERT em `goal_plans` v1 + status='proposed' + inbox kind `goal_proposed`
- [ ] **User clica Approve** → executor atômico (better-sqlite3 trans): cria agents (resolvendo `reports_to_index`) + cria issues (resolvendo `assignee` e `depends_on`) + status='in_progress'. CEO recebe confirm message.
- [ ] **User clica Request Changes** → modal text feedback → plan atual status='superseded', goal status='planning', CEO recebe feedback, espera v2
- [ ] **User clica Reject** → goal status='cancelled', plan status='rejected'

#### UI

- [ ] **Rota `/goals`** — tree view recursiva (parent → children), status badges, button "New Goal"
- [ ] **Rota `/goals/:id`** — header (title edit inline, status, level, deadline, owner), description (markdown render+edit), properties panel, tabs:
  - **Plan** — `GoalPlanReview` ou button "Ask CEO to plan"
  - **Sub-goals** — tree de children
  - **Linked issues** — `WHERE goal_id = this`
  - **History** — versões anteriores de plans (superseded/rejected) read-only
- [ ] **`GoalPlanReview` component** — PR-review UI:
  - Summary card (markdown rendered)
  - Agents to hire — lista de cards (avatar/role/model/persona/skills/rationale) com checkbox "include"
  - Issues to create — lista de cards (title/priority/description/assignee/depends-on visual/rationale/estimated_tokens) com checkbox "include"
  - Estimates panel sticky (tokens, USD/BRL via M8 rate, dias, % budget Max)
  - Risks accordion
  - Buttons: `Approve & Execute` / `Request Changes` / `Reject`

#### Inbox kinds novos

- [ ] `goal_proposed` — CEO submeteu plano (actionable)
- [ ] `goal_executing` — user aprovou, execução começou (auto-archive 24h ou status='in_progress')
- [ ] `goal_blocked` — execução falhou parcialmente (rollback)

#### Activity events novos (consume M7.7 helper)

- [ ] `goal.created`, `goal.plan_proposed`, `goal.plan_approved`, `goal.plan_rejected`, `goal.status_changed`, `goal.cancelled`

#### Erros & edge cases

- [ ] **Executor parcial:** trans atômica resolve. Rollback completo + inbox `goal_blocked` com detail.
- [ ] **`submit_goal_plan` sem GOAL_PLAN_REQUEST:** tool valida `goal.status='planning'` antes. Erro se diferente.
- [ ] **Sub-goal com parent cancelled:** v1 não cascateia (warning UI). v2 cascade.
- [ ] **Plan version > 1:** versão anterior `superseded`, history tab mostra. Não deleta.

#### Testes

- [ ] Unit: schema validation Zod do plan payload (exhaustive cases)
- [ ] Unit: resolver de `reports_to_index` e `depends_on_indexes`
- [ ] Integration: GOAL_PLAN_REQUEST → CEO turn → `submit_goal_plan` → DB row
- [ ] Integration: approve flow → agents+issues criados atomic
- [ ] Integration: request-changes flow → versão nova
- [ ] Integration: rollback em partial failure
- [ ] E2E (Playwright): user cria goal → ask CEO → approve → vê agents na sidebar + issues no kanban

#### Não-regressão

- [ ] M7.6 actions continuam funcionando
- [ ] M8 cost tracking não regride
- [ ] Tudo dos M1-M7 continua

**Custos:** 10-12 dias. **Pré-req:** M8 (forte, estimates reais), M7.5 (médio, system prompt composable), M7.6 (médio, `agents:hire-from-ui` reusado pelo executor), M7.7 (logs do fluxo de plan).

---

### 🔄 M9 — Dashboard + Multi-empresa + Polish + Reviews UX + API key (2º adapter)

Closing items pra v1 ficar feature-complete contra spec §4. **Aproveita foundation do M7.5** (adapter pattern, approvals decoupled, system prompt composable).

- [ ] **Dashboard widgets:** (consume Activity stream do M7.7)
  - [ ] Agentes Ativos (count + lista mini)
  - [ ] Issues em Andamento (count Doing+Review por project)
  - [ ] Inbox unread (count + último item)
  - [ ] Custos Hoje (tokens + % Max — alimenta de M8)
  - [ ] **Recent Activity** (últimos 10 eventos de `activity_events` com fade-in animation)
  - [ ] **Active Agents Panel** (per-agent status com `currentAction` granular do M7.5)
- [ ] **Multi-empresa:**
  - [ ] Dropdown topo da sidebar pra trocar de company
  - [ ] Criar nova empresa (modal com nome)
  - [ ] Deletar empresa (confirm + cascade DELETE)
  - [ ] Active company persistido em settings
- [ ] **/agents (lista, não detail):**
  - [ ] Cards com avatar + nome + role + status
  - [ ] Botão "+" com galeria de role_templates
- [ ] **Right panel em /agents/:id:**
  - [ ] Persona (system_prompt edit-in-place)
  - [ ] Skills (cross-link com M7)
  - [ ] Allowed projects (cross-link com M6)
  - [ ] Issues atribuídas
  - [ ] Stats (tokens consumidos, turns, etc)
- [ ] **Settings:**
  - [ ] Defaults de mode (`supervised`/`auto`)
  - [ ] Defaults de `always_on`
  - [ ] Banner global pra OAuth token expiring (30d antes)
- [ ] **Suporte a API key (2º adapter `claude-api-key-local`)** — dual auth via adapter pattern do M7.5:
  - [ ] Setup wizard: pergunta auth source (OAuth Max recomendado / API key)
  - [ ] Settings: switch entre OAuth Max e API key (com warning sobre custo: API key cobra por token, OAuth Max é flat-rate)
  - [ ] `auth-mode.ts` (criado em M7.5) passa a retornar `'oauth' | 'api-key'` baseado no settings
  - [ ] Storage: `safeStorage.encrypt(apiKey)` igual padrão do OAuth M2; `auth:api-key-set` IPC
  - [ ] **Novo adapter impl** `claude-api-key-local` em `apps/main/src/orchestrator/adapters/`: estende `claude-oauth-local` mas passa `ANTHROPIC_API_KEY` env var em vez de copiar `.credentials.json`. `--strict-mcp-config` continua ativo (não depende de OAuth).
  - [ ] Limite dos 4 agentes simultâneos: aplicar SÓ pra OAuth Max (ToS Anthropic). Com API key, limite vira o rate limit normal da conta
  - [ ] Documentar em SECURITY.md as 2 modes + trade-offs
  - [ ] Memory `project_dashboardagent` precisa atualização (premissa OAuth-only deixa de ser exclusiva)
- [ ] **Error handling (spec §7):**
  - [ ] Banner global vermelho quando OAuth inválido
  - [ ] Auto-restart do main em crash + 5s timeout
  - [ ] Backoff exponencial em rate limit + banner amarelo
  - [ ] Heartbeat do agente (5min timeout → status='error' + inbox + restart button)
- [ ] **AGENTS.md configurations** (Paperclip wishlist):
  - [ ] Suporte a `<workspaceCwd>/AGENTS.md` no formato declarativo (front-matter YAML + lista de agents)
  - [ ] Settings UI: "Import from AGENTS.md" — parseia, lista preview, click "Hire all" cria os agents
  - [ ] Reverso: "Export AGENTS.md" gera o arquivo a partir dos agents da company atual
- [ ] **companies.sh import/export** (Paperclip wishlist):
  - [ ] Settings UI: botão "Export company..." — gera JSON com agents + threads + messages + inbox + projects + issues + costs_log da company selecionada
  - [ ] Settings UI: botão "Import company..." — file picker, valida shape, INSERT cascade
  - [ ] Caso de uso: backup, snapshot pré-experimento, share entre instalações
- [ ] **Agent Reviews UX polish** (Paperclip wishlist + spec §6.4) — aproveita `approvals` decoupled do M7.5:
  - [ ] Em `/issues/:id`: aba "Review" com diff/output do agent assignee, botões Approve+merge / Request changes / Reject
  - [ ] Diff side-by-side via `react-diff-viewer-continued` (battle-tested)
  - [ ] Inline comments no diff (linka a `approval_comments` ou similar)
  - [ ] Status="review" já existe no M6 — esse milestone polish UX + plug no `approvals` schema
- [ ] **Right panel `/agents/:id`** — ✅ entregue M7-C + completion em M7.6 (header + ações + faltantes)
- [ ] **AGENTS.md formato próprio (YAML front-matter)** — `gray-matter` parser:
  ```yaml
  ---
  company: Acme
  projects: [{name: backend, path: ./apps/backend}]
  agents:
    - {name: CEO, role: orchestrator, model: claude-opus-4-7, skills: [planning]}
    - {name: BackendEng, role: engineer, reports_to: CEO, projects: [backend]}
  ---
  # texto humano-livre depois
  ```
- [ ] **Project icons + status (archived vs active)** — pequeno, polish
- [ ] **Token expiry banner** (OAuth Max 30d antes) — já listado, mantém

---

### 🆕 M10 — VPS Docker Remote Adapter — **fecha v1 com hybrid distribution**

**Origem:** decisão de 2026-05-11 — distribuição hybrid. Implementa o terceiro adapter `claude-oauth-remote-docker` (e variante `claude-api-key-remote-docker`) usando a foundation do M7.5. Usuário escolhe per-agent: "Run on: local | VPS-default | custom-vps-N".

**Por que existe:** isolamento real de processo (rm -rf no container não afeta seu host), agente sempre-ligado mesmo com PC desligado, acesso 24/7 com lifecycle previsível. Mantém Electron como UI principal (não vira web app — Out-of-scope discutido).

**Modelo de threat reforçado:** mantém blocklist do `gate.ts` mesmo após isolamento. Defense-in-depth (lição comparison §8).

#### Backend (apps/main)

- [ ] **Novo adapter impl** `claude-oauth-remote-docker` em `apps/main/src/orchestrator/adapters/remote-docker.ts`:
  - Implementa `AgentAdapter` interface (M7.5)
  - Substitui `spawn` local por chamada HTTPS+WSS ao agent-runner remoto
  - Wire protocol: definido em M7.5 (`docs/m10-adapter-wire-protocol.md`)
  - Streams stdout/stderr via WSS frames
  - Reconnect automático em conexão caída (com backoff exponencial)
- [ ] **Settings UI: gerenciador de VPS** — `/settings/vps`:
  - Lista VPS configuradas com health check
  - Add VPS: form com host, port, label, chave SSH/JWT, TLS cert fingerprint
  - Test connection: ping + valida cert + verifica versão do agent-runner remoto
  - Remove VPS (warning se houver agentes ativos)
- [ ] **Per-agent dropdown "Run on"**: local | vps-1 | vps-2 | … (chip no `/agents/:id` right panel)
- [ ] **Agent-side state**: nova coluna `agents.adapter_name TEXT NOT NULL DEFAULT 'claude-oauth-local'`. Migration 0008.
- [ ] **Audit log centralizado**: tabela `vps_audit_events (id, vps_label, agent_id, kind, payload, occurred_at)`. Toda chamada a tool no remoto é loggada.

#### VPS side (infra/)

- [ ] **`infra/docker/agent-runner/Dockerfile`** — preencher o stub do M7.5:
  - Base: `node:22-alpine`
  - Install: `claude-code` CLI + nosso bridge MCP server
  - Multi-stage build (build small, runtime smaller)
  - Healthcheck endpoint `/health`
  - User não-root (UID 1000)
- [ ] **`infra/docker/agent-runner/entrypoint.sh`**:
  - Valida JWT recebido via env
  - Inicia bridge server (WSS) em port configurável
  - Por turn: spawna claude CLI subprocess (mesmo pattern do local)
- [ ] **`infra/docker/compose.yml`** — orquestração completa:
  - N réplicas do agent-runner (default 4, alinhado com ToS OAuth Max)
  - Reverse proxy (Caddy auto-TLS via Let's Encrypt)
  - Volume mounts: `/workspace` (project paths) + `/agent-config` (CLAUDE_CONFIG_DIR isolado per-replica)
  - Network: só HTTPS bind exterior + Anthropic API outbound (allowlist)
  - Sem outras saídas de rede
- [ ] **`infra/deploy/`** — scripts de provisioning:
  - `provision-hetzner.sh` (provider neutro pode evoluir)
  - `provision-digitalocean.sh`
  - Variáveis: domain, email Let's Encrypt, JWT secret, port range
- [ ] **`infra/docker/mcp-bridge/`** — server bridge que conecta agent-runner remoto ao nosso main:
  - Recebe WSS do main
  - Encaminha pra claude CLI local no container
  - Reencaminha tool calls MCP back pra main via WSS (não diretamente — main mantém DB)

#### Security

- [ ] **TLS obrigatório** — cert validation, sem fallback HTTP. Cert fingerprint pinning.
- [ ] **JWT signed pelo main pra cada turn** (short TTL, replay-protected via nonce)
- [ ] **Auth da VPS**: SSH key pra deploy; JWT pra runtime
- [ ] **Allowlist de IPs** no agent-runner: só IPs configurados podem conectar (paranoia layer)
- [ ] **Container ephemeral entre runs sensitive**: workspace persiste por design (git worktree), mas CLAUDE_CONFIG_DIR é limpo a cada `spawn` (igual padrão local do M3 lesson)
- [ ] **safeStorage guarda chave SSH e cert fingerprint** (lição M4 SEC-01 — nunca exposto ao renderer)
- [ ] **Audit log per turn**: cada tool call no remoto → `vps_audit_events`. Surfaces em `/agents/:id` "Activity Log" panel.
- [ ] **Rate limit per VPS**: max N requests/sec, prevent burst attacks
- [ ] **`docs/security/vps-threat-model.md`**: documento formal — o que mudou com adapter remoto, ameaças mitigadas, ameaças residuais

#### UX

- [ ] **Dashboard widget**: "VPS health" (latência, agentes ativos, CPU/RAM da VPS via /health)
- [ ] **Per-agent indicator**: ícone "remote on vps-1" vs "local" no sidebar + agent page
- [ ] **Onboarding flow**: "Connect to VPS" wizard (5 passos):
  1. Você já tem uma VPS provisionada? (sim/não — se não, link pra docs/vps-deployment.md)
  2. Cole hostname e porta
  3. Cole chave SSH (test connect)
  4. Trust cert fingerprint (mostra hash, user confirma)
  5. Done — primeira health check + spawn de agente teste
- [ ] **Indicador de connection state** no header: 🟢 connected | 🟡 degraded | 🔴 disconnected

#### Documentação

- [ ] **`docs/vps-deployment.md`** — guia completo (provider neutro):
  - Pré-requisitos (VPS Linux, Docker, domínio)
  - Steps: clone infra/, edit .env, run provision script, point DNS, run compose up
  - Operations: backup, update, monitor logs
- [ ] **`docs/security/vps-threat-model.md`** — o que mudou com adapter remoto
- [ ] **`SECURITY.md`** atualizado (foundation já em M7.5; M10 completa)

#### Tests

- [ ] **E2E cycle local + remote** mistos numa só company:
  - 4 agentes: 2 local, 2 remote
  - Mensagens cross-adapter funcionam
  - Permission gate trigger correto no local + remote
- [ ] **Connection drop test**: kill agent-runner mid-turn, valida reconnect + recovery
- [ ] **Security test**: JWT replay tentativa falha; cert MITM falha; outbound network forbidden funciona

#### Não-regressão

- [ ] Tudo dos M1-M9 continua funcionando (local default)
- [ ] Memory `project_dashboardagent` atualizar premissa local-only (agora é "default local, opcional remote")
- [ ] Memory `feedback_security_priority` reforça: blocklist mantida mesmo com isolamento de container

---

## Débito técnico de M5 (movidos pra v2 ou M-future)

Listados aqui pra não esquecer. Memorias têm contexto.

- [ ] **Auto mode 24h timer** (§8.4) — agente em auto sem interação humana volta pra supervised
- [ ] **Auto degradado para Bash** toggle (§8.4) — em auto ainda confirma Bash
- [ ] **Anti-prompt-injection avançado** (§8.6) — heurística estática + diff suspeito + tool call rate
- [ ] **File watcher de `~/.claude/projects/`** (§5.1 D10) — observar sessões claude iniciadas fora do dashboard
- [ ] **Tray icon completo** — sobrevive janela fechada, com submenu de quick-actions
- [ ] **Scopes de auto** (§5.5 v2) — "auto pra Read, supervised pra Bash"
- [ ] **Approval gate pra MCP orchestration tools** (re-introduzir se feedback do usuário pedir) — mover do `permissions.allow` pra `permissions.ask` no settings.json sandbox
- [ ] **junction table `thread_participants(thread_id, agent_id)`** — substitui o `LIKE %agentId%` em participants_json (M5 lesson)
- [ ] **Backup automático diário do DB** (§7) + restore via Settings
- [ ] **CSP restritivo no renderer** (§8.7) — auditoria pendente
- [ ] **`--strict-permissions` ou equivalente** se Claude Code adicionar

---

## Pre-public-push checklist

Status: repo é local (sem `git remote`). Quando virar público, executar:

- [ ] Confirmar `git config user.email` local do repo é noreply (não global do user)
- [ ] Deletar branch `pre-filter-repo-backup` (snapshot pré-rewrite contém email pessoal)
- [ ] `gitleaks detect` num pass final
- [ ] Decidir: branch `m5-multi-agent-orchestration` deletar local? (já mergeada)
- [ ] `git reflog expire --expire=now --all && git gc --prune=now --aggressive` (paranoia level)

Detalhes em [project_repo_will_be_public.md](memory).

---

## Paperclip wishlist tracker

Mapeamento de cada item da wishlist do [Paperclip](https://github.com/paperclipai/paperclip) com nosso status. **Nem tudo do Paperclip é desejado pra nós** — alguns explicitamente fora de escopo. Decisões detalhadas em [docs/paperclip-comparison.md](docs/paperclip-comparison.md).

| Item Paperclip | Status nosso | Onde |
|---|---|---|
| **Desktop App** | ✅ Pronto | M1 (Electron) |
| **CEO Chat** | ✅ Pronto | M3 (chat 1-1) + M5 (multi-agente real) |
| **Org chart hierarchy** | ✅ Pronto | M7-C — SVG handcrafted client-side + drag-to-reassign + anti-cycle |
| **Skills Manager** | ✅ Pronto (read-only) | M7-B — UI cards + hard-gate via `--allowedTools`. Edit per-agent: M7.6. **Não imitar code-module/source-sync** (fora do threat model) |
| **Agent config UI (model/persona/projects)** | ✅ Pronto | M7-C right panel — edit inline com debounced save |
| **Pause/Terminate/Assign Task** | 🆕 Planejado | M7.6 — header de ações em `/agents/:id` |
| **Form de criar agente direto pela UI** | 🆕 Planejado | M7.6 — `/agents/new` paralelo ao `hire_agent` MCP |
| **Activity stream (`/activity` cross-cutting)** | 🆕 Planejado | M7.7 — `activity_events` table + página + helper central. **Diferencial nosso:** dual-write com `issue_events`/`inbox` (não migrar dados) |
| **Better Budgeting** | 🔄 Planejado | M8 (token tracking + % Max + por agente/projeto/adapter) |
| **Goals + CEO planning automático** | 🆕 Planejado | **M8.5 — evolução além do Paperclip.** Lá goals são declarativos; nosso CEO **propõe plano completo** (agents+issues+estimates+riscos) → user aprova em PR-review |
| **Cloud / Sandbox agents** | 🟡 Parcial v1 + v2 | **M10 absorve parte**: VPS Docker remote adapter. v2 adiciona Cursor, Codex, e2b providers |
| **Easy AGENTS.md configurations** | 🔄 M9 | Format próprio (YAML front-matter) com `gray-matter` parser |
| **companies.sh — import/export** | 🔄 M9 | JSON único (não ZIP) — DB menor que Paperclip |
| **Agent Reviews and Approvals** | 🔄 M7.5 + M9 | M7.5: schema `approvals` decoupled. M9: PR-style diff side-by-side + inline comments |
| **Work Products / Artifacts** | 🔄 M7.5 | Tabela `issue_artifacts` (kind: file_path, commit_sha, pr_url, snapshot) |
| **Issue identifier humano** (`PRJ-123`) | 🔄 M7.5 | Migration 0004 — UX win trivial |
| **Dashboard rico** (Recent Activity + Active Agents + Metric Cards) | 🔄 M9 | Consome `activity_events` do M7.7 |
| **Runs timeline por agente** | 🆕 Planejado | M7.6 — modal full-screen derivado de `messages` |
| **Scheduled Routines** | 🆕 v2+ | Routines — cron-like recurring tasks |
| **Plugin system** | 🆕 v2+ | Knowledge base / custom tracing / queues como sub-features. Big architectural change |
| **Get OpenClaw / claw-style agent employees** | 🆕 v2+ | Marketplace/template-store de agent personas (extensão do `role_templates`) |
| **Memory / Knowledge** | 🆕 v2+ | Knowledge base por agente (RAG-style). Vector DB ou sqlite-vss |
| **Enforced Outcomes** | 🆕 v2+ | Garantia de "tests passam", "compile OK" antes de marcar issue=done |
| **Deep Planning** | 🆕 v2+ | Plan-mode estendido (claude já tem `--permission-mode plan`) |
| **MAXIMIZER MODE** | 🆕 v2+ | Aggressive auto mode — requer API key opcional (Max não cobre) |
| **Work Queues** | 🆕 v2+ | Queue-based task processing (distinto de issues). Aproveita router FIFO |
| **Plan inline-edit (texto)** antes de approve | 🆕 v2 | M8.5 v1 só include/exclude. Edit texto = v2 |
| **CEO auto-approve goal plans** | 🆕 v2 | M8.5 v1 sempre humano aprova. Auto-mode = v2 |
| **Self-Organization** | 🆕 v3+ | Agentes reorganizando hierarquia entre si dinamicamente |
| **Automatic Organizational Learning** | 🆕 v3+ | Meta-feature: agentes aprendem de history |
| **Activity full-text search (FTS5)** | 🆕 v2 | M7.7 v1 client-side filter. FTS5 só se base passar 10k events |
| **Skill source sync** (GitHub/NPM download) | ❌ Out-of-scope | Threat model: download/execução de código remoto. Memory `feedback_security_priority` |
| **Plugin sandbox providers** (e2b, Cloudflare, Daytona) | ❌ v3+ | Adapter remoto Docker do M10 já entrega isolamento. Outros providers só se feedback pedir |
| **Multiple Human Users** | ❌ Out-of-scope | Single-user explícito por ToS Anthropic Max |
| **Cloud deployments (UI na cloud)** | ❌ Out-of-scope | Mantemos Electron desktop como UI. **Hybrid VPS via M10** cobre o "agente na cloud" sem virar web app |
| **Embedded Postgres** | ❌ Não fazer | sqlite serve perfeitamente desktop. Custaria semanas e zero valor |
| **Plugin event mapping** (activity → plugin bus) | ❌ Out-of-scope | Sem plugin system v1 |
| **Username redaction em logs** | ❌ Out-of-scope | Single-user; sem usernames terceiros pra esconder |
| **Instructions com file tree** (múltiplos arquivos) | ❌ V2 | M7.6 MVP é single markdown |
| **Goal templates / wizards** | ❌ V2 | M8.5 form vazio |
| **Sub-goal cascading** (cancel parent → cascade children) | ❌ V2 | M8.5 v1 warning UI |

**Como decidir incluir ou não no v1:**
- Item marca o produto como "diferenciado" do CEO Chat puro? → considerar pra v1
- Item é pré-requisito pra outra feature já planejada? → mover pra milestone correspondente
- Item é nice-to-have sem alterar core flow? → v2+
- Item exige threat model novo (download remoto, multi-user)? → out-of-scope explícito

---

## v2+ (fora do v1)

Tudo daqui pra baixo é post-v1. Organizado por tema. Origens marcadas com [PC] = Paperclip comparison, [M5] = débito M5, [novo] = nasce aqui.

### Multi-agente avançado

- **Routines** [PC] — tasks recorrentes (cron-like) atribuídas a agentes
- ~~**Goals** [PC]~~ — **movido pra v1 M8.5** (Goals + CEO planning automático)
- **Goal v2 extensions** [PC + novo] — plan inline-edit (texto), CEO auto-approve mode, goal templates/wizards, sub-goal cascading
- **Issue relations** [PC] — depends_on / related_to / blocks
- **Issue monitors** [PC] — auto-recheck em schedule
- **`issue.kind`** [PC] — task | review | spike (reduzir overload do status)
- **Work Queues** [PC] — continuous-stream task processing (distinto de issues)
- **Self-Organization** [PC] — agentes reorganizam hierarquia entre si
- **Automatic Organizational Learning** [PC] — meta-learning cross-agent
- **Deep Planning mode** [PC] — plan-then-execute ritual com aprovação intermediária
- **MAXIMIZER MODE** [PC] — aggressive auto mode (requer API key)

### Adapter ecosystem (extensão do M7.5+M10)

- **Suporte a outros agents** [PC] — Cursor, Codex, OpenClaw, Gemini, custom CLI/HTTP. Cada um vira `AgentAdapter` impl.
- **OpenClaw-style template marketplace** [PC] — agent personas compartilhados
- **Plugin sandbox providers** [PC] — e2b, Cloudflare, Daytona como adapters além do nosso Docker. Só se feedback pedir.

### Plugin system

- **Plugin system** [PC] — knowledge base, tracing, queues como sub-features. Big architectural change. SDK + worker isolation (estilo Paperclip mas magrinho).
- **Plugin webhooks** — outbound HTTP

### Knowledge / Artifacts

- **Memory / Knowledge base** [PC] — RAG por agente (sqlite-vss ou vector DB externo)
- **Artifacts ricos** [novo] — extensão de `issue_artifacts` (M7.5) pra incluir snapshots de filesystem, diffs anotados, métricas
- **Enforced Outcomes** [PC] — garantias pré-merge (tests/build) antes de marcar issue=done
- **Activity Log audit-grade** [novo] — log estruturado de tudo que cada agente fez (cross-cuts M10 vps_audit_events)

### Refactors estruturais (continuação do M7.5)

- **Junction table `thread_participants`** [M5] — substitui `LIKE %agentId%`. Quando dor aparecer.
- **Type-safe prepared statements** [PC] — adotar Kysely OU manter SQL raw + testes integração
- **Path tokenization via `shell-quote`** [PC] — substituir tokenizer artesanal em `gate.ts`
- **Execution workspace per issue** [PC] — git worktree por execução pra evitar conflito de escrita simultânea

### Sandbox / Security avançado

- **Anti-prompt-injection avançado** [M5] — heurística estática + diff suspeito + tool call rate
- **Auto mode 24h timer** [M5] — agente em auto sem interação humana volta pra supervised
- **Auto degradado para Bash toggle** [M5] — em auto ainda confirma Bash
- **Scopes de auto** [M5] — "auto pra Read, supervised pra Bash"
- **CSP restritivo no renderer** [M5] — auditoria pendente
- **`--strict-permissions`** [M5] — adotar se Claude Code adicionar

### Inbox / Notifications / Activity

- **Pagination da inbox** [PC] — quando crescer >1000 itens
- **Archive de inbox/issues** [novo] — soft-delete + restore
- **Activity FTS5** [PC + novo] — full-text search nativo SQLite. Só se base passar 10k events; client-side filter cobre v1.
- **Activity archiving / TTL** [novo] — quando passar 100k events, archive ou TTL.
- **Global Cmd+K bar** [novo] — search cross-entity (activities + issues + messages + agents). Lib `cmdk`.
- **Plugin event mapping** [PC] — activity dispara plugin bus quando plugin system entrar (v2+)

### UX polish

- **Tray icon completo** [M5] — submenu de quick-actions + badge
- **"New Issue" hotkey global** [novo] — atalho de teclado mesmo com app não focado
- **Project icons + nested projects** [PC] — se feedback pedir
- **Skill source sync** [PC] — só se feedback pedir (cuidado threat model)

### Infra / Distribuição

- **Backup automático diário do DB** [M5] + restore via Settings
- **File watcher de `~/.claude/projects/`** [M5] — observar sessões claude iniciadas fora do dashboard
- **Auto-update via rede** com signatura/notarização
- **Telemetria opcional** (default OFF, opt-in, sem conteúdo de mensagens)
- **VPS multi-region / failover** [novo, decorre do M10] — se single VPS não basta

---

## Como atualizar esse roadmap

Após cada milestone fechado / feature mergeada:

1. Mover items de `🔄` ou `❌` pra `[x]` na seção **Milestones fechados**
2. Atualizar **Status atual** (commits, testes, LoC)
3. Atualizar **v1 scope tracker** (status do módulo)
4. Mover débito identificado durante implementação pra **Débito técnico**
5. Atualizar **Última atualização** no topo
6. Commitar com `docs(roadmap): close MX — <feature>`

Antes de iniciar próxima feature: consultar **Paperclip** (memory `reference_paperclip`) pra inspiração de UX/código.
