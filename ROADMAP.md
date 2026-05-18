# Prospero — Roadmap

> Living doc. Atualizar a cada feature/fix mergeado em `master`.
>
> **Spec base:** [docs/superpowers/specs/2026-05-09-prospero-design.md](docs/superpowers/specs/2026-05-09-prospero-design.md)
> **Referência ativa de UX/código:** [Paperclip](https://github.com/paperclipai/paperclip) — clone funcional via OAuth Max em vez de API key
> **Comparação técnica:** [docs/paperclip-comparison.md](docs/paperclip-comparison.md) — origem dos itens em M7.5 e V2
> **Gaps UX/governance:** [docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md](docs/superpowers/specs/2026-05-11-paperclip-gaps-ux-governance-design.md) — origem dos M7.6, M7.7, M8.5
> **Última atualização:** 2026-05-18 — **M11 ✅ MERGEADO COMPLETO · V2 anchor fechado.** 6 PRs (A–F): capabilities rename · schema + 9 MCP tools + tab Learning · motor de auto-derivação + Candidates UI · herança por role + `skill_promote` · org retrospectives + Org Learnings · decay/trust + Settings Memory + nudges fallback + terminate-modal promote + docs (`memory-architecture.md`, `skills-format.md`, `derivation-pipeline.md`, SECURITY.md). Arquitetura: 3 camadas × 2 níveis (individual + coletivo), fluxo bidirecional. **M12 iniciado 2026-05-18** — PR-A entregue: `role_templates` vira biblioteca editável (criar/clonar/editar/excluir em `/roles`) + charter de 8 seções por papel + 5 charters-exemplo. **1232 testes**.
>
> **Distribuição (decisão 2026-05-11):** **hybrid** — Electron desktop continua como default e UI. Adapter pattern (M7.5 foundation, M9 API key, **M10 VPS Docker**) permite spawnar agentes localmente OU em containers Docker numa VPS remota. Usuário escolhe per-agent (CEO local pra latência, engenheiros remotos pra isolamento). Sem rewrite — adapter pattern absorve o segundo lifecycle.
>
> **🛠 Regra de manutenção:** toda feature mergeada em master atualiza **3 lugares**: (1) seção "Em linguagem simples" abaixo, (2) seção técnica "v1 scope tracker", (3) `docs/roadmap.html` (seções `/00` e `/03`). A seção em linguagem simples existe pra leigos entenderem o que dá pra fazer hoje sem ler jargão técnico.

---

## 🟢 Em linguagem simples — o que o app faz hoje

> **Não é técnico?** Aqui está, sem jargão, tudo que dá pra fazer no Prospero neste momento. Tudo nesta lista **já funciona** — você instala, loga com sua conta Claude Max, e usa.

### 🏢 Organização
- Criar uma "empresa" virtual e adicionar projetos (pastas de código no seu computador)
- Cada projeto tem cor, **ícone emoji** e caminho próprios pra ficar fácil de identificar
- **Arquivar projetos** que terminaram (somem da lista por padrão, toggle "Mostrar arquivados" recupera)
- **Exportar empresa inteira em JSON** (Settings → Exportar empresa) — backup com agentes/issues/threads/mensagens/inbox/custos/activity
- **Importar empresa de JSON** (Settings → Importar empresa) — restaura o backup como uma empresa nova com IDs frescos. Se já existir uma com o mesmo nome, vira "(imported)"
- **Descrever o time inteiro num `AGENTS.md`** (Settings → Importar de AGENTS.md) — YAML com `company` + `projects` + `agents` (nome, role, reports_to). "Hire all" cria tudo de uma vez. Conflito de nome → modal Skip/Replace por agente. Reverso: "Exportar AGENTS.md" gera o arquivo da empresa ativa

### 👥 Time de agentes Claude
- "Contratar" agentes Claude — cada um vira tipo um funcionário com persona, função e habilidades próprias
- Até **4 agentes trabalhando em paralelo** (limite seguro do plano Claude Max)
- Modelos seedados: CEO, Engenheiro Backend, Engenheiro Frontend, DevOps, QA, Product Manager, Designer, Security Engineer
- Ver quem reporta a quem num **organograma visual** (arrastar pra mudar hierarquia)
- **Pausar, retomar ou demitir** agente a qualquer momento — não gasta tokens parado
- **Criar e editar cargos próprios** (página Papéis) — além dos exemplos prontos (CEO, Engenheiro, QA, Designer, PM), você cria, clona e apaga cargos pra qualquer ramo de negócio. Cada cargo tem um **charter**: um documento de 8 seções (identidade, missão, fluxo de trabalho, lentes do ofício, padrão de qualidade, colaboração, limites de segurança, definição de "feito") que descreve a fundo como aquele funcionário trabalha — editável num editor próprio (2026-05-18)

### 💬 Comunicação
- Conversar com cada agente em **chat 1-1** (como mensagear no Slack/Teams)
- **CEO delega trabalho automaticamente** — você fala "consertar bug X" e ele decide qual engenheiro faz, abre issue, manda mensagem
- Atribuir uma tarefa específica direto pra um agente ("Assign Task" no header)
- **Activity feed em tempo real** — tudo que está acontecendo aparece numa timeline com filtros (agente, tipo de ação, busca)

### 📋 Tarefas (Issues)
- Criar tickets com título, descrição, prioridade, responsável
- **Kanban com 5 colunas** (Backlog → Todo → Doing → Review → Done) com drag-and-drop
- Comments inline, sub-tasks, arquivos gerados (artifacts) anexados
- Identificador humano (ex: `BACKEND-7`) em vez de hash
- **Bloco "Em revisão" embutido** quando a issue entra em `status='review'`: diff side-by-side do output do agente + comentário inline + 3 botões (Aprovar & concluir / Pedir mudanças / Rejeitar) — sem sair do modal

### 📥 Inbox de aprovações
- Quando agente quer fazer algo arriscado (rodar comando shell, editar arquivo importante), **pede aprovação**
- Você aprova ou rejeita **inline** sem sair do chat
- Notificação no **tray icon** mesmo com janela fechada
- Filtros: All / Approvals / Completed / Suggestions / Errors / Security

### 🎯 Configuração de agente (Agent Studio)
- Editar **persona** (instruções) de cada agente — modal grandão com expand fullscreen
- Configurar quais **skills** (ferramentas) cada um pode usar — Engineer pode editar código, Designer não
- Modo **supervised** (pede aprovação antes de toda ação) ou **auto** (executa direto, com freios duros)
- Toggle **always-on** (24/7) ou sob demanda
- **Schedule** (wake-up agendado) pra agentes always-on
- Mudar **modelo** (Sonnet/Opus/Haiku) por agente
- Trocar a quem o agente **reporta** (organograma)
- Histórico de **runs** (sessões) com timestamps + duração
- **Escolher onde o agente roda** — local (no seu PC) ou numa VPS remota via Docker. Define na contratação ou troca depois no Agent Studio. Settings tem a seção "Execução remota" com teste de conexão (M10, 2026-05-15)

### 💰 Custos (M8 completo — 2026-05-12)
- Tracking **automático de tokens** consumidos por turn (entrada, saída, cache)
- **Pricing aproximado em USD** pros 3 modelos Claude 4.x
- **Soft-stop por budget diário** — agente passou do limite, pausa sozinho + alerta na inbox
- **Soft-stop por budget de issue** — mesmo se a daily não estourou
- **Rota `/costs`** com 3 gráficos (linha tokens/dia, barra top agentes, donut por projeto) + tabela + filtros (escopo, agente, projeto, adapter, período)
- **Widget "Custos hoje"** no Dashboard com progress bar do limite Max
- **Settings → Budgets** com 4 caps editáveis (daily/agent, per-issue, rate-window, window-hours) + reset
- **ModelDropdown** com chips $/$$/$$$ pra tier relativo
- **StatsTab do agente** mostra tokens 7d (entrada/saída/cache) + custo total

### 🎯 Goals & CEO Planning (M8.5 completo — 2026-05-14)
- Criar um **objetivo** (título, nível, prazo, critérios) e pedir "CEO planejar"
- CEO monta um **plano estruturado**: agentes a contratar + issues a criar + dependências + estimativa de tokens/custo/duração + riscos
- Revisar num modo **PR-review**: checkbox por agente e por issue pra incluir/excluir antes de aprovar
- **Estimativas recalculam em tempo real** conforme você desmarca itens (% do budget diário, tokens totais)
- 3 botões: **Aprovar & executar** (cria agentes + issues atomicamente), **Pedir mudanças** (free-text feedback → CEO refaz v2), ou **Rejeitar** (cancela o objetivo)
- **Inbox notifica** em cada etapa: plano proposto, executando, falhou (com link direto pro objetivo)
- **Histórico completo** de versões superseded/rejeitadas com feedback do user
- Tree view recursiva de objetivos com badges de status + level

### 🎬 Execução narrada — Kanban vivo (M8.6 completo — 2026-05-14)
- Settings → escolher **Modo Atômico** (default, rápido e silencioso) ou **Narrado** (CEO comenta cada passo)
- No GoalPlanReview, checkbox **"Aprovar em modo narrado"** override per-goal — mostra comparação de tokens (base vs ~2.5× narrado)
- Modo narrado: CEO entra num **loop streamado** e emite MCP calls (hire → create → comment) uma a uma — você vê o kanban "ganhando vida" em tempo real
- Comentários do CEO no modo narrado aparecem inline no IssueDetailModal com **badge** diferenciando CEO / agente / você (real-time)
- **Topological wake-up**: quando você marca uma issue como done, issues que dependiam dela acordam automaticamente em wave
- **Boot recovery**: se o app crasha mid-loop, próximo restart cria um item no Inbox com botões **"Retomar narrado"** ou **"Cancelar e reverter"**

### 🔒 Segurança
- Token Claude Max **criptografado at-rest** com DPAPI (Windows)
- Cada agente só consegue mexer nos **projetos que você liberou** explicitamente
- **Lista de comandos sempre bloqueados** (`rm -rf /`, leitura de `.ssh/`, exfiltração via `curl`) — mesmo em modo auto
- **Anti-prompt-injection**: heurística detecta agente mudando de comportamento de repente, rebaixa pra supervised
- **Sandbox de filesystem por agente** — não confia só no `--cwd`, valida cada path
- Auto-degradação: modo auto **expira em 24h** sem interação humana, volta pra supervised

### 🌍 Personalização
- Tema **claro ou escuro** (paleta monocromática)
- Idioma **português (BR) ou inglês (US)** — sem misturar em uma tela
- Múltiplas empresas isoladas no banco (UI dropdown vem em M9)
- Título customizado da janela (frameless titlebar)

### ⚙️ Por baixo do capô (sem detalhe técnico)
- Tudo roda **no seu computador** — single-user, offline-first
- Usa sua **assinatura Claude Max** — sem cobrança extra de API
- Dados em **SQLite local** — você é dono de tudo, zero cloud
- App **Electron** com tray icon — sobrevive ao fechar janela

---

### 🚧 O que ainda NÃO funciona (próximas releases)

- 📈 **Dashboard inicial com widgets dinâmicos** ✅ M9 PR-B (2026-05-14) — 7 widgets + Recent Activity timeline
- 🏢 **Trocar entre empresas via dropdown da sidebar** ✅ M9 PR-A (2026-05-14)
- ✅ **Empresa que aprende com a experiência (não só o funcionário)** — após cada issue concluído, o sistema **extrai automaticamente** um "skill" (manual de como fazer aquilo) a partir do trabalho real, você revisa e aceita. Conhecimento institucional **transfere entre funcionários**: se demite o BackendEng e contrata outro, o novato já chega sabendo o que a empresa aprendeu. CEO escreve retrospectiva ao completar um Goal. Inclui busca em conversas antigas. → **M11 ✅ COMPLETO** (âncora V2 fechada 2026-05-18; aba "Aprendizado", derivação automática, herança por role, org retrospectives, decay/trust, Settings Memory, nudges e promote-on-terminate todos entregues)

---

## 🎯 Agora → Próximo → Horizonte

> Quick view: onde estamos · o que vem a seguir · onde chegamos com v1 fechado.

### ▸ Agora (estado em 2026-05-18)

- **14 / 14 milestones do v1 fechados** — **v1 entregue em 2026-05-15**
- **M11 ✅ COMPLETO** — V2 anchor fechado (2026-05-18). 6 PRs (A–F) mergeados. Settings Memory (`user.md` + budget), decay/trust, nudges fallback, terminate-modal promote-skills, docs.
- **M12 iniciado** — PR-A mergeado (2026-05-18): `role_templates` vira biblioteca editável, rota `/roles` com criar/clonar/editar/excluir, charter de 8 seções por papel (arquivo markdown em disco) + 5 charters-exemplo. Plano: `docs/superpowers/plans/2026-05-18-m12-pr-a-role-authoring.md`.
- **1232 testes passing + 2 todo** · 0 lint/typecheck errors
- HEAD `main`: M12 PR-A (role authoring + charter library) mergeado (2026-05-18)

### ▸ Próximo

| Candidato | Escopo | Por quê |
|---|---|---|
| 🥇 **M12 Agent & Org Definition Layer** (em andamento) | ✅ PR-A charter de role (8 seções) + `/roles` biblioteca editável · ⬜ PR-B Manual Operacional como skill bundled · ⬜ PR-C aba Instructions + `composeSystemPrompt` lê o charter · ⬜ PR-D CEO arquiteto + AGENTS.md charters · ⬜ PR-E `agent_runs` + budget per-agent + Run Policy · ⬜ PR-F consolidação | V2 logo após o M11 — agente bem-instruído fortalece Workflow Plays e Enforced Outcomes. Doc de design em `docs/m12-agent-org-definition-layer.md`. |

**Recomendação:** seguir o M12 — PR-B (Manual Operacional como skill bundled).

### ▸ Horizonte (v1 = M10 fechado · V2 começa em M11)

```
M8 ✅ ──▶ M8.5 Goals ✅ ──▶ M8.6 Live Exec ✅ ──▶ M9 Dashboard ──▶ M10 VPS adapter ──▶ v1 ✅
            ~9-11d         ~6-8d              ~6-8d            ~4-6d
                                                                    │
                                                                    ▼
                                                       M11 Agent Memory ──▶ V2 ✦
                                                       (âncora V2)  10-14d
                                                                    │
                                                                    ▼
                                          M12 Agent & Org Definition Layer  ~18-24d
                                                                    │
                                                                    ▼
                                          V2 Tier 1: Enforced Outcomes · Routines · Plays
                                                  (cada um apoia-se em M11)
```

**Tese V2 — "1-person business":** o produto muda de natureza. V1 = "time de IA que você gerencia via chat"; V2 = "**delegação de outcomes que você só revisa**". Persona: qualquer pessoa criando um 1-person business apoiada numa empresa de agentes que aprende. Detalhe completo na seção "Visão V2" abaixo.

**O que v1 entrega quando estiver pronto:**

- Orquestrador local Electron com **N agentes Claude paralelos** via OAuth Max
- **CEO-planner automático** (M8.5) — você cria Goal, CEO propõe plano, você aprova, executor cria agents + issues atômico
- **Execução narrada + kanban vivo** (M8.6) — CEO cria issues uma a uma com comentários, acorda agentes na ordem de dependência, todos conversam nas issues
- **Cost tracking** (M8 ✅) com soft-stop por budget + dashboard de gastos
- **Dashboard** (M9) com Recent Activity + Active Agents + métricas + multi-empresa dropdown
- **Hybrid distribution** (M10) — escolhe per-agent: local (CEO, latência) ou VPS Docker (engenheiros, isolamento)
- 12 módulos funcionais ✅ + adapter ecosystem extensível
- Estimativa total restante: **~25-33 dias** de trabalho contínuo

---

## Status atual

| Métrica | Valor |
|---|---|
| Milestones fechados | M1–M6, **M7**, **M7.5**, **M7.7**, **M7.6**, **M8**, **M8.5**, **M8.6**, **M9**, **M10** (14/14 do v1 ✅) + **M11** (V2 anchor ✅) |
| Concluído | **M11 ✅ fechado** 2026-05-18 — **6/6 PRs** ✅ (A capabilities rename · B schema+repos · C MCP tools + Learning tab · D1/D2 derivation pipeline + Candidates UI · E1/E2 role inheritance + org retrospectives · F decay/trust + Settings Memory + nudges + terminate-modal + docs). **V2 anchor fechado.** |
| Em andamento | **M12 Agent & Org Definition Layer** — PR-A ✅ mergeado 2026-05-18 (biblioteca de papéis editável + charter de 8 seções). Restam PR-B a PR-F. |
| Testes | **1232 passing + 2 todo**, 0 lint/typecheck errors |
| Commits no main | ~722 |
| LoC (apps + packages) | ~23k TS/TSX |
| Stack | Electron 33 · React 18 · Vite · Tailwind · zustand · better-sqlite3 (WAL) · MCP SDK · zod · vitest · Playwright (E2E, skipped) |
| Distribuição planejada | Hybrid: desktop default + VPS Docker remote opcional (M10) |
| Restante pra v1 | **Nada — v1 fechado em 2026-05-15.** M11 (V2 anchor) também fechado. **M12 em andamento** (PR-A ✅). |
| V2 anchor | **M11 Agent Memory & Learning Loop — ✅ COMPLETO** (2026-05-18, 6 PRs). Arquitetura: 3 camadas × 2 níveis, fluxo bidirecional. Spec: `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md`. Docs: `docs/memory-architecture.md` + `docs/skills-format.md` + `docs/derivation-pipeline.md`. 3 inflexões deliberadas sobre [Hermes Agent](docs/hermes-memory-learning-system.md). Próximo V2: M12 Agent & Org Definition Layer. |

---

## v1 scope tracker (spec §4)

Status por **módulo** funcional do produto. Cada módulo pode estar em vários estados parciais entre milestones.

| Módulo | Status | Notas |
|---|---|---|
| **Multi-empresa** | ✅ Completo | M9 PR-A (2026-05-14): `companies:create`/`:delete` IPCs com validation + cascade DELETE. Renderer `useCompaniesStore` (zustand) com activeId persistido em `settings.activeCompanyId`. `<CompanySwitcher />` dropdown no topo da Sidebar + `CreateCompanyModal` + `DeleteCompanyConfirm` (counts + cascade warning + last-company guard). App.tsx reativo a `activeCompanyId` (reload agents/inbox/projects/issues). `roster-changed` event guarded contra clobber de stores quando company não-ativa emite. |
| **Dashboard** | ✅ Completo | M9 PR-B (2026-05-14): 7 widgets em grid 2-col + Recent Activity full-width. Active Agents / Active Issues / Inbox unread / Costs today / Active Agents Panel / Goals Progress / Recent Activity (10 eventos live). Selectors puros em `lib/dashboard/selectors.ts`. |
| **Activity stream** | ✅ Completo | Migration 0009 `activity_events` + recorder helper + dual-write em 17 call sites (PR-A). Rota `/activity` com 5 filtros + search + infinite scroll + real-time prepend via `ACTIVITY_NEW` + 700ms animação fade-down (PR-B). Sem `issue_events` migrado — dual-write paralelo. |
| **Inbox** | ✅ Completo | Rota `/inbox` com filter pills (All/Approvals/Completed/Suggestions/Errors/Security). Approve/Reject inline. Auto-mark-read no resolve. Badge unread no sidebar. **M7.5 PR-B:** dual-format handler suporta legacy embedded payload + new `approval_id` pointer. |
| **Issues** | ✅ Completo | MCP tools (create/update/assign/list/check_status/record_artifact) reais. Kanban /issues com 5 colunas + drag-drop. Modal de detail com comments + sub-tasks + tool history. **M7.5 PR-B:** identifier humano `<SLUG>-N` (ex: `BACKEND-7`) em todos call sites + artifacts accordion + soft warning ao marcar `done` sem artifacts. |
| **Projects** | ✅ Completo | Rota /projects master/detail com folder picker + color picker. Auto-cria 'Default Workspace' migration do workspaceCwd legado. Allowlist per agent via chip toggle. **M9 PR-F.1 (2026-05-14):** migration 0016 (`icon` + `archived_at`) + emoji picker (20 hardcoded) + archive/unarchive em ProjectDetail + show-archived toggle com greying. |
| **Agents** | ✅ Completo | Sidebar com status colors + "+ Novo" button. `/agents/:id` chat unified + AgentHeader sticky (Pause/Resume/Assign Task/Runs/⋯ menu) + ConfigTab completo (role/model/reports-to/mode/always-on/schedule/skills editáveis/persona com expand). RunsModal + InstructionsFullScreenModal + TerminateConfirmModal + AgentNew form. Backend: M7.6 PR-A (9 IPCs + migration 0010 + activity dual-write). UI: M7.6 PR-B. |
| **Org Chart** | ✅ Completo | Rota `/org` SVG handcrafted vertical tree + click drawer + drag-to-reassign + confirm modal + anti-cycle (backend + UI toast). |
| **Skills** | ✅ Completo | Rota `/skills` master-detail (5 roles seedados, tools chips por skill, agentsUsing). Hard-gate via `--allowedTools`. Edit per-agent disponível no ConfigTab do agente (M7.6 PR-B). |
| **Costs** | ✅ Completo | M8 PR-A backend (`56da29c`): migration 0011 `cost_events` + tracking por turn + pricing opus/sonnet/haiku + soft-stop daily/per-issue + 4 IPCs. M8 PR-B UI (`4c943fe`): rota `/costs` com 3 gráficos recharts (lazy) + filtros + tabela. Dashboard widget "Custos hoje". Settings Budgets. ModelDropdown $/$$/$$$. StatsTab real. |
| **Goals + CEO Planning** | ✅ Completo | M8.5 PR-A backend (`1a7a48a`): migration 0012 `goals`/`goal_plans` + Zod schema com DAG validation + 7 MCP tools (`list_goals`/`get_goal`/`update_goal_status`/`record_subgoal`/`list_role_templates`/`get_cost_baseline`/`submit_goal_plan`) + CEO system prompt block + executor atomic com topo sort (hires + issues) + recovery scan + 7 IPCs. M8.5 PR-B UI (`69bde4e`): 3 rotas lazy `/goals`+`/goals/new`+`/goals/:id`, GoalsTree recursivo (`buildGoalTree` helper), GoalDetailHeader, GoalPlanReview com include/exclude checkboxes + estimates recomputadas + validação inline, 2 modals (RequestChanges + Reject), GoalPlanHistory expansível, 3 inbox kinds (`goal_proposed`/`executing`/`error`) com migration 0013 + write backend + render link no Inbox, goalsStore Zustand, i18n PT/EN ~150 keys com parity test. |
| **Live Execution & Kanban Collab** | ✅ Completo | M8.6 PR-A backend: migration 0014 (`goals.execution_state_json` + `issues.depends_on_json`), executor dispatcher (atomic preserved + narrated branch), `executePlanNarrated` enqueues CEO turn, 4 MCP tools (`comment_on_issue`, `hire_agent_for_plan`, `create_issue_for_plan`, `finalize_goal_execution`), topological activation hook on `issues:update` status=done (waves de notifyAssignee), boot recovery scan (`scanStuckNarrated`), narrated-resume/rollback IPCs, Settings.executorMode atomic/narrated, 3 new activity actions. M8.6 PR-B UI (`d557055`): Settings radio block, GoalPlanReview narrated checkbox + token comparison hint, IssueCommentsList sender badges via SenderBadge component, IssueDetailModal real-time refresh on `issues:changed` comment-added, Inbox narrated_halted CTAs (Resume/Rollback), i18n PT/EN +30 keys + parity extended. |
| **Settings** | ✅ Completo | OAuth/API key auth (M9 PR-D), language, theme, default model, executor mode, defaults pra novos agentes (mode + always_on — M9 PR-C), banner global OAuth expiry 30d (M9 PR-E), **Export + Import company JSON snapshot** (M9 PR-F.1 + PR-F.2.1). |

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
M8.5 (Goals + CEO Planning — atomic foundation)
  ↓
M8.6 (Live Execution & Kanban Collab — narrated + sequenced + comments)
  ↓
M9  (Dashboard + Multi-empresa + Reviews UX + API key)
  ↓
M10 (VPS Docker Remote Adapter) ─── v1 ✅
  ↓
M11 (Agent Memory & Learning Loop — âncora V2 ✅) ─── V2
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
- [x] **PREAMBLE em arquivo `.md`** — `apps/main/src/orchestrator/preamble.md` lido com `fs.readFileSync` + cache + override opcional `~/.prospero/preamble.md`. **PR-A 🟢**
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

- [x] **E2E foundation com Playwright + Electron** — `tests/e2e/{playwright.config, fixtures, helpers, specs}` + `fake-claude.ts` stub gated por `PROSPERO_E2E_FAKE_CLAUDE=1` + env-var bypass (`PROSPERO_USER_DATA`, `PROSPERO_E2E_TOKEN_PATH`). 3 specs (`01-onboarding`, `02-hire-and-message`, `03-issue-lifecycle`) **escritos mas `test.describe.skip(...)` por incompat Electron 33 + Playwright 1.60** (`--remote-debugging-port=0` rejeitado pela Electron). Unskip é one-line change quando upstream resolver. **PR-C 🟢 (infrastructure)** / **bloqueado por incompat (runs)**
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

> **Status (2026-05-14):** **PR-A backend ✅ MERGEADO** (16 tasks, 65 testes novos, master HEAD `6925a5c`). Schema (migration 0012), goals/plans repos, Zod GoalPlanPayloadSchema com DAG validation, 6 MCP tools (list/get/update_status/record_subgoal/get_cost_baseline/submit_goal_plan), CEO system prompt block, executor atomic (topo-sorted hires + issues + goal_id linking), recovery scan, 7 IPC handlers + preload, integration tests. **PR-B UI ainda não iniciado** — rota `/goals` tree + `/goals/:id` PR-review UI.

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

**Custos:** 9-11 dias (refinado pós-brainstorming 2026-05-12; spec base 10-12 dias). **Pré-req:** ✅ M8 (cost_events), ✅ M7.5 (composeSystemPrompt), ✅ M7.6 (hire-from-ui), ✅ M7.7 (activity slot).

**Spec de implementação:** [docs/superpowers/specs/2026-05-12-m8-5-goals-implementation-design.md](docs/superpowers/specs/2026-05-12-m8-5-goals-implementation-design.md) — 2 PRs decididos no brainstorming (PR-A backend + PR-B UI, M8-style).

---

### ✅ M8.6 — Live Execution & Kanban Collab — MERGEADO 2026-05-14

**Camada viva sobre M8.5.** PR-A backend + PR-B UI fechados em master no mesmo dia. **Default = atomic, narrated opt-in** (decisão revisada do brainstorming: tokens não podem inflar 2-3×; narrated é capacidade adicional, não mudança default).

**O que entregou:**
- ✅ **Executor dispatcher** — `executePlan` em `apps/main/src/goals/executor.ts` routa entre atomic (M8.5 preservado, renomeado `executePlanAtomic`) e narrated (novo `executePlanNarrated` em `executor-narrated.ts`). Settings `executorMode` + override per-approve via `mode` param do IPC.
- ✅ **Narrated loop** — `executePlanNarrated` transiciona goal pra `approved`, persiste `goals.execution_state_json`, enqueue CEO turn com `[GOAL_EXECUTE_REQUEST]` (via novo `orchestrator.enqueueExecuteRequest`). CEO loopa 4 MCP tools até `finalize_goal_execution`.
- ✅ **4 MCP tools novos:**
  - `comment_on_issue` (qualquer agente, sanitizer M5, em `tools-issues.ts` novo)
  - `hire_agent_for_plan({planIndex})` idempotente, valida reportsTo chain
  - `create_issue_for_plan({planIndex})` resolve assignee + deps via state, popula `goal_id` + `depends_on_json`
  - `finalize_goal_execution({goalId, abort?})` valida complete OR rollback transacional (terminate agents + delete issues)
- ✅ **Topological sequenced activation** — hook em `issues-handlers.ts` `ISSUES_UPDATE` quando `status→done` → `computeUnlockedDependents` via `findDependentsOf` (LIKE + JSON parse) → notifyAssignee waves + activity `issue.unlocked_by_deps`. Plan-driven issues (com `depends_on_json` non-null) respeitam waves; user-created continuam wake imediato.
- ✅ **`IssueCommentsList` sender badges** — CEO (brand-bg), agente (surface-soft com nome), user (brand). Real-time via `IssueDetailModal` subscrevendo `issues:changed` `comment-added`.
- ✅ **Settings radio + GoalPlanReview narrated toggle** — checkbox per-goal com hint de tokens base vs ~2.5× narrado.
- ✅ **Boot recovery** — `scanStuckNarrated` detecta `goals.status='approved' AND execution_state_json IS NOT NULL` → inbox `goal_error` com `step='narrated_halted'`. UI mostra 2 botões "Retomar narrado" / "Cancelar e reverter".
- ✅ **Activity events novos:** `issue.commented`, `issue.unlocked_by_deps`, `goal.narrated_step`. Activity render usa pattern `activity.action.<action>` — sem mudança no `activityRender.ts`, só i18n.
- ✅ **i18n PT/EN +30 keys** com parity test extendido (4/4).

**Pré-reqs cumpridos:**
- ✅ M8.5 (executor atomic + planning UI), ✅ M6 (issue_comments), ✅ M5 (notifyAssignee + sanitizer), ✅ M7.7 (activity recorder)

**Não-regressão:**
- ✅ Atomic mode (default) inalterado — `executePlanAtomic` é o código M8.5 só renomeado
- ✅ Issue assignment manual (não-goal): `depends_on_json` NULL → wake imediato preservado
- ✅ CommentComposer UI continua funcionando como user-side
- ✅ M8.5 inbox kinds (`goal_proposed`/`executing`/`error`) reusados (sem novos)

**Spec:** [docs/superpowers/specs/2026-05-14-m8.6-live-execution-design.md](docs/superpowers/specs/2026-05-14-m8.6-live-execution-design.md)
**Plans:** [pr-a backend](docs/superpowers/plans/2026-05-14-m8.6-pr-a-narrated-backend.md) · [pr-b ui](docs/superpowers/plans/2026-05-14-m8.6-pr-b-narrated-ui.md)
**Memory:** [project_m8_6_lessons](../d--Projetos-pessoais-Prospero/memory/project_m8_6_lessons.md)

**Pendente:** smoke manual (user vai rodar depois de V2 estar pronta).

---

### ✅ M9 — Dashboard + Multi-empresa + Polish + Reviews UX + API key (2º adapter) — **MERGEADO 2026-05-14**

Closing items pra v1 ficar feature-complete contra spec §4. **Aproveita foundation do M7.5** (adapter pattern, approvals decoupled, system prompt composable).

- [x] **Dashboard widgets:** ✅ **PR-B mergeado 2026-05-14** — 7 widgets em grid 2-col + Recent Activity full-width
  - [x] Agentes Ativos (count + top 3 mini list com status dot)
  - [x] Issues em Andamento (count Doing+Review + breakdown por project)
  - [x] Inbox unread (count + último item snippet)
  - [x] Custos Hoje (reuso CostsTodayWidget existente)
  - [x] **Recent Activity** (últimos 10 eventos com live subscribe via useActivityStream)
  - [x] **Active Agents Panel** (per-agent status com `currentAction` granular)
  - [x] Goals em andamento (top 3 in_progress sorted updatedAt desc)
- [x] **Multi-empresa:** ✅ **PR-A mergeado 2026-05-14** — store + sidebar dropdown + create/delete modals + active company persistido em settings
  - [x] Dropdown topo da sidebar pra trocar de company (`<CompanySwitcher />`)
  - [x] Criar nova empresa (`CreateCompanyModal` com Enter/Escape)
  - [x] Deletar empresa (`DeleteCompanyConfirm` + cascade DELETE + counts + last-company warning)
  - [x] Active company persistido em `settings.activeCompanyId` (sem nova migration — JSON blob)
- [x] **/agents (lista, não detail):** ✅ **PR-C mergeado 2026-05-14**
  - [x] Cards com nome + role + status dot + currentAction (grid responsivo)
  - [x] Botão "+ Novo agente" com `<RoleTemplateGalleryModal />` → `/agents/new?template=<id>`
- [ ] **Right panel em /agents/:id:**
  - [ ] Persona (system_prompt edit-in-place)
  - [ ] Skills (cross-link com M7)
  - [ ] Allowed projects (cross-link com M6)
  - [ ] Issues atribuídas
  - [ ] Stats (tokens consumidos, turns, etc)
- [x] **Settings:** ✅ **PR-C mergeado 2026-05-14** (banner expiry deferido pra PR-E)
  - [x] Defaults de mode (`supervised`/`auto`)
  - [x] Defaults de `always_on`
  - [ ] Banner global pra OAuth token expiring (30d antes) → deferido pra PR-E (precisa JWT parsing + IPC novo)
- [x] **Suporte a API key (2º adapter `claude-api-key-local`)** ✅ **PR-D mergeado 2026-05-14** — dual auth via adapter pattern do M7.5:
  - [x] Setup wizard: pergunta auth source (OAuth Max recomendado / API key)
  - [x] Settings: switch entre OAuth Max e API key (radio + inline API key form com mask/clear)
  - [x] `auth-mode.ts` agora retorna `'oauth' | 'api-key'` baseado em `settings.authMode`
  - [x] Storage: `safeStorage.encryptString(apiKey)` em DB key `auth.apikey.ciphertext` + 3 IPCs (`auth:api-key-{set,status,clear}`)
  - [x] **Novo adapter impl** `claude-api-key-local` em `apps/main/src/orchestrator/adapters/`: espelha `claude-oauth-local` mas **sem** `seedSandboxCredentials` e passa `ANTHROPIC_API_KEY` env var. `--strict-mcp-config` continua ativo.
  - [x] Limite dos 4 agentes simultâneos: aplicar SÓ pra OAuth (`lifecycle.ts` guard em `agent.adapterName === 'claude-oauth-local'`)
  - [x] SECURITY.md atualizado com `claude-api-key-local` threat model completo
- [x] **Error handling (spec §7):** ✅ **PR-E mergeado 2026-05-14**
  - [x] Banner global vermelho quando OAuth inválido (AuthErrorBanner — também avisa quando API key não tá set)
  - [x] Auto-restart do main em crash + 5s log emergency window
  - [x] Banner amarelo em rate limit (stream-parser → broadcast → RateLimitBanner com auto-clear)
  - [x] Heartbeat 5min (working/thinking sem activity_events recentes → status=error + inbox `agent_unresponsive`)
  - [x] OAuth expiry banner 30d antes (deferido de PR-C, agora aqui — usa `expires_at` de credentials.json)
- [x] **AGENTS.md configurations** ✅ **PR-F.2.2 mergeado 2026-05-14** (Paperclip wishlist):
  - [x] Formato declarativo (front-matter YAML com `company` + `projects` + `agents`)
  - [x] Settings UI: "Importar de AGENTS.md" — parseia, preview modal com lista + conflict resolution per-agent (Skip/Replace), "Hire all" cria projects+agents em duas passes (create → wire reports_to)
  - [x] Reverso: "Exportar AGENTS.md" gera o arquivo a partir da company ativa (filtra arquivados + terminados; emite reports_to como nome)
- [x] **companies.sh export + import** ✅ **PR-F.1 + PR-F.2.1 mergeados 2026-05-14**:
  - [x] Settings UI: botão "Exportar JSON" — gera JSON com agents/threads/messages/inbox/projects/issues/costs/activity/goals/approvals (schemaVersion 1, snapshot-only)
  - [x] Settings UI: botão "Importar JSON" — file picker, valida schemaVersion via zod, gera fresh IDs + remap FK em 10 tabelas + UPDATE pass pra reflexive FKs (reports_to/parent_id/parent_goal_id/goal_id). Foreign keys=OFF dentro da transaction. Conflito de nome rename pra "(imported)". Summary modal com counts + warnings expandíveis.
  - [x] Caso de uso: backup, snapshot pré-experimento, share entre instalações
- [x] **Agent Reviews UX polish** ✅ **PR-F.2.3 mergeado 2026-05-14** (Paperclip wishlist + spec §9.3):
  - [x] Em `/issues/:id` modal: bloco "Em revisão" renderizado quando `status === 'review'`
  - [x] Diff side-by-side via `react-diff-viewer-continued` — pega artifact mais recente (`output_text` ou `snapshot`) com `contentPreview`
  - [x] Comment box embutido (opcional pra Approve, obrigatório pra Request changes / Reject)
  - [x] Botões Approve & merge (`status → done`) / Request changes (`→ doing`) / Reject (`→ cancelled`) usam `issues:update` + `issues:add-comment` existentes — sem migração nova
  - [x] Tema dark detectado via `useSettingsStore`, helpers puros (`statusForDecision`, `validateDecision`, `pickDiffArtifact`) com 12 tests
- [ ] **Right panel `/agents/:id`** — ✅ entregue M7-C + completion em M7.6 (header + ações + faltantes)
- [x] **AGENTS.md formato próprio (YAML front-matter)** ✅ **PR-F.2.2 mergeado 2026-05-14** — `gray-matter` parser + zod schema em `apps/main/src/agents-md/`:
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
- [x] **Project icons + archived state** ✅ **PR-F.1 mergeado 2026-05-14** — emoji picker (20 emojis hardcoded) + archive/unarchive em ProjectDetail + show-archived toggle + greying visual
- [ ] **Token expiry banner** (OAuth Max 30d antes) — já listado, mantém

---

### ✅ M10 — VPS Docker Remote Adapter — **MERGEADO · fechou v1 (2026-05-15)**

**Origem:** decisão de 2026-05-11 — distribuição hybrid. Terceiro adapter `claude-oauth-remote-docker` sobre a foundation do M7.5. O processo `claude` roda num container Docker — local ou numa VPS via SSH. Usuário escolhe a localização per-agente (na contratação ou no Agent Studio).

**Arquitetura (decisão 2026-05-15):** SSH stdio, **não** WSS+mTLS — SSH já entrega auth + criptografia + pipe, sem porta aberta e sem ciclo de cert X.509. Host-authoritative: só o `claude` roda remoto; SQLite, MCP server e o permission handshake ficam no host, e as ferramentas MCP do agente remoto chegam ao host por um túnel sobre o wire protocol. Defense-in-depth: o blocklist do `gate.ts` roda host-side mesmo com isolamento Docker.

**5 PRs (A–E), mergeados em `main`:**

- **PR-A — Wire protocol** — `packages/shared/src/wire/` (tipos, codec, framing, `WireClient`/`WireServer`, transporte). Doc `docs/m10-adapter-wire-protocol.md`.
- **PR-B — Agent runner + imagem** — app novo `apps/agent-runner/` (wire server, spawn de `claude`, sandbox container-side, `mcp-bridge`) + Dockerfile multi-stage real (`node:22-slim`, não-root, `tini` PID 1).
- **PR-C — Host adapter + MCP relay** — `ClaudeRemoteDockerAdapter` + connection manager (1 conexão por host) + transport launcher (`docker run` local / `ssh … -- docker run`) + `McpRelay` per-agente.
- **PR-D — Settings + UX** — `AppSettings.remoteExecution` + seção "Execução remota" no Settings + seletor de localização per-agente + IPCs `agents:set-adapter` e `remote:test-connection`.
- **PR-E — Docs** — `SECURITY.md` (threat model do adapter remoto refinado), `docs/m10-vps-setup-runbook.md` (setup VPS + checklist de smoke), roadmap em 3 lugares.

**Sem migração nova** — `agents.adapter_name` já existia (migration 0004) e o union `AdapterName` já incluía `claude-oauth-remote-docker`. Config da VPS mora no blob JSON `app-settings`.

**Smoke Docker local:** checklist manual em `docs/m10-vps-setup-runbook.md` §C — exige Docker instalado, rodado pelo usuário.

---

### ✅ M11 — Agent Memory & Learning Loop — **V2 anchor · COMPLETO (2026-05-18)**

**Origem:** pesquisa Hermes Agent ([NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), 2026-05-12). Doc completo em [docs/hermes-memory-learning-system.md](docs/hermes-memory-learning-system.md). Substitui o item v2+ "Memory / Knowledge base" por implementação concreta — **inspirada** no closed learning loop do Hermes mas com **3 inflexões deliberadas** que aproveitam vantagens estruturais do nosso codebase (Activity stream, Issues, Goals, CEO-planner).

**Por que V2 começa aqui:** v1 = M10 está locked; mexer antes adicionaria 1-2 semanas no critical path sem desbloquear v1. Pós-M10, M11 vira **âncora da V2** porque memória persistente é o que muda a natureza do produto — de "chat com agentes" pra "time que aprende com sua experiência". A tese V2 "1-person business" depende disso: solo founder cria leverage apoiado numa empresa de agentes que **compounda** know-how em vez de reiniciar a cada conversa. Sem M11 antes, as outras apostas V2 (Enforced Outcomes, Routines, Plays) viram features sólidas mas estáticas.

**Arquitetura: matriz 3 camadas × 2 níveis (Hermes-style, simétrico).** As 3 camadas cognitivas do Hermes (declarativa, procedural, episódica) replicadas em 2 níveis (individual + coletivo), com fluxo bidirecional (descendente via inheritance, ascendente via `skill_promote` + `memory_add({applies_to_role})` + retrospectivas CEO).

#### 📊 Progresso — ✅ TODOS OS PRs MERGEADOS (2026-05-18)

Decomposto em **6 PRs (A-F)** — na execução o **PR-D** foi dividido em **D1**
(motor de derivação) + **D2** (UI de revisão dos candidates), e o **PR-E** em
**E1** (herança por role + `skill_promote`) + **E2** (triggers de memória + Org
Learnings); o **PR-F** foi dividido em **F1** (decay/trust/purge) + **F2**
(Settings Memory + nudges + terminate-modal + docs). O texto de planejamento
abaixo é o original; a **spec reconciliada**
([docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md](docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md))
é a fonte de verdade — corrigiu vários pontos do plano abaixo: migrations `0017`
(rename) + `0018` (schema), **não** "M11-01"; filesystem em `userData/memory/`,
**não** `~/.prospero/`; a tab Learning é a **3ª** tab de `/agents/:id`, não a 4ª;
PR-C entrega **9** MCP tools (`skill_promote` foi adiado pra PR-E); `user.correction`
deriva de sinais objetivos (`approval.rejected` + regressão de issue), não de
heurística NLP; novo evento `agent.recovered`.

| PR | Escopo | Status |
|---|---|---|
| **A** | Rename skills → capabilities (desambigua o conceito M7 do M11) | ✅ `9eb65c2` (2026-05-15) |
| **B** | Migration `0018` + repositórios + `sanitizer.ts` + backfill `messages_fts` | ✅ `bd46608` (2026-05-15) |
| **C** | 9 MCP tools de memory/skills + injeção no system prompt + rate limiter (backend `34b7d8c`) · tab "Learning" Skills/Memory/History + IPC handlers + badge no header (UI `074d366`) | ✅ 2026-05-15/16 |
| **D1** | Motor de auto-derivação — evento `agent.recovered`, dispatcher nos 2 triggers (`issue.done`/`recovered`), runner `claude -p` headless (Sonnet), worker (cap 3/dia/agente via `cost_event`, sanitizer), grava `skill_candidate` + inbox `skill_candidate_pending` | ✅ 2026-05-16 |
| **D2** | Sub-tab "Candidates" (Accept/Edit/Reject) + IPC + accept→skill real + resolve do inbox item | ✅ 2026-05-16 |
| **E1** | Herança por `applies_to_role` no system prompt (`buildMemoryBlock`) + `skill_promote` MCP tool + inbox `skill_promotion_requested` + modal de aprovação | ✅ 2026-05-16 |
| **E2** | Triggers `goal.achieved`→retrospectiva (company scope) / `approval.rejected`→preferência (agent scope) estendendo o motor de derivação + migration `0021` (inbox `goal_retrospective_ready`) + IPC `orgLearnings` + card "Org Learnings" no `/dashboard` | ✅ 2026-05-16 (terminate-modal "promover skills?" adiada pra PR-F) |
| **F1** | Decay/trust (boot maintenance + `importance *= age_decay(90d) * access_boost`) + thumb up/down trust feedback UI (±0.05/−0.10) + 30-day skill purge | ✅ 2026-05-18 |
| **F2** | Settings Memory panel (`user.md` editor + "Import from Claude Code" + derivation budget slider) + nudges fallback (≥30 turns / ≥25 tool calls → skill hint; near-full memory → consolidation hint) + terminate-modal "promover skills privados?" checklist + docs (`memory-architecture.md`, `skills-format.md`, `derivation-pipeline.md`, SECURITY.md) | ✅ 2026-05-18 |

#### 🔀 As 3 inflexões vs Hermes

> Discussão completa em [docs/hermes-memory-learning-system.md §11](docs/hermes-memory-learning-system.md).

**Inflexão 1 — Skills > MEMORY.md (inverter ênfase).** Hermes equilibra declarativa e procedural; nós focamos procedural. Skills L0 budget sobe de ~3 KB pra ~4 KB. MEMORY.md cai de ~2 KB pra ~1 KB (só identity + rules duras). **Razão:** "user prefere tabs" é CLAUDE.md territory (já cobre); "como migrar schema X em 12 passos" é skill — valor 4× maior e carrega só quando precisa (progressive disclosure).

**Inflexão 2 — Memória derivada do Activity stream, não da auto-narração do agente.** Hermes pede o agente narrar lições; nós já temos `activity_events` (M7.7) + `issue_artifacts` (M7.5) — trilha objetiva, alto sinal/ruído. Triggers automáticos:
- `issue.done` → extrai skill candidate (LLM analisa o trail e propõe SKILL.md)
- `agent.recovery_after_error` → extrai skill candidate
- `goal.achieved` (M8.5) → gera post-mortem em company memory
- User correction (heurística sobre messages) → extrai USER.md fragment

Auto-narração via MCP tool (`memory_add`, `skill_create`) **vira fallback** — não fonte primária.

**Inflexão 3 — Company-wide memory + role-based inheritance desde dia 1.** Hermes é single-agent. Nós temos org-chart, role templates, multi-agent. **Quando demite BackendEng e contrata outro pro mesmo role, conhecimento institucional transfere via company memory + memórias com `applies_to_role`.** É o que a wishlist marca como "Automatic Organizational Learning" v3+ — entregamos versão mínima já no M11.

**Resultado:** o produto deixa de ser "Claude com persistência" e vira "uma empresa que aprende com a experiência dos funcionários — e cresce mesmo quando um indivíduo sai".

#### Decisão arquitetural

- **4 níveis no system prompt** (ordem de injeção):
  1. `USER.md` global (~1 KB cap) — preferências cross-companies
  2. Company memory (~1.5 KB cap) — regras org-wide + retrospectivas de Goals
  3. Agent MEMORY.md (~1 KB cap) — identity + rules específicos
  4. Skills L0 do agente + inherited (~4 KB cap) — ~40 skills × 100 chars
- **Híbrido markdown + SQLite.** Body markdown (human-editable), metadata SQLite (importance/trust/role-scope/FTS5).
- **Sem vector embeddings v1.1.** FTS5 atende. Vector v1.2.
- **Skills** seguem padrão [agentskills.io](https://agentskills.io) — YAML frontmatter + markdown, progressive disclosure L0/L1/L2.
- **Sanitizer em todo write** (manual E derivation) — blocklist `gate.ts §8.3` + regex anti-injection.
- **Sem indexed memory routing v1.1** (sub-docs por tópico). MEMORY.md cap 1 KB não precisa.
- **Sem graph edges genéricos v1.1.** YAGNI sem vector.

#### Schema (Migrations `0017` rename + `0018` schema) — ✅ PR-A + PR-B

- [ ] **`skills`** — id, agent_id (NULL = company-shared), company_id, name (unique per scope), body_path TEXT (aponta pra SKILL.md), description TEXT (L0 — entra no system prompt), version, applies_to_role TEXT NULL (engineer/designer/ceo/etc), source ENUM (`agent_created|derived_from_issue|derived_from_recovery|user_authored`), trust REAL (default 0.5), use_count, last_used, soft_deleted
- [ ] **`memories`** — id, agent_id (NULL = company-wide), company_id, applies_to_role TEXT NULL, kind ENUM (`identity|rule|preference|retrospective`), body TEXT, importance REAL, trust REAL, source_event_id INTEGER NULL (FK a `activity_events` quando derivada), created_at, last_accessed, access_count, soft_deleted, pinned (0/1)
- [ ] **`memories_fts`** — virtual FTS5(body), `content=memories`
- [ ] **`messages_fts`** — virtual FTS5 sobre `messages.content` (foundation pra `session_search` — separa da memória)
- [ ] **`skill_candidates`** — pending suggestions de triggers automáticos: id, agent_id, source_event_id, proposed_name, proposed_body, proposed_description, status (`pending|accepted|rejected`), reviewed_by, created_at. **Sempre passa por review** — extração automática nunca skipa human-in-the-loop.
- [ ] **Filesystem layout:**
  ```
  ~/.prospero/
  ├── user.md                          # USER.md global (1 KB cap)
  ├── companies/<id>/
  │   ├── memory.md                    # company-wide rules (1.5 KB cap)
  │   ├── skills/<name>/SKILL.md       # company-shared skills (role-scoped)
  │   └── agents/<agent_id>/
  │       ├── memory.md                # agent-specific (1 KB cap)
  │       └── skills/<name>/SKILL.md   # agent-private skills
  ```
- [ ] **Índices:** `(agent_id, soft_deleted, importance desc)`, `(company_id, applies_to_role)`, `(source_event_id)`, `(status)` em candidates

#### Auto-derivation pipeline (inflexão 2 — coração do M11)

- [ ] **Hook em `activity_events` writer** (M7.7): toda escrita verifica se action ∈ `{issue.done, agent.recovery, goal.achieved, user.correction}` → enqueue job de derivation.
- [ ] **Derivation worker** (in-process, async, throttled):
  - `issue.done` → lê histórico (comments + tool history + artifacts) → dedicated prompt → produz `skill_candidate` ou descarta. Modelo: Sonnet.
  - `agent.recovery_after_error` → lê últimos 5 turns antes + o turn que resolveu → propõe skill "como evitar X".
  - `goal.achieved` → CEO recebe trigger especial pra escrever retrospectiva → vira memory `kind='retrospective'` em company memory.
  - `user.correction` → heurística "user: not X, do Y" → propõe USER.md fragment.
- [ ] **Cost budgeting:** derivations contam contra cost budget normal (M8). Hard cap: max 3 derivations/dia/agente (configurável).
- [ ] **Review queue UI:** inbox kind `skill.candidate_pending` mostra proposta + Accept / Edit / Reject. **Nada vai direto pra `skills` sem review.** (Defense-in-depth: derivation é geração LLM, pode injetar.)

#### Role-based inheritance (inflexão 3)

- [ ] **`hire_agent` / `hire-from-ui` carrega skills + memories matching `applies_to_role`** no spawn:
  - Skill `applies_to_role='engineer' AND agent_id=NULL` → herda em todo engineer da company
  - Memory `kind='rule' AND applies_to_role='engineer'` → injeta em system prompt
- [ ] **UI surface "Org Learnings"** em `/dashboard` (M9 dep): card mostrando últimas 5 retrospectivas + skills compartilhadas top 10.
- [ ] **Quando agente é demitido (M7.6 terminate):**
  - Skills privados: modal "promover algum pra company-shared?" (lista com checkboxes)
  - Memórias privadas: cascade soft-delete com TTL 30 dias (user pode exportar antes)
  - Retrospectivas em company memory: ficam (são da org, não do indivíduo)

#### MCP tools (skills first — refletindo inflexão 1)

- [ ] **Skills (5 tools — surface principal):**
  - `skill_search(query, scope?)` → lista skills com L0 + body inline pra match. Hot path.
  - `skill_read(name)` → lê body completo (L1)
  - `skill_create({name, body, description, applies_to_role?})` → cria private skill. Body validado por size cap (16 KB) + sanitizer.
  - `skill_update(name, body)` → versiona (incrementa `version`)
  - `skill_promote(name)` → torna company-shared (requer aprovação do user via inbox)
- [ ] **Memory (4 tools — fallback only):**
  - `memory_read(scope?, kind?)` → lista entries
  - `memory_add({body, kind, importance?, applies_to_role?})` → adiciona. Rate limit max 3/turn (mais agressivo que skills — desestimular declarativa)
  - `memory_remove(id)` → soft-delete
  - `memory_search({query, scope?})` → FTS5 ranked
- [ ] **Session search (1 tool):**
  - `session_search(query, agent_id?, limit?)` → FTS5 sobre `messages.content`. Não confunde com memória.

#### System prompt injection

- [ ] **`composeSystemPrompt`** ampliado (foundation M7.5) com 4 novos slots em ordem:
  - USER.md global (~1 KB cap)
  - Company memory (~1.5 KB cap, inclui retrospectivas de Goals)
  - Agent MEMORY.md (~1 KB cap)
  - Skills L0 (do agente + inherited por role, ~4 KB cap → ~40 skills × 100 chars)
- [ ] **Hard cap total novo:** ~7.5 KB additional → target ≤ 5% token overhead (regra `feedback_token_efficiency`)
- [ ] **Skills L0 priorização:** sort por `use_count desc, trust desc` quando excede cap. Skills nunca-usados ficam por último.

#### Loop de aprendizagem

- [ ] **Auto-derivation (primário — inflexão 2):** já descrito acima. Dispara em `activity_events` sem o agente decidir.
- [ ] **Nudges manuais (fallback):** hook em `turn-complete` — se `tool_use_count > 5` E nenhuma derivation foi enfileirada nesse issue → emit `memory_nudge` no próximo turn. Mensagem: "Vale registrar um skill? Use `skill_create` se sim."
- [ ] **Compaction event** (M9 dep) → emit nudge com contexto resumido
- [ ] **Time-based fallback:** sessão > 30 turns sem nudge → emit
- [ ] **Trust feedback loop:** user thumb-up/down em skill ou memory → `±0.05 / −0.10` na trust score (asymétrico igual Hermes Holographic). Skills com trust < 0.2 não entram em L0 (load on-demand only).

#### Decay + maintenance

- [ ] **Decay** (open-session): `importance *= age_decay(90d) * access_boost(use_count)`. `kind='identity'` e `pinned=1` exemptos.
- [ ] **Pruning** soft-delete quando `importance < 0.1 AND last_accessed > 30d`. Auto-aviso UI antes.
- [ ] **Consolidation prompt** automático quando MEMORY.md > 90% cap (vai disparar mais cedo — cap de 1 KB é pequeno).

#### UI

- [ ] **Rota `/agents/:id` ganha tab "Learning" (4ª, além de Config/Issues/Stats):**
  - Sub-tab `Skills` — lista (agent-private + inherited company-shared marcados 🏢). Usage count + trust. Botão "Promote to company" pra privados. Click expand→L1 inline.
  - Sub-tab `Memory` — markdown view do MEMORY.md (read-only com toggle edit; usualmente derivado). Show source_event link quando aplicável.
  - Sub-tab `History` — search box FTS5 sobre `messages` do agente.
  - Sub-tab `Candidates` — fila de skill_candidates pendentes (Accept/Edit/Reject).
- [ ] **`/dashboard` ganha card "Org Learnings"** (M9 dep): últimas 5 retrospectivas + top 10 skills compartilhadas.
- [ ] **`/settings` ganha 2 seções:**
  - "USER.md global" — markdown editor + char counter + botão "Import from Claude Code memory"
  - "Derivation budget" — slider max derivations/dia/agente (default 3)
- [ ] **Header agent:** badge "🎓 N skills · K memories" link pra tab Learning.
- [ ] **Inbox kinds novos:**
  - `skill.candidate_pending` (actionable, Accept/Edit/Reject)
  - `skill.promotion_requested` (private → company-shared, user aprova)
  - `memory.review_needed` (decay vai expirar entries)
  - `goal.retrospective_ready` (M8.5 dep — Goal completou, CEO escreveu retrospectiva)

#### Activity events novos (consume M7.7 helper)

- [ ] `skill.created` (manual ou via candidate accept)
- [ ] `skill.derived` (system → candidate criado)
- [ ] `skill.promoted_to_company` (private → company-shared)
- [ ] `skill.invoked` (agent chamou `skill_read` — sinal de uso real)
- [ ] `memory.added`, `memory.removed`, `memory.expired`
- [ ] `memory.retrospective_generated` (Goal post-mortem)

#### Security

- [ ] **Sanitizer em todo write** (memory + skill, manual E derivation) — regex contra padrões de injection (`ignore previous`, `disregard instructions`, etc) + blocklist `gate.ts §8.3` aplicada a body
- [ ] **Derivation pipeline scan:** candidate_body passa por sanitizer **antes** de virar inbox item. Defense-in-depth — derivation é geração LLM, pode injetar.
- [ ] **Pinned entries (memory) e company-shared skills promovidos** ficam read-only pro agente — só user remove via UI
- [ ] **SECURITY.md atualizado** com seção "Memory + Skills as injection vectors" — threat model + mitigações + nota sobre derivation pipeline
- [ ] **Tests:** payload com injection patterns rejeitado em ambos paths (manual e derivation); pinned/promoted não podem ser overwritten

#### Erros & edge cases

- [ ] **Rate limit excedido:** tool retorna erro estruturado, agente vê na próxima leitura
- [ ] **Skill name collision (mesmo scope):** rejeitado com sugestão de suffix
- [ ] **MEMORY.md acima do cap:** write rejeitado, sistema gera nudge "consolidar"
- [ ] **Derivation falha (LLM timeout/erro):** drop silencioso + log. Não bloquear activity write.
- [ ] **Agente deletado:** dispara modal "promover skills privados?" + cascade soft-delete memórias com TTL 30 dias
- [ ] **Goal cancelled (M8.5):** sem retrospectiva (só `goal.achieved` dispara)
- [ ] **Importar Claude Code memory:** parser tolerante; preview antes de commitar

#### Testes

- [ ] Unit: sanitizer cobre todos casos de injection (manual + derivation paths)
- [ ] Unit: decay function isolada
- [ ] Unit: role-inheritance resolver (`applies_to_role` match)
- [ ] Unit: FTS5 ranking + LIMIT (memories + messages)
- [ ] Integration: `issue.done` → derivation worker → `skill_candidate` row → inbox event
- [ ] Integration: user accept skill_candidate → row em `skills` + activity event + system prompt do agente inclui L0
- [ ] Integration: `goal.achieved` → CEO turn especial → retrospective memory em company scope
- [ ] Integration: novo engineer hired → inherita skills company-shared role=engineer
- [ ] Integration: agente demitido → modal promote → restantes cascade soft-delete
- [ ] Performance: FTS5 com 10k messages + 1k memories, query < 50ms
- [ ] E2E: user accept candidate → reload app → próxima sessão do agente vê skill em L0

#### Não-regressão

- [ ] Token budget: overhead novo ≤ 5% baseline pós-M10 (regra dura `feedback_token_efficiency`)
- [ ] Cost budget: derivations não estouram budget diário (M8 enforcement aplica)
- [ ] Security suite verde
- [ ] M1-M10 features intactas
- [ ] Performance: app startup +200ms max

#### Documentação

- [ ] **`docs/memory-architecture.md`** — design final (sucessor do research doc)
- [ ] **`docs/skills-format.md`** — spec SKILL.md adaptado pro nosso contexto
- [ ] **`docs/derivation-pipeline.md`** — como `issue.done`/`agent.recovery`/`goal.achieved` viram learning
- [ ] **SECURITY.md** — seção "Memory + Skills threat model" incluindo derivation
- [ ] **README** — featurette "What's new in v1.1"

#### Out-of-scope M11 (postergado pra V2 Tier 2+)

- ❌ **Vector embeddings + semantic search** — custo + complexidade; FTS5 atende M11. Vector vira ponto de entrada do Knowledge Base RAG (V2 Tier 2).
- ❌ **Indexed memory routing** (sub-docs por tópico estilo Hermes #22612) — MEMORY.md cap 1 KB não precisa
- ❌ **Graph edges genéricos** (Updates/Contradicts/RelatedTo) — sem vector, valor marginal
- ❌ **Memory bulletin horário** (#346 §4) — wasteful em desktop offline-first
- ❌ **Identity evolution / self-model metacognition** (#10355 phase 3) — escopo muito grande
- ❌ **Dream consolidator offline** — sem background worker, complica
- ❌ **Skill hub remoto** (download de GitHub/NPM) — threat model (`feedback_security_priority`)
- ❌ **Honcho/Mem0/RetainDB providers** — cloud-only, viola `project_prospero`
- ❌ **Multi-user memory partitioning** — single-user explícito (ToS Anthropic Max)
- ❌ **AI memory reviewer (não-humano)** — **deferred pra V2 Tier 2.** Em M11, todo `skill_candidate` passa por review humano via inbox. Quando volume crescer (com Routines/Plays disparando muitos issues), humano vira gargalo. Próxima geração: agente revisor (Haiku, modelo barato) faz pré-filtro com confidence flag; humano só vê os duvidosos. Documentado aqui pra não esquecer.

**Custos:** 10-14 dias estimados (subiu de 8-12 por causa da derivation pipeline + role-inheritance — vale o gasto, é o diferencial). **Pré-req:** M10 (close v1), M8 (cost budget aplica em derivation), M8.5 (Goals → retrospectivas), M7.6 (terminate → modal promote skills). **Posição:** **V2 anchor** — primeira feature pós-v1, fundação pras outras apostas V2 (ver seção "Visão V2" abaixo).

---

### 🆕 M12 — Agent & Org Definition Layer — **V2, logo após o M11**

**Origem:** brainstorm 2026-05-15 — "por que os nossos agentes parecem mais burros e menos configuráveis que os do Paperclip, e como viramos uma máquina de criar 1-person business de qualquer ramo?". Doc de design completo em [docs/m12-agent-org-definition-layer.md](docs/m12-agent-org-definition-layer.md).

**O problema:** os 14 milestones do v1 construíram a máquina de orquestração — mas os agentes a dirigem com um manual de um parágrafo. `role_templates` shipam com prompts de 1-2 frases; a única instrução editável por agente é uma textarea. O agente tem as tools MCP, mas não tem o playbook: nada diz quando, como e com que padrão usar cada uma.

**Divisão M11 ↔ M12:** o M11 entrega a inteligência *aprendida* (memória, skills auto-derivadas, loop). O M12 entrega a inteligência *autorada* — o agente já nasce esperto no dia 1 e o usuário consegue moldá-lo a fundo, para **qualquer ramo de negócio**, não só software house. **Dependência:** a Peça 2 roda como skill bundled sobre a infra de skills do M11 — por isso o M12 vem depois.

#### 4 peças

1. **Autoria de papéis & organização** — estrutura universal de charter (8 seções) · `role_templates` vira biblioteca com CRUD + rota `/roles` · assistente de geração de charter (one-shot, org-aware) · **CEO arquiteto**: projeta o org chart inteiro a partir de "quero uma agência X", revisão estilo `GoalPlanReview`, contratação em massa · `AGENTS.md` carrega charters (org-as-code).
2. **Procedimento operacional** — contrato core conciso (preamble evoluído) + Manual Operacional como skill bundled (progressive disclosure), amarrando cada ação a uma tool MCP concreta.
3. **Instruções como dado** — bundle gerenciado multi-arquivo por agente em disco + aba **Instructions** (file-tree + editor); `composeSystemPrompt` passa a ler do disco.
4. **Runs · Budget · Run Policy** — tabela `agent_runs` + aba Runs · budget por agente (teto de tokens universal + USD para adapters API key; enforcement reusa o soft-stop do M8) · Run Policy consolida mode/always-on + permissões (`can_hire`, `can_assign`).

#### Decisões do brainstorm (2026-05-15)

- Escopo **camada completa** — as 4 peças, não só conteúdo.
- Budget = **tokens + USD** (tokens universal; USD quando o adapter é API key).
- Autoria até o nível **"CEO monta a empresa"** (não só papel a papel); blueprints de empresa ficam como fast-follow.
- Bundle de instruções **gerenciado, sem modo external** (apontar repo git fica backlog).
- Instruções **autoradas por humano**; aprendizado autônomo continua nos canais do M11 (sanitizer + review) — evita auto-reescrita do charter como vetor de injection.

**Faseamento:** ~6 PRs (A papéis+biblioteca · B procedimento operacional · C storage+aba Instructions · D geração+CEO-arquiteto · E Runs+Budget+Run Policy · F IA das abas+docs).

**Custos:** ~18-24 dias estimados. **Pré-req:** M11 (infra de skills). **Posição:** V2, logo após o M11, antes das apostas V2 Tier 1 — agente bem-instruído fortalece Workflow Plays e Enforced Outcomes.

---

## 🎯 Visão V2 — "1-Person Business"

> **Tese:** V2 muda a natureza do produto. V1 entrega "um time de IA que você gerencia via chat". V2 vira "**delegação de outcomes que você só revisa**" — você abre o app uma vez por dia pra olhar o que rodou enquanto dormia, não 20× pra empurrar trabalho. **Persona-alvo: qualquer pessoa que queira criar um 1-person business** apoiada numa empresa de agentes que aprende com a experiência.

**Definida em 2026-05-14** após brainstorm V2. Decisão estratégica: M11 (memory) deixa de ser "primeira feature de v1.1" e vira **âncora da V2** — sem memory bidirecional (3 camadas × 2 níveis), as outras apostas V2 viram features estáticas que não compoundam.

### Sequência V2 (M11 = âncora, 3 apostas Tier 1 apoiam-se nele)

| Ordem | Aposta | Custo | Pré-req | Por que aqui |
|---|---|---|---|---|
| **V2.0** | **M11 — Agent Memory & Learning Loop** | 10-14d | M10 | **Fundação.** 3 camadas Hermes (declarativa/procedural/episódica) × 2 níveis (individual/coletivo). Fluxo bidirecional: descendente via inheritance (`hire_agent` carrega skills + memories role-scoped), ascendente via `skill_promote` + `memory_add({applies_to_role})` + retrospectivas CEO em `goal.achieved`. Sem isso, Tier 1 vira estático. |
| **V2.1** | **M12 — Agent & Org Definition Layer** | ~18-24d | M11 | Inteligência *autorada*: charters ricos (8 seções) + Manual Operacional + editor multi-arquivo de instruções + autoria de organização (CEO projeta a empresa de qualquer ramo). M11 entrega o agente que *aprende*; M12, o que já *nasce esperto*. Fortalece Plays e Enforced Outcomes. Ver [docs/m12-agent-org-definition-layer.md](docs/m12-agent-org-definition-layer.md). |
| **V2 Tier 1** | **Enforced Outcomes** — `done` que significa `done` | 8-10d | M11 | Solo founder não consegue revisar 50 saídas/dia. Issue só passa pra `done` após quality gates executáveis (tests/build/lint/bench). Skills M11 carregam "como rodar gate X". Falha → vira sub-issue automática. |
| **V2 Tier 1** | **Routines** — agentes que acordam sozinhos | 5-7d | M11 | Pra 1 pessoa, leverage assíncrono É o produto. Cron-like + smart triggers (M11 enriquece com padrões aprendidos pra disparar follow-ups inteligentes). |
| **V2 Tier 1** | **Workflow Plays** — playbooks pré-prontos pro CEO | 6-8d | M11 + M8.5 | Mata cold-start. CEO escolhe play ("Migrar auth", "Investigar incidente prod", "Lançar feature X com tests") → spawna agentes + issues + gates pré-configurados. Evolui com retrospectivas que CEO grava em company memory. |

### V2 Tier 2 (v2.1+, ordem TBD)

- **AI memory reviewer** — pré-filtro com confidence flag pra `skill_candidate`. Humano só revisa os duvidosos. Crítico quando volume crescer (Routines + Plays geram muitos issues, derivation pipeline lota inbox).
- **Adapter ecosystem** — Cursor / Codex / Gemini / OpenClaw como peers (M7.5 já tem foundation, M10 traz primeiro adapter remoto). 4-6d por adapter. Mata lock-in mas é gourmet enquanto gargalo é orquestração.
- **Knowledge Base RAG** — vector embeddings sobre repo / docs / ADRs / PRs antigos. Extensão tardia do M11 (memory cobre "agente sabe do projeto"; RAG cobre conteúdo histórico fora dele). Ponto onde vector finalmente faz sentido.
- **Async + Trust governance** — fechar dívida M5: auto mode 24h timeout + smart escalation (auto pra Read/Search, supervised pra Bash/Write, auto-degrada se padrão suspeito). Sem isso V2 fica capada — você quer delegar mas continua sendo paged 50× ao dia.

### O que NÃO vai pra V2

- ❌ **Multi-user** — bloqueado por ToS Anthropic Max.
- ❌ **Web app / cloud hosting** — out-of-scope explícito; mudaria o produto.
- ❌ **Self-Organization** (agentes reorganizando hierarquia entre si) — valor prático baixo, risco emergente alto.
- ❌ **MAXIMIZER MODE sozinho** — só faz sentido acoplado a Enforced Outcomes.
- ❌ **Plugin SDK completo** — comunidade construirá via skills + MCP servers existentes; SDK próprio é big arch change pra pouco retorno.

### Custo total estimado V2 (M11 + M12 + Tier 1)

| Bloco | Custo |
|---|---|
| M11 (âncora) | 10-14d |
| M12 (Agent & Org Definition Layer) | 18-24d |
| Enforced Outcomes | 8-10d |
| Routines | 5-7d |
| Workflow Plays | 6-8d |
| **Total V2 core** | **~47-63 dias trabalho contínuo** |

V2 Tier 2 (AI reviewer + adapters + RAG + governance) adiciona +20-30d, mas pode shippar como v2.1/v2.2 incrementais.

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
| **Easy AGENTS.md configurations** | ✅ Completo (PR-F.2.2) | Format próprio (YAML front-matter) com `gray-matter` + zod. Import com conflict resolution per-agent; export filtra terminados/arquivados |
| **companies.sh — import/export** | ✅ Completo (PR-F.1 + PR-F.2.1) | JSON único (não ZIP) — schemaVersion 1, import com FK remap |
| **Agent Reviews and Approvals** | 🔄 M7.5 + M9 | M7.5: schema `approvals` decoupled. M9: PR-style diff side-by-side + inline comments |
| **Work Products / Artifacts** | 🔄 M7.5 | Tabela `issue_artifacts` (kind: file_path, commit_sha, pr_url, snapshot) |
| **Issue identifier humano** (`PRJ-123`) | 🔄 M7.5 | Migration 0004 — UX win trivial |
| **Dashboard rico** (Recent Activity + Active Agents + Metric Cards) | 🔄 M9 | Consome `activity_events` do M7.7 |
| **Runs timeline por agente** | 🆕 Planejado | M7.6 — modal full-screen derivado de `messages` |
| **Scheduled Routines** | 🆕 v2+ | Routines — cron-like recurring tasks |
| **Plugin system** | 🆕 v2+ | Knowledge base / custom tracing / queues como sub-features. Big architectural change |
| **Get OpenClaw / claw-style agent employees** | 🆕 v2+ | Marketplace/template-store de agent personas (extensão do `role_templates`) |
| **Memory / Knowledge** | 🆕 M11 | Per-agent `MEMORY.md` + skills procedurais auto-criados + FTS5 session search + nudges em turn-complete. Inspirado em [Hermes Agent](docs/hermes-memory-learning-system.md). Vector embeddings ficam v1.2. |
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

Tudo daqui pra baixo é post-v1. Organizado por tema. **Sequência V2 priorizada** está na seção "[Visão V2 — 1-Person Business](#-visão-v2--1-person-business)" acima — esta tabela é o catálogo bruto por área. Origens marcadas com [PC] = Paperclip comparison, [M5] = débito M5, [novo] = nasce aqui.

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

- ~~**Memory / Knowledge base**~~ [PC] — **movido pra M11** (Agent Memory & Learning Loop, inspirado em Hermes Agent). Vector embeddings ficam pendentes pra v1.2.
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
