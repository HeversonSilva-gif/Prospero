# DashboardAgent — Roadmap

> Living doc. Atualizar a cada feature/fix mergeado em `master`.
>
> **Spec base:** [docs/superpowers/specs/2026-05-09-dashboard-agent-design.md](docs/superpowers/specs/2026-05-09-dashboard-agent-design.md)
> **Referência ativa de UX/código:** [Paperclip](https://github.com/paperclipai/paperclip) — clone funcional via OAuth Max em vez de API key
> **Comparação técnica:** [docs/paperclip-comparison.md](docs/paperclip-comparison.md) — origem dos itens em M7.5 e V2
> **Última atualização:** 2026-05-11 (M7-A PR-A mergeado — `0caa31b`; M7-B PR-B mergeado — `8e8efc7`; **M7-C PR-C mergeado — `8b03792`**; M7 fechado; M7.5 + M10 adicionados após comparação com Paperclip e decisão de hybrid VPS)
>
> **Distribuição (decisão 2026-05-11):** **hybrid** — Electron desktop continua como default e UI. Adapter pattern (M7.5 foundation, M9 API key, **M10 VPS Docker**) permite spawnar agentes localmente OU em containers Docker numa VPS remota. Usuário escolhe per-agent (CEO local pra latência, engenheiros remotos pra isolamento). Sem rewrite — adapter pattern absorve o segundo lifecycle.

## Status atual

| Métrica | Valor |
|---|---|
| Milestones fechados | M1, M2, M3, M4, M5, M6 (6/10 do v1 atualizado: +M7.5 +M10) |
| Em curso | — (M7 fechado · próximo: M7.5 adapter foundation) |
| Milestones fechados (atualizado) | M1, M2, M3, M4, M5, M6, **M7** |
| Testes | 260 passing, 46 test files, 0 lint/typecheck errors |
| Commits no master | ~125 |
| LoC (apps + packages) | ~13k TS/TSX |
| Stack | Electron 33 · React 18 · Vite · Tailwind · zustand · better-sqlite3 (WAL) · MCP SDK · vitest |
| Distribuição planejada | Hybrid: desktop default + VPS Docker remote opcional (M10) |

---

## v1 scope tracker (spec §4)

Status por **módulo** funcional do produto. Cada módulo pode estar em vários estados parciais entre milestones.

| Módulo | Status | Notas |
|---|---|---|
| **Multi-empresa** | 🟡 Parcial | Backend pronto (`companies` table, `company:create-demo` IPC). UI: dropdown topo da sidebar pra trocar entre empresas **AINDA NÃO**. Sidebar mostra a primeira company por default. |
| **Dashboard** | 🟡 Stub | Rota `/dashboard` existe (placeholder M2). 4 widgets do spec §6.4 (Agentes Ativos, Issues, Inbox, Custos hoje) **NÃO** implementados. |
| **Inbox** | ✅ Completo | Rota `/inbox` com filter pills (All/Approvals/Completed/Suggestions/Errors/Security). Approve/Reject inline pra approval items. Auto-mark-read no resolve. Badge unread no sidebar. |
| **Issues** | ✅ Completo | MCP tools (create/update/assign/list/check_status) reais. Kanban /issues com 5 colunas + drag-drop. Modal de detail com comments + sub-tasks + tool history. Auto-allow consistente com M5. |
| **Projects** | ✅ Completo | Rota /projects master/detail com folder picker + color picker. Auto-cria 'Default Workspace' migration do workspaceCwd legado. Allowlist per agent via chip toggle. |
| **Agents** | 🟡 Parcial | Sidebar lista todos com status colors. Rota `/agents/:id` chat 1-1 com unified cross-thread stream. Rota lista `/agents` com galeria de templates **NÃO** implementada. Right panel (persona/skills/projetos/issues/stats) **NÃO**. |
| **Org Chart** | ✅ Completo | Rota `/org` SVG handcrafted vertical tree + click drawer + drag-to-reassign + confirm modal + anti-cycle (backend + UI toast). |
| **Skills** | ❌ Não iniciado | Tabelas `skills_catalog` + `role_templates` existem com seed. Rota `/skills` zerada. Coluna `agents.skills_json` existe mas não tem UI pra editar. |
| **Costs** | ❌ Não iniciado | Tabela `costs_log` existe. Tracking automático de tokens ainda **NÃO** liga (claude `result.usage` não persistido). Rota `/costs` zerada. |
| **Settings** | ✅ Completo | OAuth token (manual + auto-detect M2), language, theme. Workspace folder picker removido (link pra /projects). Defaults de mode/always_on **NÃO** UI ainda — só DB defaults. |

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

## Pendências da v1 (próximos milestones)

Sequência sugerida — pode ser ajustada. **Antes de cada um, consultar Paperclip** (`reference_paperclip` memory) pra UX/código.

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

### 🆕 M7.5 — Foundations & Paperclip Refactors

**Origem:** itens 🔴 (alta prioridade) e parte dos 🟡 da [Paperclip comparison](docs/paperclip-comparison.md). Refatorações estruturais e melhorias UX/governança que preparam M8/M9/M10 — especialmente o **adapter pattern**, que é pré-requisito do API key (M9) e do VPS Docker remote (M10).

**Por que existe:** sem essa pausa de foundation, M8/M9/M10 vão inflar `lifecycle.ts` (já 383 linhas) e `mcp/tools.ts` (502 linhas) até virarem o `heartbeat.ts` do Paperclip (9.8K linhas). Custo total estimado: ~2 semanas.

#### Refactors estruturais (prep para próximos milestones)

- [ ] **Modularizar `apps/main/src/orchestrator/lifecycle.ts`** — extrair `buildClaudeArgs`, `prepareSandbox`, `resolveBinary`, `mcpHandshake` em arquivos próprios. (~2h)
- [ ] **Modularizar `apps/main/src/mcp/tools.ts`** — 1 arquivo por domínio: `tools/agents.ts`, `tools/issues.ts`, `tools/messages.ts`, `tools/permissions.ts`. Cada tool exporta schema Zod + handler. (~2h)
- [ ] **PREAMBLE em arquivo `.md`** — mover `apps/main/src/orchestrator/system-prompt.ts` PREAMBLE pra `apps/main/src/orchestrator/preamble.md`, lido com `fs.readFileSync`. Iterar prompt sem recompilar Electron. Bonus: usuário pode override via `~/.dashboard-agent/preamble.md`. (~30 min)
- [ ] **System prompt composable** — builder `composeSystemPrompt({preamble, role, skills[], model})` em vez de string concat. Necessário pra skills M7 + model-specific tuning. (~4h)

#### 🔧 Adapter pattern foundation (**critical path para M9 + M10**)

- [ ] **Interface `AgentAdapter`** em `packages/shared/src/types/adapter.ts`:
  ```ts
  interface AgentAdapter {
    name: 'claude-oauth-local' | 'claude-api-key-local' | 'claude-oauth-remote-docker' | future;
    buildArgs(agent, env): string[];
    spawn(opts): AgentRunnerHandle;
    parseStream(line): ParsedEvent | null;
    estimateUsage(events): { input, output, cache_read, cache_creation };
  }
  ```
- [ ] **Refatorar `lifecycle.ts`** pra usar `claude-oauth-local` como primeiro impl. Comportamento idêntico ao de hoje, só estrutura nova.
- [ ] **Registry**: `apps/main/src/orchestrator/adapters/index.ts` exporta map `{name: AdapterImpl}`. M9 adiciona segundo impl; M10 adiciona terceiro.
- [ ] **Testes**: garantir 100% de não-regressão (suíte existente roda igual).

#### Schema & DB

- [ ] **Migration 0004 — `issues.identifier` humano (`PRJ-123`)**:
  - Coluna `issues.issue_number INTEGER NOT NULL`
  - Coluna `issues.identifier TEXT NOT NULL` (gerada: `{project.slug}-{issue_number}`)
  - Index único `(project_id, issue_number)`
  - Counter no `issues.create()` (max + 1 atômico por project)
  - Display em todo log/UI/MCP message ("agente assigned to BACKEND-7" vs UUID)
- [ ] **Migration 0005 — `messages.kind`**:
  - Coluna `messages.kind TEXT NOT NULL DEFAULT 'message'`
  - Enum: `message | proposal | question | confirmation | observation`
  - System prompt instrui agentes a usar `kind=question` quando esperam resposta, `kind=confirmation` ao fechar algo
  - UI: badge visual diferenciando proposta vs message comum
  - Heuristic anti-stuck: question pendente sem confirmation há > N turns → inbox suggestion
- [ ] **Migration 0006 — `approvals` decoupled do `inbox`**:
  - Nova tabela `approvals (id, agent_id, kind, payload_json, status, decided_by, decision_note, created_at, resolved_at)`
  - Kinds: `tool_call | code_review | hire_confirm | budget_override | …`
  - `inbox.payload_json` passa a referenciar `approval_id`
  - Prep pra Reviews UX em M9 (PR-style approval com diff + comments inline)
- [ ] **Migration 0007 — `issue_artifacts`** (work products):
  - Tabela `issue_artifacts (id, issue_id, kind, ref, content_preview, created_at, created_by)`
  - Kinds: `file_path | commit_sha | pr_url | snapshot | output_text`
  - MCP tool `record_artifact(issue_id, kind, ref, preview?)` chamada antes de `update_issue status=done`
  - UI: accordion no IssueDetailModal "Artifacts" exibe deliverables

#### Auth foundation (prep M9 dual auth)

- [ ] **`apps/main/src/auth/auth-mode.ts`** — função `getActiveAuthMode(): 'oauth' | 'api-key'` retornando só `'oauth'` por ora. Centraliza decisão pra M9 plugar API key sem espalhar if-else.

#### UX & Polish

- [ ] **Current action granular** — refletir tool calls em UI sidebar/agent page. Em vez de status binário "working", mostrar "Editing src/foo.ts" / "Running pytest" / "Waiting for permission". Dados já existem in-memory (router + stream-parser). (~1 dia)
- [ ] **WebSocket-like granular IPC events** — refatorar broadcast roster (lição M5) de snapshot completo pra deltas tipados. Discriminated union por kind. Reduz churn no renderer. (~1 dia)

#### Testes

- [ ] **E2E mínimo com Playwright + Electron** — `@playwright/test` + `electron-playwright-helpers`. Cenários:
  - Onboarding (setup wizard com token detectado)
  - Hire agent → send message → receive response
  - Create issue → assign → status transitions
- [ ] **Cobertura de orchestrator + MCP tools** — mocking de claude CLI (stream stdin/stdout). Cabe entre M7 e M8.
- [ ] **Snapshot tests da blocklist** — se um pattern muda, falhar.

#### Security

- [ ] **SECURITY.md atualizado** — incluir threat model do **adapter remoto** que vem em M10. Documentar:
  - Por que mantemos blocklist mesmo após adapter remoto chegar (defense-in-depth)
  - Diferença de threat model: local agent (filtra comando) vs remote agent (isolamento de processo + filtra comando)
- [ ] **Decisão consciente registrada**: blocklist `§8.3` continua sendo regra dura no `gate.ts` mesmo quando o adapter remoto isolar processo.

#### VPS prep (não implementa ainda, prepara terreno)

- [ ] **`infra/docker/agent-runner/Dockerfile` stub** — placeholder com `FROM node:22-alpine` + comment do plano. M10 preenche.
- [ ] **`infra/docker/compose.yml` stub** — definir interface (env vars, ports, volumes). Não roda ainda.
- [ ] **Wire protocol document** — `docs/m10-adapter-wire-protocol.md`: JSON-RPC over stdin/stdout pra local, over WSS pra remote. Define mensagens: `spawn`, `stdin-write`, `event`, `kill`, `health`. M10 implementa.

#### Não-regressão

- [ ] Tudo do M6.1 smoke-test continua passando
- [ ] Security suite (token leak, sandbox escape, fence file) verde
- [ ] Token budget non-regression test (skip-while-zero até user capturar baseline real)

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

### 🔄 M9 — Dashboard + Multi-empresa + Polish + Reviews UX + API key (2º adapter)

Closing items pra v1 ficar feature-complete contra spec §4. **Aproveita foundation do M7.5** (adapter pattern, approvals decoupled, system prompt composable).

- [ ] **Dashboard widgets:**
  - [ ] Agentes Ativos (count + lista mini)
  - [ ] Issues em Andamento (count Doing+Review por project)
  - [ ] Inbox unread (count + último item)
  - [ ] Custos Hoje (tokens + % Max)
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
- [ ] **Right panel `/agents/:id`** — decisão design via frontend-design skill antes de codar (full page vs side panel)
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
| **Skills Manager** | 🔄 Em curso | M7 — UI cards + skills_json drag-drop. **Não imitar code-module/source-sync** (fora do threat model) |
| **Better Budgeting** | 🔄 Planejado | M8 (token tracking + % Max + por agente/projeto/adapter) |
| **Scheduled Routines** | 🆕 v2+ | Routines — cron-like recurring tasks |
| **Cloud / Sandbox agents** | 🟡 Parcial v1 + v2 | **M10 absorve parte**: VPS Docker remote adapter (isolamento de processo). v2 adiciona Cursor, Codex, e2b providers. |
| **Easy AGENTS.md configurations** | 🔄 M9 | Format próprio (YAML front-matter) com `gray-matter` parser |
| **companies.sh — import/export** | 🔄 M9 | JSON único (não ZIP) — DB menor que Paperclip |
| **Agent Reviews and Approvals** | 🔄 M7.5 + M9 | M7.5: schema `approvals` decoupled. M9: PR-style diff side-by-side + inline comments |
| **Work Products / Artifacts** | 🔄 M7.5 | Tabela `issue_artifacts` (kind: file_path, commit_sha, pr_url, snapshot) — adoção early via comparação Paperclip |
| **Org chart hierarchy** | 🔄 M7 | SVG handcrafted client-side. **Não usar React Flow/D3** (overkill pra read-mostly tree) |
| **Issue identifier humano** (`PRJ-123`) | 🔄 M7.5 | Migration 0004 — UX win trivial |
| **Plugin system** | 🆕 v2+ | Knowledge base / custom tracing / queues como sub-features. Big architectural change |
| **Get OpenClaw / claw-style agent employees** | 🆕 v2+ | Marketplace/template-store de agent personas (extensão do `role_templates`) |
| **Memory / Knowledge** | 🆕 v2+ | Knowledge base por agente (RAG-style). Vector DB ou sqlite-vss |
| **Enforced Outcomes** | 🆕 v2+ | Garantia de "tests passam", "compile OK" antes de marcar issue=done |
| **Deep Planning** | 🆕 v2+ | Plan-mode estendido (claude já tem `--permission-mode plan`) |
| **MAXIMIZER MODE** | 🆕 v2+ | Aggressive auto mode — requer API key opcional (Max não cobre) |
| **Work Queues** | 🆕 v2+ | Queue-based task processing (distinto de issues). Aproveita router FIFO |
| **Self-Organization** | 🆕 v3+ | Agentes reorganizando hierarquia entre si dinamicamente |
| **Automatic Organizational Learning** | 🆕 v3+ | Meta-feature: agentes aprendem de history |
| **Multiple Human Users** | ❌ Out-of-scope | Single-user explícito por ToS Anthropic Max |
| **Cloud deployments (UI na cloud)** | ❌ Out-of-scope | Mantemos Electron desktop como UI. **Hybrid VPS via M10** cobre o "agente na cloud" sem virar web app. |
| **Plugin sandbox providers** (e2b, Cloudflare, Daytona) | ❌ v3+ | Adapter remoto Docker do M10 já entrega isolamento. Outros providers só se feedback pedir. |
| **Skill source sync** (GitHub/NPM download) | ❌ Out-of-scope | Threat model: download/execução de código remoto. Memory `feedback_security_priority` |
| **Embedded Postgres** | ❌ Não fazer | sqlite serve perfeitamente desktop. Custaria semanas e zero valor. |

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
- **Goals** [PC] — objetivos longos que se decompõem em issues
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

### Inbox / Notifications

- **Pagination da inbox** [PC] — quando crescer >1000 itens
- **Archive de inbox/issues** [novo] — soft-delete + restore

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
