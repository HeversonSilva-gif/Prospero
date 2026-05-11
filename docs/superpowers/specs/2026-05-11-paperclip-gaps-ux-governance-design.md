# Paperclip Gaps — UX & Governance (M7.6 + M8.5)

> **Data:** 2026-05-11
> **Tipo:** Design doc / gap analysis
> **Origem:** uso real do Paperclip pelo Heverson + decisão de absorver liberdade de mexer em agentes e Goals com plano-gerado-pelo-CEO.
> **Relação:** complementa [paperclip-comparison.md](../../paperclip-comparison.md) (técnica/ampla) com lente de **UX/governance**. Não substitui — vira input pros novos milestones M7.6 e M8.5.
> **Memória:** [reference_paperclip](../../../../C:/Users/hever/.claude/projects/D--Projetos-pessoais-DashboardAgent/memory/reference_paperclip.md) · [project_m7_progress](../../../../C:/Users/hever/.claude/projects/D--Projetos-pessoais-DashboardAgent/memory/project_m7_progress.md)

---

## TL;DR

Após usar o Paperclip o usuário identificou **três classes de gap** que o roadmap atual não cobre com a prioridade certa:

1. **Liberdade de mexer no agente direto pela UI** — hoje a maior parte passa pelo CEO via MCP. M7-C **já entregou** parte (right panel, edit role/model/persona/projects + IPC handlers). Faltam: reports_to UI, skills toggle, mode, always_on, **ações stateful** (Pause/Fire/Assign Task/wake-up), Runs timeline, form de criação.
2. **Goals como feature first-class com CEO-planner automático** — usuário define objetivo, o CEO lê, **propõe plano completo** (issues + agents a contratar + tempo + custo), usuário aprova em formato PR-review.
3. **Interface menos limitante** em geral — completar handlers IPC ausentes, expor ações no UI, permitir criação de agente sem mediação de CEO, edição de persona não-disruptiva (banner + restart-now button).

Esses três viram **dois milestones novos** (M7.6 Agent Studio + M8.5 Goals/CEO Planning) inseridos depois do M7-C + M7.5 + M8. O chat-first do produto **permanece intacto** — Paperclip-style tab full-page é rejeitado.

**Importante:** Goals + CEO-planner é uma **evolução além do Paperclip**. Lá, goals são puramente declarativos (sem automação). A geração automática do plano é diferenciador nosso.

**Importante 2:** após inspeção atualizada do código (commits M7-C `3aa5861`..`8b9d9c3` em master), o escopo de M7.6 reduziu de 6-8 dias pra 4-5 dias. M7-C entregou o panel base + 5 IPC handlers + edit inline de persona/model/role.

---

## Contexto do que já temos

### M1–M6 (mergeado)
Foundation, OAuth, orchestrator com claude CLI streaming, MCP server interno, sandbox + permissions, multi-agent router, Issues+Projects CRUD com kanban. Ver [ROADMAP.md](../../../ROADMAP.md) §Milestones fechados.

### M7 em curso
- **PR-A ✅:** model selection per-agent + `agents.model` + UI default global no Settings.
- **PR-B ✅:** roles + skills hard-gate via `--allowedTools`. Rota `/skills` read-only.
- **PR-C ⏳:** org chart `/org` + right panel inicial em `/agents/:id`.

### M7.5 (planejado)
Refatorações estruturais + adapter pattern + migrations (issue identifier humano, messages.kind, approvals decoupled, issue_artifacts) + auth-mode abstraction + UX polish (current action granular, granular IPC events) + E2E setup.

### M8 (planejado)
Costs UI + token tracking + soft-stop at turn-complete. **Pré-requisito de M8.5** (Goals dependem de cost-estimation pra mostrar `estimated_cost_cents` no plano).

### M9 / M10 (planejado)
Dashboard widgets + multi-empresa + AGENTS.md + companies.sh + Reviews UX + API key (M9). VPS Docker remote adapter (M10).

---

## Estado atual da UI de agentes (gaps observados)

Verificado por inspeção do código atual em master (commits M7-C recentes — `3aa5861`..`8b9d9c3`):

**Importante:** M7-C **já entregou** uma boa parte do que originalmente seria M7.6. A análise inicial subestimou o estado atual. Tabela corrigida:

