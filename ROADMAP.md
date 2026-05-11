# DashboardAgent — Roadmap

> Living doc. Atualizar a cada feature/fix mergeado em `master`.
>
> **Spec base:** [docs/superpowers/specs/2026-05-09-dashboard-agent-design.md](docs/superpowers/specs/2026-05-09-dashboard-agent-design.md)
> **Referência ativa de UX/código:** [Paperclip](https://github.com/paperclipai/paperclip) — clone funcional via OAuth Max em vez de API key
> **Última atualização:** 2026-05-11 (M7-A PR-A in progress — model selection scaffolded on `worktree-m7a-model-selection`)

## Status atual

| Métrica | Valor |
|---|---|
| Milestones fechados | M1, M2, M3, M4, M5, M6 (6/8 do v1 plano original) |
| Testes | 205 passing, 38 test files, 0 lint/typecheck errors (master) · M7-A PR-A scaffolded on worktree |
| Commits no master | ~95 |
| LoC (apps + packages) | ~13k TS/TSX |
| Stack | Electron 33 · React 18 · Vite · Tailwind · zustand · better-sqlite3 (WAL) · MCP SDK · vitest |

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
| **Org Chart** | ❌ Não iniciado | Coluna `agents.reports_to` existe e é setada no `hire_agent`. Rota `/org` zerada. |
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

### 🔄 M7 — Org Chart + Skills

**Por que junto:** ambos são views/edits sobre dados que já existem (`reports_to` e `skills_json`). Sem novos backend handlers grandes — UI-heavy.

- [ ] **Org Chart:**
  - [ ] Rota `/org` com tree visual (D3 ou React Flow ou simples SVG)
  - [ ] CEO no topo, sub-agentes filhos via `reports_to`
  - [ ] Click num node abre painel com info do agente / link pra `/agents/:id`
  - [ ] Drag pra mudar `reports_to` (com confirm modal)
- [ ] **Skills:**
  - [ ] Rota `/skills` cards do `skills_catalog` (read-only display por enquanto)
  - [ ] Em `/agents/:id` right panel: campo "Skills" mostrando `skills_json` atual + drag-drop pra adicionar/remover
  - [ ] Aplicação real: agente só pode chamar tools listadas em skills (gate hook)
  - [ ] Templates de role (`role_templates` tabela) usados como starting skills no hire_agent
- [ ] **Seleção de modelo por agente** ⚡ urgente — **PR-A 🟡 ready for merge** (branch `worktree-m7a-model-selection`):
  - [x] Adicionar coluna `agents.model` (TEXT, default `claude-sonnet-4-6`) via migration 0003 + `role_templates.default_model`
  - [ ] Right panel em `/agents/:id`: dropdown com presets (Opus 4.7, Sonnet 4.6, Haiku 4.5) + "custom model id" — **defer to PR-C**
  - [x] `lifecycle.ts buildClaudeArgs`: passar `--model <agent.model>` no spawn
  - [ ] MCP tool `hire_agent`: aceitar `model` param opcional explícito — **defer to PR-B** (PR-A: reads `settings.defaultModelForNewAgents` as the default)
  - [x] Settings: campo "Default model for new agents" (dropdown presets + custom + regex injection guard)
  - [ ] Considerar custo: Opus pra CEO/Architect, Sonnet pra engenheiros, Haiku pra agentes simples (memory: tokens não podem inflar) — aplicado nos defaults de role em PR-B
- [ ] **Não-regressão:** segurança, tokens, suite

### 🔄 M8 — Costs UI + Token Tracking

- [ ] **Backend:**
  - [ ] Persistir `result.usage` (cache_creation_input_tokens, cache_read_input_tokens, output_tokens) por turn em `costs_log`
  - [ ] Calcular % do limite Max baseado no rate_limit_event do stream
  - [ ] Aggregations: por agent, por project, por dia
- [ ] **UI:**
  - [ ] Rota `/costs` com gráficos (recharts ou similar)
  - [ ] Limite Max + progress bar visível
  - [ ] Filtros: agent, project, date range
  - [ ] Widget "Custos hoje" no Dashboard (alimenta o §6.4 Dashboard widget)
- [ ] **Não-regressão:** spec §10.3 hard limit ≤1.3x do baseline

### 🔄 M9 — Dashboard + Multi-empresa UI + Polish

Closing items pra v1 ficar feature-complete contra spec §4.

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
- [ ] **Suporte a API key (alternativa ao OAuth Max)** — dual auth:
  - [ ] Setup wizard: pergunta auth source (OAuth Max recomendado / API key)
  - [ ] Settings: switch entre OAuth Max e API key (com warning sobre custo: API key cobra por token, OAuth Max é flat-rate)
  - [ ] `apps/main/src/auth/`: nova função `getActiveAuthMode()` retorna `'oauth' | 'api-key'`
  - [ ] Storage: `safeStorage.encrypt(apiKey)` igual padrão do OAuth M2; `auth:api-key-set` IPC
  - [ ] `lifecycle.ts spawnAgent`: se mode='api-key', passar `ANTHROPIC_API_KEY` env var em vez de copiar `.credentials.json`; remover `--strict-mcp-config` lockdown que assume OAuth?
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
- [ ] **Agent Reviews UX polish** (Paperclip wishlist + spec §6.4):
  - [ ] Em `/issues/:id`: aba "Review" com diff/output do agent assignee, botões Approve+merge / Request changes / Reject
  - [ ] Inline comments no diff
  - [ ] Status="review" já existe no M6 — esse milestone só polish UX

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

Mapeamento de cada item da wishlist do [Paperclip](https://github.com/paperclipai/paperclip) com nosso status. **Nem tudo do Paperclip é desejado pra nós** — alguns explicitamente fora de escopo (ex: multi-user, cloud deployments).

| Item Paperclip | Status nosso | Onde |
|---|---|---|
| **Desktop App** | ✅ Pronto | M1 (Electron) |
| **CEO Chat** | ✅ Pronto | M3 (chat 1-1) + M5 (multi-agente real) |
| **Skills Manager** | 🔄 Planejado | M7 (UI cards + drag-drop em /skills + right panel) |
| **Better Budgeting** | 🔄 Planejado | M8 (token tracking + % Max + por agente/projeto) |
| **Scheduled Routines** | 🔄 Planejado | v2 (Routines — cron-like recurring tasks) |
| **Cloud / Sandbox agents** | 🔄 Planejado | v2 (suporte a Cursor, Codex, e2b — adapter pattern) |
| **Easy AGENTS.md configurations** | 🆕 Candidato v1 | Adicionar a M9 — config file declarativo pra hire-from-file |
| **companies.sh — import/export** | 🆕 Candidato v1 | Adicionar a M9 — JSON dump+restore via Settings (útil já pra teste e backup user-driven) |
| **Agent Reviews and Approvals** | 🟡 Parcial | Issue status='review' já existe (M6). Falta UX rica de side-by-side diff + comments inline → débito M9 polish |
| **Plugin system** | 🆕 v2+ | Knowledge base / custom tracing / queues como sub-features. Big architectural change, v2 mínimo |
| **Get OpenClaw / claw-style agent employees** | 🆕 v2+ | Marketplace/template-store de agent personas pré-configurados (extensão do `role_templates`) |
| **Memory / Knowledge** | 🆕 v2+ | Knowledge base por agente (RAG-style). Vector DB ou sqlite-vss. Big new dep + design |
| **Artifacts & Work Products** | 🆕 v2+ | Tabela `artifacts` pra deliverables (arquivos criados, PRs, snapshots). Distinto de issues |
| **Enforced Outcomes** | 🆕 v2+ | Garantia de "tests passam", "compile OK" antes de marcar issue=done. Integra com CI/build |
| **Deep Planning** | 🆕 v2+ | Plan-mode estendido (claude já tem `--permission-mode plan`). Ritual de plan-then-execute com aprovação intermediária |
| **MAXIMIZER MODE** | 🆕 v2+ | Aggressive auto mode com fewer constraints. Cuidado com regra dura de tokens — provavelmente exclude de Max OAuth, exige API key opcional |
| **Work Queues** | 🆕 v2+ | Queue-based task processing (distinto de issues — issues = formal tickets, queues = continuous stream). Aproveita a router FIFO já existente |
| **Self-Organization** | 🆕 v3+ | Agentes reorganizando hierarquia entre si (hire/fire dinâmico baseado em workload). Avançado |
| **Automatic Organizational Learning** | 🆕 v3+ | Meta-feature: agentes aprendem de history (cross-agent patterns, recurring failures). Avançado |
| **Multiple Human Users** | ❌ Out-of-scope | Single-user explícito por ToS Anthropic Max. Não fazer |
| **Cloud deployments** | ❌ Out-of-scope | Spec é local-only. Memory `project_dashboardagent.md` reforça |

**Como decidir incluir ou não no v1:**
- Item marca o produto como "diferenciado" do CEO Chat puro? → considerar pra v1
- Item é pré-requisito pra outra feature já planejada? → mover pra milestone correspondente
- Item é nice-to-have sem alterar core flow? → v2+

---

## v2+ (fora do v1)

Tudo daqui pra baixo é post-v1. Listado pra não esquecer:

- **Routines** — tasks recorrentes (cron-like) atribuídas a agentes (Paperclip: "Scheduled Routines")
- **Goals** — objetivos longos que se decompõem em issues
- **Activity Log audit-grade** — log estruturado de tudo que cada agente fez
- **"New Issue" hotkey global** — atalho de teclado mesmo com app não focado
- **Suporte a outros agents** — Cursor, Codex, custom CLI agents (Paperclip: "Cloud / Sandbox agents")
- **Plugin system** — extensions architecture (knowledge base, tracing, queues)
- **OpenClaw-style template marketplace** — agent personas compartilhados
- **Memory / Knowledge base** — RAG por agente (vector DB)
- **Artifacts & Work Products** — tracking de deliverables
- **Enforced Outcomes** — garantias pré-merge (tests/build)
- **Deep Planning mode** — plan-then-execute ritual
- **MAXIMIZER MODE** — aggressive auto (talvez requer API key opcional)
- **Work Queues** — continuous-stream task processing
- **Self-Organization** — agentes reorganizam hierarquia
- **Automatic Organizational Learning** — meta-learning cross-agent
- **CSP restritivo no renderer** se ainda em débito
- **Auto-update via rede** com signatura/notarização
- **Telemetria opcional** (default OFF, opt-in, sem conteúdo de mensagens)

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