| Capacidade | Hoje | Onde / Como |
|---|---|---|
| Editar persona/system_prompt inline | ✅ **M7-C** | `ConfigTab` textarea com debounced save 500ms |
| Trocar model do agente | ✅ **M7-C** | `ConfigTab` dropdown preset + custom + regex |
| Trocar role (template) | ✅ **M7-C** | `ChangeRoleModal` com preserve-model option |
| Toggle allowed_projects per-agent | ✅ **M7-C** | `AgentProjectsEditor` no ConfigTab |
| Ver issues atribuídas | ✅ **M7-C** | `IssuesTab` no right panel |
| Ver stats (tokens/runs) | 🟡 **M7-C parcial** | `StatsTab` existe — dados reais dependem M8 |
| IPC handlers `agents:set-model/set-role/set-system-prompt/set-reports-to/stats` | ✅ **M7-C** | `apps/main/src/ipc/agents-handlers.ts` |
| Trocar reports_to | 🟡 **M7-C parcial** | IPC + store prontos, **mas SEM UI** ainda |
| Toggle skills per-agent | ❌ Display only | `ConfigTab` mostra chips read-only |
| Trocar mode (supervised/auto) | ❌ Sem UI | Coluna existe, IPC não |
| Toggle always_on | ❌ Sem UI | Coluna existe, IPC não |
| Pausar agente (retomável) | ❌ Conceito não existe | Status enum não tem `paused` |
| Demitir agente | ❌ Sem botão UI | Só via CEO `fire_agent` MCP. Sem status `terminated` |
| Criar agente direto pela UI | ❌ Sem form UI | Só via `createDemo` ou CEO `hire_agent` |
| Assign Task button (atalho) | ❌ Sem UI | User vai pro `/issues` e cria manual |
| Manual run / wake-up button | ❌ Conceito não existe | Streaming arch não tem |
| Ver runs/turns como timeline | ❌ Sem UI | Dado existe em `messages` |
| Header sticky com status + ações | ❌ Sem UI | Status badge fica só no sidebar |
| Org chart `/org` | ❌ Não iniciado | Rota planejada em M7-C PR-C |
| Goals + CEO planning | ❌ Inexistente | Item v2+ no roadmap atual |

**Conclusão revisada:** o panel + IPC layer + edição básica de persona/model/role/projects **já existe**. Os gaps remanescentes são (a) **ações stateful** (pause/terminate/assign-task/wake-up), (b) **edição de fields que ainda não têm UI** (reports_to, skills, mode, always_on), (c) **form de criação direta**, (d) **runs timeline**, e (e) **org chart**. Mais magro que minha estimativa inicial.

---

## Seção 1 — Agent Studio (M7.6) — completion sobre M7-C

### Base já existente

M7-C entregou layout chat-first híbrido funcional:

```
┌─────────────────────────────────────────────────────────────┐
│  Chat / Delegations tabs                       │  Config    │  ← right panel já existe
│  MessageList + Composer                        │  Issues    │     (3 tabs)
│                                                │  Stats     │
│                                                │            │
│                                                │  ConfigTab:│
│                                                │  • role    │
│                                                │  • model   │
│                                                │  • skills (display) │
│                                                │  • persona (inline) │
│                                                │  • projects (toggle)│
└────────────────────────────────────────────────┴────────────┘
```

**M7.6 completa esse layout com:**
- **Header sticky** acima do chat com: status badge + Pause toggle + Assign Task button + `⋯` menu (Fire, Reset session, Copy Agent ID)
- **ConfigTab ganha:** dropdown `reports_to`, **skills toggle** (não só display), `mode` radio, `always_on` switch
- **Schedule sub-section** no ConfigTab ou tab nova: Always-on + Manual trigger button
- **Modal full-screen** opcional pra Instructions editor markdown (atualmente é textarea simples — basta pra MVP, modal full vira polish)
- **Modal full-screen** pra Runs timeline (novo)
- **Form `/agents/new`** pra criação direta pela UI

**Por que híbrido (não Paperclip 1:1):**
- Nosso chat é diferencial (usuário confirmou). Não pode virar uma de 6 tabs.
- Right panel já cobre toggles rápidos.
- Modal full-screen reserva real estate só pros editores complexos.
- Ações destrutivas (Fire) ficam no `⋯` menu — não-acidentais por design.

### 1.1 Header de ações (sticky)

**Componentes:** `apps/renderer/src/routes/Agent.tsx` ganha header novo.

| Elemento | Comportamento |
|---|---|
| **Status badge** | Lê `agents.status` + `currentAction`. Cores: idle/thinking/working/waiting/error/**paused** (novo). |
| **`▶ Pause` toggle** | Click → IPC `agents:pause(id)` ou `agents:resume(id)`. Quando paused: badge muda, ícone vira `⏸`. Router não enfileira pra agente paused (mensagens ficam em backlog). |
| **`+ Assign Task` button** | Abre `IssueCreateModal` pré-preenchido com `assignee_agent_id = current`. Cria issue e fica no kanban como qualquer outra. |
| **`⋯` overflow menu** | Items: `Copy Agent ID`, `Reset Session` (limpa `--resume` checkpoint), **`Terminate`** (confirm modal). Estilo Paperclip — destrutivos atrás de 1 click extra. |

### 1.2 Right panel — 3 tabs leves

**Componente:** `apps/renderer/src/components/AgentRightPanel.tsx` (novo).

#### Tab Configuration — ADIÇÕES sobre M7-C

Base atual (M7-C): role, model, persona inline, allowed projects, skills display read-only.

**Faltam adicionar:**
- **Reports to** (dropdown lista agents da company exceto si próprio + descendentes) — IPC `agents:set-reports-to` (já existe), cycle-detection já no repo
- **Mode** (radio supervised | auto) — **novo** IPC `agents:set-mode` + handler + repo method
- **Always-on** (switch) — **novo** IPC `agents:set-always-on` + handler + repo method
- **Skills** (checkboxes do catálogo, com required/optional segregadas como Paperclip — required vem do role template e fica disabled) — **novo** IPC `agents:set-skills` + handler + repo method

Manter padrão M7-C: debounced auto-save (500ms), banner inline pra erros, mensagem `personaSavedAt` style pra feedback.

#### Tab Stats (existe, expandir)
Atual (M7-C): tem `StatsTab` mas verificar quais campos. **Expandir com:**
- **Tokens consumidos** (input + output + cache) — agregado de `costs_log` (M8 alimenta)
- **Runs count** — `SELECT count(*) FROM messages WHERE agent_id = ? AND role = 'assistant' AND turn_complete IS NOT NULL`
- **Last active** — relative time
- **Custo estimado mês corrente** (USD/BRL/% Max) — depende M8

#### Tab Issues (existe — não mexer)
Atual (M7-C): IssuesTab lista issues atribuídas. Manter.

#### Schedule (NOVO — adicionar como sub-section em ConfigTab ou nova 4ª tab)
- **Always-on** (switch — duplica Config; user-friendly aqui)
- **Manual trigger** button = `agents:wake-up(id, reason)` — força um turn no chat com mensagem system "User requested manual run". Equivale ao Paperclip `Run Heartbeat` adaptado pra nossa arch.
- *(v2)*: cron-like routines.

**Decisão de UI:** colocar Schedule como sub-section dentro do ConfigTab (mais simples) OU criar 4ª tab. Recomendo **sub-section** pra evitar fragmentação — tab nova só se Schedule crescer.

### 1.3 Instructions editor — atual e evolução

**Estado M7-C:** textarea inline com debounced save 500ms via IPC `agents:set-system-prompt`. **Funciona.**

**Polish M7.6 (opcional):**
- Botão "Expand to full screen" abre modal com mesmo textarea em viewport maior — útil pra personas longas.
- Banner "Mudança aplica no próximo turn. [Restart agent now] pra aplicar agora" — Restart = kill+respawn preservando `--resume`. Sem o banner hoje a UX é silenciosa.
- *(v2 opcional)* upgrade pra markdown editor com preview (`@uiw/react-md-editor`) — só se demanda real.

**File tree (Paperclip):** explicitamente **fora** do M7.6. MVP single-file é suficiente.

### 1.4 Runs modal (full-screen, read-only)

**Componente:** `apps/renderer/src/components/AgentRunsModal.tsx` (novo).

Timeline derivada de `messages` (`role='assistant'` + tool calls):
- Cada "run" = `session-init` → `turn-complete`
- Colunas: timestamp · trigger (user/agent name) · tools chamadas (badges) · tokens (in/out/cache) · duração · status (success/error/partial)
- Click numa run → expand pra ver transcript daquele turn isolado
- Filtros: date range, trigger source, status
- Botão "Reset session" inline igual o ⋯ menu

### 1.5 Form `/agents/new`

**Componente:** `apps/renderer/src/routes/AgentNew.tsx` (novo).

Form com:
- **Name** (required, autofocus)
- **Role template** (dropdown de `role_templates` com cards visuais)
- **Title** (optional)
- **Reports to** (dropdown — disabled se primeiro agente da company, força CEO)
- **Model** (preset dropdown, default vem do template ou settings global)
- **Mode** (radio, default supervised)
- **Persona** (textarea markdown, prefilled com `role_template.default_persona`)
- **Skills** (checkboxes, prefilled com `role_template.default_skills`)
- **Allowed projects** (chip toggles, todos selecionados default)

Submit → IPC `agents:hire-from-ui(payload)` → mesma trans do `hire_agent` MCP (reusa código). Sucesso navega pra `/agents/:newId`.

**Importante:** CEO continua podendo contratar via MCP (caminho 1) E user via UI (caminho 2). Não desligar nenhum dos dois.

### 1.6 Status enum + migration

**Migration 0008** (numeração depende de M7.5 ocupar 0004–0007):
```sql
-- Adicionar 'paused' e 'terminated' ao enum de status
-- SQLite não tem CHECK enum, é só string column — adicionar coluna terminated_at
ALTER TABLE agents ADD COLUMN terminated_at INTEGER NULL;
ALTER TABLE agents ADD COLUMN paused_at INTEGER NULL;
ALTER TABLE agents ADD COLUMN pause_reason TEXT NULL;

-- Migrate: agents com status 'fired' (se houver) → terminated_at = now
UPDATE agents SET terminated_at = strftime('%s', 'now') * 1000 WHERE status = 'fired';
```

Sandbox lifecycle:
- `paused`: processo claude **fica vivo**, router não enfileira mensagens novas. Resume → drena queue.
- `terminated`: processo claude killed, row do agente fica (soft delete) com `terminated_at != NULL`. UI esconde de listas default. Histórico de mensagens preservado.

### 1.7 IPC handlers — feito e a fazer

**Já em master (M7-C):**
- `agents:set-model`
- `agents:set-role`
- `agents:set-system-prompt`
- `agents:set-reports-to`
- `agents:fetch-stats`

**A adicionar em M7.6:**
- `agents:set-mode`
- `agents:set-always-on`
- `agents:set-skills`
- `agents:pause` / `agents:resume`
- `agents:terminate` (soft delete, status `terminated`, `terminated_at = now`)
- `agents:wake-up` (manual trigger)
- `agents:hire-from-ui` (criação via form)
- `agents:reset-session` (limpa `--resume` checkpoint do CLAUDE_CONFIG_DIR)

Cada handler novo segue padrão M7-C: valida token, escreve no DB, emite `AGENT_EVENT` broadcast pra renderer re-render. Cycle-detection pro `setReportsTo` já está no repo.

### 1.8 Testes M7.6

- Unit: repository methods novos (setModel, pause, resume, terminate)
- Unit: validação de payload do hire-from-ui (Zod schema compartilhado com `hire_agent` MCP)
- Integration: pause → mensagem fica em backlog → resume drena
- Integration: terminate → processo killed, status persistido, agente some da lista active
- Regression-guard: token leak, sandbox escape, fence file (não regredir)

### 1.9 i18n M7.6

Cada string nova em PT-BR + EN-US em `apps/renderer/src/i18n/{ptBR,enUS}/agent.ts` (file existe). Regra dura — sem hardcoded strings.

### 1.10 Custos M7.6 (revisado pós-inspeção M7-C)

Estimativa: **~4–5 dias** (era 6–8; reduziu porque M7-C já entregou panel base + 5 IPC handlers).
- Header sticky com status + 3 botões (Pause/Assign Task/⋯ menu): 1 dia
- Faltantes no ConfigTab (reports_to dropdown + skills toggle + mode radio + always_on switch + 4 IPC handlers novos): 1 dia
- Pause/Terminate + Migration 0008 + cycle no router: 1 dia
- Wake-up + reset-session + Assign Task modal: 0.5 dia
- Form `/agents/new`: 0.5 dia
- Runs timeline modal: 1 dia
- Testes + i18n + polish: 1 dia

---

## Seção 2 — Goals + CEO Planning (M8.5)

### 2.1 Por que é evolução além do Paperclip

Paperclip Goals (verificado em `D:/tmp/paperclip`):
- Tabela `goals` simples: title, description, level enum, status enum, parentId, ownerAgentId.
- Issue.goalId opcional.
- **Sem CEO-planner.** Goals são container declarativo — orquestrador externo decompõe manualmente.

**O que a gente adiciona:** quando user cria Goal e clica "Ask CEO to plan", o CEO **lê o goal** e **propõe um plano estruturado** com agents a contratar, issues a criar, dependências, estimates. User aprova em UI PR-review-style; aprovação dispara execução automática (hire + create issues).

### 2.2 Schema

**Migration M8.5-01** (numeração após M8):

```sql
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'task',  -- company | team | agent | task
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft | planning | proposed | approved | in_progress | achieved | cancelled
  parent_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  owner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  budget_max_tokens INTEGER,
  deadline INTEGER,  -- unix ms
  success_criteria TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_goals_company ON goals(company_id);
CREATE INDEX idx_goals_parent ON goals(parent_goal_id);
CREATE INDEX idx_goals_status ON goals(status);

CREATE TABLE goal_plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,  -- 1, 2, 3... incrementa em re-propose
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  agents_to_hire_json TEXT NOT NULL,  -- JSON array
  issues_to_create_json TEXT NOT NULL,  -- JSON array
  estimated_total_tokens INTEGER,
  estimated_duration_days INTEGER,
  estimated_cost_cents INTEGER,
  risks_json TEXT,  -- JSON array
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed | approved | rejected | superseded
  user_feedback TEXT,
  proposed_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT  -- 'user' | agent_id (se v2 permitir CEO auto-approve)
);

CREATE INDEX idx_goal_plans_goal ON goal_plans(goal_id);
CREATE UNIQUE INDEX idx_goal_plans_goal_version ON goal_plans(goal_id, version);

ALTER TABLE issues ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX idx_issues_goal ON issues(goal_id);
```

**Estruturas JSON em `goal_plans`:**

```ts
type AgentToHire = {
  index: number;  // pra issues.depends_on referenciar por index
  name: string;
  role_template_id: string;
  model: string;  // preset key
  persona_summary: string;  // 1-2 frases — sistema gera full prompt
  skills: string[];
  reports_to_index: number | 'CEO';  // index dentro do array OU 'CEO' literal
  rationale: string;  // why this agent
};

type IssueToCreate = {
  index: number;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee_index: number | 'CEO';  // index no agents_to_hire ou CEO
  estimated_tokens: number;
  depends_on_indexes: number[];  // depende de outras issues do plano
  rationale: string;
};

type Risk = {
  description: string;
  mitigation: string;
  severity: 'low' | 'medium' | 'high';
};
```

### 2.3 Fluxo end-to-end

```
1. User cria Goal em /goals/new
     → status='draft', sem plano associado
     
2. User clica "Ask CEO to plan" no /goals/:id
     → goal.status='planning'
     → orchestrator delivery especial pro CEO: system message
        "GOAL_PLAN_REQUEST: id={goalId}, title=..., description=...,
         level=..., deadline=..., budget_max_tokens=...
         Please read carefully and call submit_goal_plan with a complete plan."
     → CEO entra em turn dedicado (não interrompe chat normal — fila separada ou prefixo claro)

3. CEO chama MCP tool submit_goal_plan(goal_id, plan_data)
     → INSERT em goal_plans com version=1, status='proposed'
     → UPDATE goals SET status='proposed'
     → inbox kind='goal_proposed' (link pro /goals/:id)

4. User abre /goals/:id, vê plano em PR-review UI:
     [Summary markdown]
     [Agents to hire — N cards com checkboxes "include"]
     [Issues to create — N cards com dependências visuais]
     [Estimates panel — tokens, USD/BRL, dias, % Max budget]
     [Risks accordion]
     [BUTTONS: Approve & Execute | Request Changes | Reject]
     
5a. Approve & Execute:
     → backend trans atômica:
        - cria agents (resolvendo reports_to_index → reports_to_id)
        - cria issues (resolvendo assignee/depends_on)
        - UPDATE goals SET status='in_progress'
        - UPDATE goal_plans SET status='approved', decided_at=now, decided_by='user'
     → CEO recebe message "Plan approved and executed. Agents hired: [list]. Issues created: [list]."
     → inbox kind='goal_executing'

5b. Request Changes:
     → modal: "What should change?" → free text
     → goal_plans atual: status='superseded'
     → goal.status='planning'
     → CEO recebe message com feedback estruturado, espera submit_goal_plan version=2

5c. Reject:
     → goal.status='cancelled'
     → goal_plans atual: status='rejected', user_feedback=optional reason
     → CEO recebe message "Plan rejected. Goal cancelled."
```

### 2.4 Novas MCP tools

Em `apps/main/src/mcp/tools/goals.ts` (modularização do M7.5 já cobre estrutura):

```ts
list_goals(company_id?, status?)  → Goal[]
get_goal(id)                       → Goal & {current_plan: GoalPlan | null}
submit_goal_plan(goal_id, plan)    → {plan_id, version}
update_goal_status(id, status, reason?)  → Goal
record_subgoal(parent_id, ...)     → Goal (atalho — CEO pode criar sub-goals durante exec)
```

Validação Zod estrita do `plan` payload (rejeitar se index dangling, deps cyclic, model fora dos presets, etc).

### 2.5 System prompt do CEO

Adiciona bloco no `composeSystemPrompt` (foundation do M7.5):

```
## Goals & Planning

Quando você recebe um GOAL_PLAN_REQUEST do orquestrador, sua tarefa é:

1. Ler o goal completo (title, description, deadline, budget_max_tokens, success_criteria).
2. Decompor em:
   - Agents necessários (use list_role_templates pra ver opções)
   - Issues acionáveis com dependências claras
3. Estimar custos baseado em histórico (use list_recent_costs se disponível).
4. Identificar riscos.
5. Chamar submit_goal_plan com payload estruturado.

Princípios:
- Prefira reutilizar agents existentes (use list_agents primeiro).
- Defina dependências entre issues quando ordem importa.
- Estimates conservadores — melhor over-estimar que travar budget.
- Riscos: liste 2-5 com mitigation realista.

NÃO chame hire_agent ou create_issue diretamente nesse turn — só
submit_goal_plan. A execução fica gated pela aprovação do usuário.
```

### 2.6 UI

#### `/goals` — lista (tree)

`apps/renderer/src/routes/Goals.tsx`:
- Tree visual recursiva (parent → children) — parecido com Paperclip GoalTree mas sem overhead deles
- Status badges
- Click goal → `/goals/:id`
- Button "New Goal" → `/goals/new`

#### `/goals/:id` — detail

`apps/renderer/src/routes/GoalDetail.tsx`:
- Header: title (edit inline), status badge, level, deadline, owner
- Description (markdown render + edit inline)
- Properties panel direita: status pickers, parent, owner
- Tabs:
  - **Plan** (default) — se houver plan ativo, PR-review UI; se não, button "Ask CEO to plan"
  - **Sub-goals** — tree de children
  - **Linked issues** — issues com `goal_id = this`
  - **History** — versões anteriores de plans (superseded/rejected) read-only

#### Componente `GoalPlanReview`

`apps/renderer/src/components/GoalPlanReview.tsx`:
- **Summary card** (markdown rendered)
- **Agents section** com lista de cards, cada um com:
  - Avatar + name + role template + model
  - Persona summary
  - Skills chips
  - "Reports to: {name|CEO}"
  - Rationale (collapsible)
  - Checkbox "Include in execution" (default ON; user pode desmarcar pra pular)
- **Issues section** com lista de cards:
  - Title + priority badge
  - Description (collapsible)
  - Assignee preview (chip)
  - Depends-on visual (mini graph ou texto "depends on #1, #3")
  - Estimated tokens
  - Checkbox "Include"
- **Estimates panel** sticky:
  - Total tokens
  - Estimated cost USD/BRL (usa rate do M8)
  - Duration days
  - % do budget Max
- **Risks accordion**
- **Action buttons:** `Approve & Execute` (primary) / `Request Changes` (modal) / `Reject` (destructive style)

#### Inbox kinds novos

- `goal_proposed` — CEO submeteu plano
- `goal_executing` — user aprovou, execução começou
- `goal_blocked` — execução falhou parcialmente (rare; rollback?)

### 2.7 Erros e edge cases

- **Plan executor falha em meio caminho** (ex: 1 dos N hires erra): trans não-atômica = ruim. Decisão: **trans atômica** (better-sqlite3 suporta). Se falhar, rollback completo + inbox `goal_error` com detail. User pode tentar de novo após CEO ajustar plan.
- **User edita plan inline antes de approve:** v1 MVP **não suporta** — só include/exclude checkboxes. v2 permite editar texto. Documentar como limitação.
- **CEO tenta `submit_goal_plan` sem ter recebido GOAL_PLAN_REQUEST:** tool valida `goal.status='planning'` antes de aceitar. Se status diferente, retorna erro.
- **User cria goal sem dar "Ask CEO to plan":** goal fica em `draft`. Sem plan, sem inbox. User pode deletar ou pedir plan depois.
- **Sub-goals com parent em status `cancelled`:** v1 não cascateia. Sub-goal fica órfão semanticamente mas funcional. Validar at UI level (warning).
- **Plan version > 1 (re-propose):** versão anterior fica `superseded` no DB, history tab mostra. Não deleta nada.

### 2.8 Dependências entre milestones

- **M8.5 depende de M8** (cost tracking) — sem `costs_log` preenchido, estimates ficam simbólicas. Implementável sem M8 mas degradado.
- **M8.5 depende de M7.5** (system prompt composable) — bloco de Goals plug-in limpo no prompt.
- **M8.5 depende parcialmente de M7.6** (Agent Studio) — execução de plan chama o mesmo path de `agents:hire-from-ui` que M7.6 implementa. Sem M7.6, executor chama trans direta do `hire_agent` MCP (sub-ótimo mas funciona).

Ordem ideal: M7.6 → M8 → M8.5. Pode reordenar M7.6 ↔ M8 se preferir.

### 2.9 Testes M8.5

- Unit: schema validation do plan payload (Zod, exhaustive cases)
- Unit: resolver de `reports_to_index` e `depends_on_indexes`
- Integration: GOAL_PLAN_REQUEST → CEO turn → `submit_goal_plan` → DB row criada
- Integration: approve flow → agents criados + issues criadas + status correto
- Integration: request-changes flow → versão nova
- Integration: rollback on partial failure
- E2E (Playwright): user cria goal → ask CEO → approve → vê agents na sidebar + issues no kanban

### 2.10 Custos M8.5

Estimativa: ~10–12 dias.
- Schema + migration + repo: 1.5 dias
- MCP tools + Zod schemas: 1.5 dias
- System prompt update: 0.5 dia
- Executor (approve flow): 2 dias
- UI lista + detail + history: 2 dias
- `GoalPlanReview` component: 2 dias
- Inbox kinds + handlers: 0.5 dia
- Testes + i18n: 1.5 dias
- Polish: 0.5 dia

---

## Seção 3 — UI menos limitante (cross-cutting)

Itens que não fecham seção própria mas atravessam M7.6/M8.5/M9. Lista pra não esquecer.

### 3.1 Wires faltantes
- IPC handlers `agents:set-model/set-role/set-system-prompt/set-reports-to/stats` ✅ feitos em M7-C
- IPC handlers `agents:set-mode/set-always-on/set-skills/pause/resume/terminate/wake-up/reset-session/hire-from-ui` — **M7.6**
- `AGENT_KILL` exposto na UI (botão Fire em `⋯` menu — M7.6)
- Auto-update do badge tray quando inbox unread cresce (item já em débito)

### 3.2 Caminhos paralelos UI ↔ CEO
Cada ação CEO-via-MCP ganha equivalente UI:
- Hire (M7.6 form `/agents/new`)
- Fire (M7.6 `⋯` menu)
- Reassign issue (validar — pode já existir no IssueDetailModal)
- Mudar priority/status issue (validar)
- Cancel/archive issue (futuro polish)

### 3.3 Edição de persona não-disruptiva
- Persona atual: textarea inline no ConfigTab com debounced save 500ms (M7-C — funciona).
- **Faltam adicionar (M7.6):**
  - Banner contextual ao salvar: "Mudança aplica no próximo turn. [Restart agent now] pra aplicar agora."
  - Botão "Restart now" pra forçar (kill+respawn preservando `--resume`).
- Próximo turn já lê `agents.system_prompt` atualizado via `--append-system-prompt` (comportamento de M7-C).

### 3.4 Visibilidade de progresso
- **Current action granular** (já planejado em M7.5) — mostra "Editing src/foo.ts" em vez de "working".
- **Runs modal** (M7.6) — pra auditoria pós-fato.
- **Stats tab** (M7.6) — tokens/runs/last active.

### 3.5 Permissões granulares (futuro)
Paperclip tem `agent.permissions.canCreateAgents`, `canAssignTasks` — concedidos por agente individual. Hoje nosso modelo é "todo agente pode fazer tudo que MCP whitelist permite". V2 considera: capability flags por agente. **Não pro M7.6/M8.5.**

---

## Seção 4 — Plano de milestones

### 🆕 M7.6 — Agent Studio (completion)
**Posição:** depois de M7-C (right panel base, IPC core — JÁ ENTREGUE) e M7.5 (foundations). Pode rodar parcialmente em paralelo com M8.

**Escopo (delta sobre M7-C):**
- Header sticky de ações em `/agents/:id` (status badge + Pause + Assign Task + `⋯` menu)
- Completar ConfigTab: dropdown `reports_to`, skills toggle, mode radio, always_on switch
- 4 IPC handlers novos: `agents:set-mode`, `set-always-on`, `set-skills`, `hire-from-ui`
- IPC `agents:pause/resume/terminate/wake-up/reset-session` (5 novos)
- Runs modal full-screen (read-only timeline derivada de messages)
- Form `/agents/new` + galeria de templates
- Schedule sub-section (always-on + wake-up button)
- Migration 0008: `paused_at`, `terminated_at`, `pause_reason` em `agents`. Status enum (string col) aceita `paused` e `terminated`.
- Router: ignorar enqueue pra agente paused

**Não-regressão:**
- Segurança (token leak, sandbox escape, fence file)
- M6.1 smoke test continua passando
- Token budget non-regression (skip-while-zero)
- Todos os fluxos M7-C continuam (não quebrar ConfigTab atual)

**Custos:** 4–5 dias. **Pré-req:** M7-C completo (right panel + IPC).

### 🆕 M8.5 — Goals + CEO Planning
**Posição:** depois de M8 (cost tracking pra estimates reais).

**Escopo:**
- Migration M8.5-01: `goals`, `goal_plans`, `issues.goal_id`
- Repository + IPC channels
- 5 novas MCP tools (`list_goals`, `get_goal`, `submit_goal_plan`, `update_goal_status`, `record_subgoal`)
- System prompt do CEO ganha bloco Goals
- Rota `/goals` (lista tree) + `/goals/:id` (detail)
- `GoalPlanReview` component (PR-review UI)
- Executor de approve (trans atômica)
- Inbox kinds `goal_proposed`, `goal_executing`, `goal_blocked`
- Testes integration + E2E

**Não-regressão:**
- M7.6 actions continuam funcionando
- M8 cost tracking não regride
- Tudo dos M1-M7 continua

**Custos:** 10–12 dias. **Pré-req:** M8 (forte), M7.5 (médio), M7.6 (médio).

### Roadmap update proposto

Adicionar entre M8 e M9 atuais. M9 e M10 não mudam exceto pra integrar:
- M9 Reviews UX pode aproveitar `goal_plans` history como modelo pra "PR review" interface (consistência).
- M9 AGENTS.md export ganha campo `goals` opcional.

---

## Decisões consciente NÃO incluídas

Pra não inflar M7.6 e M8.5:

| Feature Paperclip | Por que não agora |
|---|---|
| Instructions com **file tree** (múltiplos arquivos) | MVP é single markdown. Demanda real depois decide. |
| **Auto-sync skills** com source remoto (GitHub/NPM) | Out-of-scope (memory `feedback_security_priority`). Skills = tag declarativo. |
| **Permissions per-agent** (canCreateAgents etc) | V2. Modelo atual "MCP whitelist por skill" cobre. |
| **Goal budget** com soft-stop ao estourar | M8.5 grava `budget_max_tokens` mas enforcement é M8 hook que já existe. Não duplica lógica. |
| **Sub-goal cascading** (cancel parent → cascade children) | V2. V1 warning no UI. |
| **Plan inline-edit** antes de approve | V1 só include/exclude checkboxes. V2 edita texto. |
| **CEO auto-approve** (modo `auto` no goal) | V2. V1 sempre humano aprova. |
| **Goal templates / wizards** | V2. V1 form vazio. |
| **Manual Run Heartbeat** estilo Paperclip puro | Adaptado pra nossa arch via `agents:wake-up` (mensagem system "manual run requested"). |

---

## Riscos identificados

1. **Goal-planner pode gerar planos ruins** (agents desnecessários, issues mal decompostas). Mitigação: V1 sempre humano aprova. Iteramos system prompt baseado em feedback real. Logar todos os plans (history tab) pra inspecionar padrões.
2. **Token cost de planejamento** — CEO ler goal + propor plano consome tokens. Estimativa: ~5-15k tokens por plan. Memory `feedback_token_efficiency` exige alvo 1×. Solução: planning é evento raro (1× por goal), não acontece automaticamente. Aceito.
3. **Race condition na execução** — user aprova, executor cria agents simultaneamente. Trans atômica resolve. Testes integration cobrem.
4. **Status do goal fica inconsistente** com plan superseded — invariante: goal.status='planning' ⟺ existe goal_plan latest com status='proposed'. Adicionar trigger ou check no repository.
5. **Sub-goals + plans aninhados** — sub-goal pode ter próprio plan? V1 **sim**, mas sem cascade — cada plan independente. Documentar.
6. **M7.6 modal vs panel UX** — usuário pode achar modal "pesado" pra Instructions. Mitigação: começar com modal, observar uso, considerar inline drawer em iteração.

---

## Open items pra decidir durante implementação

- Qual lib de markdown editor? `@uiw/react-md-editor` é mais completo mas pesado. `react-textarea-autosize` + render `react-markdown` é leve. **Decidir em PR.**
- Goal `level='company'` deveria ser único por company (só 1 master goal)? Paperclip permite múltiplos. **Recomendo: permitir múltiplos, mostrar warning se >1 ativo.**
- `goal_plans.version` incrementa por goal ou globalmente? **Por goal** (mais lógico).
- Inbox `goal_executing` consume quanto espaço? **Auto-archive após 24h ou status='in_progress'**.
- CEO pode marcar goal=`achieved` autonomamente quando todas issues vinculadas estão done? **V1 sim, mas pede confirmação humana via inbox `goal_completion_proposed`. V2 modo `auto`.**

---

## Apêndice — referências de código

### Paperclip (inspeção em `D:/tmp/paperclip`)
- Agent detail UI: `ui/src/pages/AgentDetail.tsx` (linhas 930-3000)
  - `AgentOverview` 1269 · `PromptsTab` 1684 · `AgentSkillsTab` 2477 · `ConfigurationTab` 1537 · `RunsTab` 2944 · `BudgetPolicyCard` 1155
- New agent: `ui/src/pages/NewAgent.tsx`
- Goals schema: `packages/db/src/schema/goals.ts`
- Goals routes: `server/src/routes/goals.ts`
- Goals UI: `ui/src/pages/Goals.tsx`, `GoalDetail.tsx`, `NewGoalDialog.tsx`

### Nossa codebase
- Agent route: `apps/renderer/src/routes/Agent.tsx`
- Agents repo: `apps/main/src/agents/repository.ts`
- IPC channels: `packages/shared/src/ipc-channels.ts` (canais `AGENTS_SET_*` declarados sem handler)
- MCP tools: `apps/main/src/mcp/tools.ts` (M7.5 modulariza pra `tools/<domain>.ts`)
- System prompt: `apps/main/src/orchestrator/system-prompt.ts` (M7.5 move pra `preamble.md` + composable builder)
- Cost log: `apps/main/src/db/migrations/0001_initial.sql` (`costs_log` table, M8 popula)

---

> **Próximo passo:** após aprovação deste design, invocar `writing-plans` skill pra gerar implementation plan detalhado por milestone (M7.6 e M8.5 separados). Plan vira `docs/superpowers/plans/2026-MM-DD-m7.6-agent-studio-plan.md` e `…-m8.5-goals-ceo-planning-plan.md`. Depois `executing-plans` faz a implementação em PRs.
