# M8.5 — Goals + CEO Planning (Implementation Design)

> **Data:** 2026-05-12
> **Tipo:** Implementation design doc
> **Status:** Brainstorming aprovado em 2026-05-12 (caminho A: 2 milestones — M8.5 atomic + M8.6 live)
> **Base canônica:** [paperclip-gaps-ux-governance-design.md §2](./2026-05-11-paperclip-gaps-ux-governance-design.md) — design alto nível (schema completo, fluxos, UI). **Este doc não duplica**, resolve decisões de implementação.
> **Sucessor:** M8.6 Live Execution & Kanban Collab (stub a ser seedado em ROADMAP.md)

---

## TL;DR

**M8.5 entrega a fundação** de Goals + CEO planning automático em **2 PRs**:

- **PR-A backend** (~5-6 dias): migration `0012_goals`, repos, 6 MCP tools, system prompt block "Goals & Planning", **executor atômico** (1 trans, hire+create silencioso), startup recovery, 7 IPCs, 6 activity events `goal.*`.
- **PR-B UI** (~4-5 dias): 3 rotas (`/goals`, `/goals/new`, `/goals/:id`) lazy, 7 componentes (com destaque pro `GoalPlanReview`), 3 inbox kinds, i18n PT/EN, sidebar nav.

**M8.6 (próximo milestone)** adiciona a camada "viva" sobre M8.5: executor narrated, `comment_on_issue` MCP tool, sequencing por dependência, kanban CEO comments.

**Pré-reqs já cumpridos:**
- ✅ **M8** Costs (cost_events alimenta estimates via `get_cost_baseline`)
- ✅ **M7.5** Adapter foundation (`composeSystemPrompt` + `messages.kind` + approvals decoupled)
- ✅ **M7.6** Agent Studio (`agents:hire-from-ui` repo path reusado pelo executor)
- ✅ **M7.7** Activity stream (slot `goal.*` reservado em `ActivityAction`)

---

## Decisões resolvidas (brainstorming 2026-05-12)

| # | Tópico | Decisão |
|---|---|---|
| 1 | **PR split** | 2 PRs (M8-style): PR-A backend / PR-B UI. Volume comparável a M8. |
| 2 | **Spec doc** | Este documento. Não reescreve §2 — referencia + resolve decisões. |
| 3 | **GOAL_PLAN_REQUEST delivery** | System message com prefix `[GOAL_PLAN_REQUEST]` na fila normal do CEO via `orchestrator.deliverSystemMessage(ceoAgentId, text)`. Sem fila separada. |
| 4 | **Executor atomicity** | Single `db.transaction(...)`, chama repos diretamente (não MCP). Broadcasts saem após commit. Rollback total se qualquer step falhar + inbox `goal_error` com diff. |
| 5 | **Plan version cap** | Soft cap 5 (warning UI no 4º re-propose). Sem hard limit em v1. |
| 6 | **Sub-goals (`record_subgoal`)** | Post-approval only em v1. Parent goal precisa `status='in_progress'`. |
| 7 | **Owner vs proposed_by** | `owner_agent_id` = exec sponsor (default CEO). `proposed_by_agent_id` = quem escreveu plano atual (sempre CEO em v1). |
| 8 | **Estimates source** | Novo MCP tool `get_cost_baseline(role_template_id, model)` lê `cost_events`. Fallback hardcoded se sample < 5. |
| 9 | **Goal travado em 'planning'** | `goals/recovery.ts:scanPlanningWithoutPlan()` no boot do main re-enqueue GOAL_PLAN_REQUEST. Unit-testado. |
| 10 | **Activity events `goal.*`** | 6 actions: `goal.created`, `goal.plan_proposed`, `goal.plan_approved`, `goal.plan_rejected` (campo `reason: 'rejected' \| 'superseded'`), `goal.status_changed`, `goal.subgoal_recorded`. |

---

## 1. Schema (Migration `0012_goals`)

Conforme §2.2 da spec base. Sem deltas. Arquivo: `apps/main/src/db/migrations/0012_goals.ts`.

**Pontos de atenção pra implementação** (lições M8 PR-A — ver [project_m8_pr_a_lessons.md](../../../../C:/Users/hever/.claude/projects/D--Projetos-pessoais-Prospero/memory/project_m8_pr_a_lessons.md)):

- FK constraints **on** por default no better-sqlite3. Testes precisam de companies/agents reais — não passar IDs fake.
- `goal_plans.agents_to_hire_json` / `issues_to_create_json` / `risks_json` armazenam JSON serializado — schema diz `TEXT NOT NULL`, mas leitura via repo desserializa em arrays tipados.
- `decided_by` aceita `'user'` literal OU `agent_id` (futuro auto-approve em v2). v1 sempre `'user'`.

**ALTER TABLE em issues:**
```sql
ALTER TABLE issues ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX idx_issues_goal ON issues(goal_id);
```

**Post-migration:** nenhuma — schema novo é greenfield.

---

## 2. Tipos compartilhados

### `packages/shared/src/types/goal.ts` (novo)

```ts
export type GoalLevel = 'company' | 'team' | 'agent' | 'task';

export type GoalStatus =
  | 'draft' | 'planning' | 'proposed' | 'approved'
  | 'in_progress' | 'achieved' | 'cancelled';

export type GoalPlanStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

export type Goal = {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentGoalId: string | null;
  ownerAgentId: string | null;
  budgetMaxTokens: number | null;
  deadline: number | null;
  successCriteria: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AgentToHire = {
  index: number;
  name: string;
  roleTemplateId: string;
  model: string;
  personaSummary: string;
  skills: string[];
  reportsToIndex: number | 'CEO';
  rationale: string;
};

export type IssueToCreate = {
  index: number;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeIndex: number | 'CEO';
  estimatedTokens: number;
  dependsOnIndexes: number[];
  rationale: string;
};

export type Risk = {
  description: string;
  mitigation: string;
  severity: 'low' | 'medium' | 'high';
};

export type GoalPlan = {
  id: string;
  goalId: string;
  version: number;
  proposedByAgentId: string;
  summary: string;
  agentsToHire: AgentToHire[];
  issuesToCreate: IssueToCreate[];
  estimatedTotalTokens: number | null;
  estimatedDurationDays: number | null;
  estimatedCostCents: number | null;
  risks: Risk[];
  status: GoalPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
};

export type GoalWithPlan = Goal & {
  currentPlan: GoalPlan | null;
  history: GoalPlan[];  // superseded + rejected, ordered by version desc
};
```

### `packages/shared/src/schemas/goalPlan.ts` (novo — Zod)

Validação **estrita** do payload de `submit_goal_plan` (CEO LLM pode mandar lixo):

- **`agents_to_hire`**: array of `AgentToHire`. Constraints:
  - `index` único, sequencial começando em 0
  - `model` ∈ preset list (`opus-4`, `sonnet-4`, `haiku-4`, etc — importado de `MODEL_PRESETS`)
  - `roleTemplateId` existe (validado em runtime contra repo, não Zod)
  - `personaSummary.length` ∈ [10, 500]
  - `reportsToIndex`: `'CEO'` OR número que **referencia outro index do array** (DAG check em runtime — ver §4)
- **`issues_to_create`**: array of `IssueToCreate`. Constraints:
  - `index` único, sequencial começando em 0
  - `assigneeIndex`: `'CEO'` OR número que referencia `agents_to_hire[N].index` válido
  - `dependsOnIndexes`: cada elemento referencia outro index do array. **Acyclic** (runtime DAG check em §4)
  - `estimatedTokens` > 0
- **`risks`**: array of 0-10 risks
- **`summary.length`** ∈ [20, 2000]

Erros Zod são enviados de volta pro CEO em formato estruturado pra retry.

### `packages/shared/src/types/activity.ts` (edit)

Adicionar ao enum `ActivityAction`:
```ts
| 'goal.created'
| 'goal.plan_proposed'
| 'goal.plan_approved'
| 'goal.plan_rejected'
| 'goal.status_changed'
| 'goal.subgoal_recorded'
```

E discriminated union em `ActivityPayload`:
```ts
| { action: 'goal.created'; goalId: string; title: string; level: GoalLevel; parentGoalId: string | null }
| { action: 'goal.plan_proposed'; goalId: string; planId: string; version: number; agentsCount: number; issuesCount: number; estimatedCostCents: number | null }
| { action: 'goal.plan_approved'; goalId: string; planId: string; version: number; hiredAgentIds: string[]; createdIssueIds: string[] }
| { action: 'goal.plan_rejected'; goalId: string; planId: string; version: number; reason: 'rejected' | 'superseded'; userFeedback: string | null }
| { action: 'goal.status_changed'; goalId: string; fromStatus: GoalStatus; toStatus: GoalStatus; reason: string | null }
| { action: 'goal.subgoal_recorded'; parentGoalId: string; childGoalId: string; recordedByAgentId: string }
```

---

## 3. MCP tools

Arquivo: `apps/main/src/mcp/tools/goals.ts` (modularização do M7.5 cobre estrutura).

| Tool | Assinatura | Notas |
|---|---|---|
| `list_goals` | `{companyId?, status?}` → `Goal[]` | Default companyId = current. |
| `get_goal` | `{id}` → `GoalWithPlan` | `currentPlan` = última row de `goal_plans` não-superseded/rejected. `history` ordenado por version desc. |
| `submit_goal_plan` | `{goalId, plan: GoalPlanPayload}` → `{planId, version}` | (a) valida `goal.status === 'planning'`. (b) Zod parse. (c) DAG runtime check (depends_on cycles, reports_to cycles). (d) versão = max(existing) + 1. (e) INSERT goal_plans + UPDATE goal status='proposed' + inbox `goal_proposed` + activity `goal.plan_proposed`. Tudo em 1 trans. |
| `update_goal_status` | `{id, status, reason?}` → `Goal` | State machine validation (ver §A — apêndice). |
| `record_subgoal` | `{parentId, title, description?, level?}` → `Goal` | Valida `parent.status === 'in_progress'`. Cria goal status='draft', parent_goal_id=parentId, owner=caller (proposed_by_agent_id do plan). Activity `goal.subgoal_recorded`. |
| `get_cost_baseline` | `{roleTemplateId, model}` → `{avgInputTokens, avgOutputTokens, sampleCount, fallbackUsed}` | Query `cost_events` JOIN agents WHERE role_template_id=? AND model=?. Se sample < 5: retorna tabela hardcoded (ver §B — apêndice). |

**Validação Zod no `submit_goal_plan`:** erros formatados como `{error: 'invalid_plan', details: [{path: 'agents_to_hire[2].model', message: 'Model "gpt-4" not in preset list', expected: [...]}]}` — CEO recebe e pode retry.

---

## 4. System prompt block "Goals & Planning"

Arquivo: `apps/main/src/system-prompt/blocks/goals.ts` (novo).

Wire em `composeSystemPrompt` (foundation M7.5) — só pro role `ceo`. Outros agentes não recebem.

**Texto (PT/EN — depende de `agent.locale`):**

```
## Goals & Planning

Quando você receber uma mensagem system iniciando com [GOAL_PLAN_REQUEST]
no formato:

[GOAL_PLAN_REQUEST]
goal_id={id}
title={title}
description={description}
level={level}
budget_max_tokens={budget}
deadline={deadline_ms}
success_criteria={criteria}

Sua tarefa é decompor o goal em um plano completo executável. Passos:

1. Leia o goal inteiro com atenção. Identifique escopo, restrições, sucesso.
2. Chame `list_role_templates` pra ver tipos de agentes disponíveis.
3. Chame `list_agents` pra ver quem já existe — REUTILIZE quando fizer sentido.
4. Pra cada novo agente ou role+model que vai usar, chame
   `get_cost_baseline(roleTemplateId, model)` pra calibrar estimates.
5. Estruture o plano:
   - **agents_to_hire**: novos agentes (index único, model preset, persona 1-2 frases,
     skills do role, reports_to_index pra hierarquia, rationale).
   - **issues_to_create**: tarefas acionáveis (index, title, description,
     priority, assignee_index, estimated_tokens, depends_on_indexes formando DAG,
     rationale curta).
   - **risks**: 2-5 riscos com mitigation realista e severity.
   - **summary**: markdown 1-3 parágrafos explicando a estratégia.
6. Estimates conservadores — melhor super-estimar que travar budget.
7. Chame `submit_goal_plan(goal_id, plan)` com o payload completo.

Princípios:
- NÃO chame `hire_agent` ou `create_issue` diretamente nesse turn. Só
  `submit_goal_plan`. A execução fica gated pela aprovação do usuário.
- Se receber resposta de erro do submit_goal_plan (Zod inválido), corrija
  e re-submeta na mesma turn.
- Se o goal não fizer sentido (impossível, conflitante, escopo nulo), use
  `update_goal_status(id, 'cancelled', reason)` em vez de submeter plan vazio.
- Sub-goals durante execução (`record_subgoal`) só após plano aprovado.
```

**Runtime checks adicionais** (pós-Zod, antes de aceitar plan):
- `depends_on_indexes` formam DAG acyclic — algoritmo: visit + temporary mark + permanent mark
- `reports_to_index` formam DAG acyclic
- Todo `assigneeIndex` numérico referencia um `agents_to_hire[N].index` existente
- Todo `dependsOnIndexes` elemento referencia um `issues_to_create[N].index` existente
- `roleTemplateId` existe no `role_templates` repo
- Nenhum agent name colide com agent existente da company (case-insensitive)

Em erro de runtime check: rejeita com erro estruturado, CEO retry.

---

## 5. Executor atômico

Arquivo: `apps/main/src/goals/executor.ts` (novo).

```ts
type ExecuteOptions = {
  includeAgentIndexes?: Set<number>;  // undefined = todos
  includeIssueIndexes?: Set<number>;
};

type ExecuteResult =
  | { ok: true; hiredAgentIds: string[]; createdIssueIds: string[] }
  | { ok: false; error: string; failedAtStep: string };

export function executePlan(
  planId: string,
  userId: string,  // sempre 'user' em v1
  options: ExecuteOptions = {},
  deps: { db, agentsRepo, issuesRepo, goalsRepo, goalPlansRepo, activityRecorder }
): ExecuteResult {
  return deps.db.transaction(() => {
    const plan = deps.goalPlansRepo.getById(planId);
    if (!plan || plan.status !== 'proposed') {
      throw new Error(`plan ${planId} is not in 'proposed' state`);
    }
    const goal = deps.goalsRepo.getById(plan.goalId);
    if (!goal || goal.status !== 'proposed') {
      throw new Error(`goal ${plan.goalId} is not in 'proposed' state`);
    }

    const filteredAgents = filterByIndex(plan.agentsToHire, options.includeAgentIndexes);
    const filteredIssues = filterByIndex(plan.issuesToCreate, options.includeIssueIndexes);

    const ceoAgent = deps.agentsRepo.getCeoByCompany(goal.companyId);
    if (!ceoAgent) throw new Error(`no CEO for company ${goal.companyId}`);

    // Step 1: hire agents in dependency order (reports_to first)
    const sortedAgents = topoSortByReportsTo(filteredAgents);
    const indexToAgentId = new Map<number, string>();

    for (const a of sortedAgents) {
      const reportsToId = a.reportsToIndex === 'CEO'
        ? ceoAgent.id
        : indexToAgentId.get(a.reportsToIndex as number);
      if (a.reportsToIndex !== 'CEO' && !reportsToId) {
        throw new Error(`reports_to_index ${a.reportsToIndex} not yet resolved`);
      }
      const created = deps.agentsRepo.createDirectly({
        companyId: goal.companyId,
        name: a.name,
        roleTemplateId: a.roleTemplateId,
        model: a.model,
        personaSummary: a.personaSummary,
        skills: a.skills,
        reportsToAgentId: reportsToId ?? null,
        hiredViaGoalId: goal.id,
      });
      indexToAgentId.set(a.index, created.id);
    }

    // Step 2: create issues
    const indexToIssueId = new Map<number, string>();
    const sortedIssues = topoSortByDependsOn(filteredIssues);

    for (const issue of sortedIssues) {
      const assigneeId = issue.assigneeIndex === 'CEO'
        ? ceoAgent.id
        : indexToAgentId.get(issue.assigneeIndex as number);
      if (!assigneeId) {
        throw new Error(`assignee_index ${issue.assigneeIndex} not in execution scope (was the agent excluded?)`);
      }
      const dependsOnIds = issue.dependsOnIndexes
        .map(idx => indexToIssueId.get(idx))
        .filter(Boolean) as string[];
      const created = deps.issuesRepo.createDirectly({
        companyId: goal.companyId,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        assigneeId,
        estimatedTokens: issue.estimatedTokens,
        dependsOnIds,
        goalId: goal.id,
      });
      indexToIssueId.set(issue.index, created.id);
    }

    // Step 3: update plan + goal
    deps.goalPlansRepo.markApproved(planId, { decidedBy: 'user', decidedAt: Date.now() });
    deps.goalsRepo.updateStatus(goal.id, 'in_progress');

    // Step 4: activity events
    deps.activityRecorder.record({
      action: 'goal.plan_approved',
      goalId: goal.id,
      planId,
      version: plan.version,
      hiredAgentIds: [...indexToAgentId.values()],
      createdIssueIds: [...indexToIssueId.values()],
    });

    return {
      ok: true as const,
      hiredAgentIds: [...indexToAgentId.values()],
      createdIssueIds: [...indexToIssueId.values()],
    };
  })();
}
```

**Pontos críticos:**
- **Repo direto, não MCP:** `agentsRepo.createDirectly` e `issuesRepo.createDirectly` são funções novas (ou reusam internals do hire-from-ui/create do M7.6) que **não emitem broadcasts** durante a trans. Broadcasts saem após commit.
- **Topo sort interno:** apesar de Zod já garantir DAG, executor re-ordena pra processar em ordem de dependência (necessário pra resolver IDs antes de referenciar).
- **`notifyAssignee` em issues**: o atual em `issues-handlers.ts:43` é chamado de dentro do IPC `issues:create`. Em executor atomic, vamos chamar `notifyAssignee` **depois do commit**, num loop sobre `createdIssueIds`. Isso garante que cada agente acorde com sua issue — modo M8.5 mantém o wake-up de issue assignment que já existe. (M8.6 vai trocar isso por sequenced activation.)

### IPCs do approve flow

Arquivo: `apps/main/src/ipc/goals-handlers.ts` (novo).

- `goals:approve-plan(planId, options?)` → `{ok, hiredAgentIds, createdIssueIds}` chama `executePlan` + post-commit calls `notifyAssignee(issue)` pra cada issue criada + emite inbox `goal_executing`. Se `executePlan` throw, returns `{ok: false, error}` + inbox `goal_error` (com diff renderado fora da trans).
- `goals:request-changes(planId, feedback)` → goal_plans status='superseded', goal status='planning', enqueue novo GOAL_PLAN_REQUEST com sufixo `[FEEDBACK] {feedback}` pro CEO.
- `goals:reject-plan(planId, reason?)` → goal_plans status='rejected', goal status='cancelled', inbox notification opcional.

---

## 6. Startup recovery

Arquivo: `apps/main/src/goals/recovery.ts` (novo).

```ts
export function scanPlanningWithoutPlan(deps: { db, agentsRepo, orchestrator }) {
  const stuck = deps.db.prepare(`
    SELECT g.* FROM goals g
    WHERE g.status = 'planning'
    AND NOT EXISTS (
      SELECT 1 FROM goal_plans p
      WHERE p.goal_id = g.id AND p.status = 'proposed'
    )
  `).all() as GoalRow[];

  for (const goal of stuck) {
    const ceo = deps.agentsRepo.getCeoByCompany(goal.companyId);
    if (!ceo) continue;
    const text = formatGoalPlanRequest(goal);
    deps.orchestrator.deliverSystemMessage(ceo.id, text);
  }

  return stuck.length;
}
```

Chamado de `apps/main/src/index.ts` no boot, após DB migrations e orchestrator init. Log: `[goals] recovery scanned N stuck planning goals`.

---

## 7. Orchestrator integration

Reusa infraestrutura existente. Sem mudanças em `orchestrator/`. Único ponto: nova função pública `orchestrator.deliverSystemMessage(agentId, text)` que enfileira na queue normal do agente com `senderKind='system'`. Pode já existir — verificar em PR-A.

---

## 8. UI (PR-B)

### Rotas (todas lazy)

| Rota | Arquivo | Descrição |
|---|---|---|
| `/goals` | `apps/renderer/src/routes/Goals.tsx` | Tree view + "New Goal" button |
| `/goals/new` | `apps/renderer/src/routes/GoalNew.tsx` | Form simples |
| `/goals/:id` | `apps/renderer/src/routes/GoalDetail.tsx` | Header + Tabs (Plan default · Sub-goals · Linked issues · History) |

### Componentes

| Componente | Função |
|---|---|
| `components/GoalsTree.tsx` | Renderização recursiva (parent → children) com status badges + click |
| `components/GoalDetailHeader.tsx` | Title inline edit (debounced 500ms), status pill, level, deadline, owner dropdown |
| `components/GoalPlanReview.tsx` | **O componente principal** — ver §8.1 |
| `components/GoalPlanHistory.tsx` | Read-only list de superseded/rejected plans, expand pra ver detail |
| `components/GoalPlanRequestChangesModal.tsx` | Free text feedback → IPC `goals:request-changes` |
| `components/GoalRejectModal.tsx` | Confirm + optional reason |
| `state/goalsStore.ts` | Zustand: `goals`, `currentGoal`, `currentPlan`, `historyPlans`, actions |

### 8.1 `GoalPlanReview` — layout

```
┌────────────────────────────────────────────────────────────────┐
│ Plan v1 · proposed by CEO · 2026-05-12 14:30                  │  ← header
├────────────────────────────────────────────────────────────────┤
│ ## Summary                                                     │
│ {markdown render}                                              │
├────────────────────────────────────────────────────────────────┤
│ 🧑 Agents to hire (3)                                          │
│ ☑ #0  Sarah  · @sw-engineer · sonnet-4    [▼ rationale]       │
│        persona: "..."                                          │
│        skills: file_ops, git, npm                              │
│        reports to: CEO                                         │
│ ☑ #1  Marcus · @qa-engineer · haiku-4     [▼ rationale]       │
│        reports to: #0                                          │
│ ☑ #2  ...                                                      │
├────────────────────────────────────────────────────────────────┤
│ 📋 Issues to create (5)                                        │
│ ☑ #0  [HIGH]    Set up project skeleton                       │
│       assignee: Sarah · est: 8k tokens · deps: —              │
│ ☑ #1  [MEDIUM]  Write unit tests                              │
│       assignee: Marcus · est: 12k tokens · deps: #0           │
│ ...                                                            │
├────────────────────────────────────────────────────────────────┤
│ ⚠ Risks (2)  [▼ expand]                                       │
├────────────────────────────────────────────────────────────────┤
│ 📊 Estimates  (sticky bottom-right)                            │
│  Total tokens: 87k                                             │
│  Estimated cost: $0.42 USD (~R$2.10)                           │
│  Duration: 2 days                                              │
│  Budget: 4% of daily Max                                       │
├────────────────────────────────────────────────────────────────┤
│ [✓ Approve & Execute]  [↻ Request Changes]  [✗ Reject]        │
└────────────────────────────────────────────────────────────────┘
```

**Detalhes:**
- Checkboxes default ON. User pode desmarcar pra excluir agente/issue da execução. Validação UI: se uma issue depende de outra que foi desmarcada, ou se assignee é agent desmarcado, **desabilita Approve** e mostra warning inline.
- Estimates panel sticky — recalcula client-side conforme checkboxes mudam.
- Cores: agents bloco usa accent secundário, issues usa accent primário. Risks usa amarelo/laranja. Consistente com `/costs` palette do M8.
- `% of daily Max budget` lê do `costs:get-budgets` IPC (M8).

### Inbox kinds novos

`packages/shared/src/types/inbox.ts` (edit) — adicionar 3 kinds:
- `goal_proposed` — link `/goals/:id`. Title: "{ceo_name} proposed a plan for goal "{title}""
- `goal_executing` — link `/goals/:id`. Title: "Plan for "{title}" is executing — {N} agents hired, {M} issues created"
- `goal_error` — link `/goals/:id`. Title: "Plan execution failed for "{title}"" + body com diff

Render no `apps/renderer/src/components/InboxItem.tsx` (edit).

### Sidebar

`apps/renderer/src/components/Sidebar.tsx` — adicionar link `/goals` com ícone `Target` do lucide-react. Posição: entre Issues e Inbox.

### i18n

Catálogo PT/EN em `apps/renderer/src/locales/pt.ts` + `en.ts`. Estrutura prefix:
- `goals.list.*` — tree, "New goal", empty state
- `goals.new.*` — form fields, validation
- `goals.detail.*` — header, tabs, status labels
- `goals.plan.*` — review component (incluído, agents, issues, estimates, risks, action buttons)
- `goals.plan.history.*` — history tab
- `goals.inbox.*` — 3 kinds
- `goals.errors.*` — execution error rendering

Target: ~50 keys totais.

---

## 9. Test plan

### PR-A backend (target ~70-90 testes novos)

**Unit (apps/main/tests):**
- `migrations/0012_goals.test.ts` — schema apply + rollback (1 test)
- `goals/goals-repo.test.ts` — CRUD + state transitions (~12 tests)
- `goals/goal-plans-repo.test.ts` — CRUD + versioning + filter by status (~10 tests)
- `mcp/tools/goals.test.ts` — 6 tools, happy path + error cases (~25 tests)
- `goals/executor.test.ts` — happy path + 4 failure modes (rollback verification): partial hire fail, partial issue fail, missing reports_to ref after filtering, FK error mid-trans (~10 tests)
- `goals/recovery.test.ts` — scan finds stuck goals + re-enqueue called (~3 tests)
- `system-prompt/blocks/goals.test.ts` — block composition + locale switch (~4 tests)
- `ipc/goals-handlers.test.ts` — 7 IPC handlers stub + auth + broadcast (~15 tests)

**Unit (packages/shared/tests):**
- `schemas/goalPlan.test.ts` — Zod validation exhaustive: index uniqueness, DAG check, model preset, length bounds (~40+ cases)

**Integration:**
- `tests/integration/goal-planning-flow.test.ts` — GOAL_PLAN_REQUEST enqueued → mocked CEO MCP call → `submit_goal_plan` → DB row + inbox + activity
- `tests/integration/goal-approve-flow.test.ts` — approve plan → executor → agents created + issues created + status correct
- `tests/integration/goal-request-changes.test.ts` — request changes → v2 plan supersedes v1
- `tests/integration/goal-rollback.test.ts` — partial failure rolls back fully

### PR-B UI (target ~25-35 testes novos)

**Unit (apps/renderer/tests):**
- `components/GoalPlanReview.test.tsx` — render + 3 action buttons + include checkbox toggles + estimates recalc on toggle + disabled state when invalid (~10 tests)
- `components/GoalsTree.test.tsx` — recursive render + click navigation (~3 tests)
- `state/goalsStore.test.ts` — mutations + selectors (~6 tests)
- `routes/GoalDetail.test.tsx` — tab switching + plan vs no-plan states (~4 tests)
- i18n coverage tests (key existence both locales) (~2 tests)

**E2E (Playwright):** SKIP — Electron 33 + Playwright 1.60 incompat documented em M7.5 PR-C.

### Smoke manual checklist (após PR-B merge)

1. `pnpm dev` → login OAuth → criar empresa demo se necessário
2. `/goals/new` → criar goal "Test M8.5" com title+desc+level=task
3. `/goals/:id` → click "Ask CEO to plan"
4. Aguardar CEO turn → inbox notifica `goal_proposed`
5. Click inbox → abre `/goals/:id` no tab Plan
6. Ver GoalPlanReview renderizando agents/issues/estimates/risks
7. Desmarcar 1 agente que não tenha deps → estimates recalculam
8. Click "Approve & Execute" → confirm
9. Ver inbox `goal_executing` → click → goal status 'in_progress'
10. Sidebar agents mostra novos hires
11. Kanban `/issues` mostra novas issues com `goal_id` linkado
12. Tab "History" mostra plan v1 approved
13. Tab "Linked issues" mostra as N issues
14. (Edge) Criar segundo goal → "Ask CEO" → "Request Changes" com feedback → ver v2 chegar superseding v1
15. (Edge) Criar goal → "Ask CEO" → "Reject" → goal status='cancelled'

---

## 10. PR split file map

### PR-A backend (target volume comparable a M8 PR-A: ~10 commits feature + 60-90 testes)

**Novos:**
- `apps/main/src/db/migrations/0012_goals.ts`
- `apps/main/src/goals/goals-repo.ts`
- `apps/main/src/goals/goal-plans-repo.ts`
- `apps/main/src/goals/executor.ts`
- `apps/main/src/goals/recovery.ts`
- `apps/main/src/goals/formatRequest.ts` — `formatGoalPlanRequest(goal, feedback?: string): string`
- `apps/main/src/mcp/tools/goals.ts` — 6 tools
- `apps/main/src/mcp/tools/cost-baseline.ts` — `get_cost_baseline` (separado pra dependency-injection limpo)
- `apps/main/src/system-prompt/blocks/goals.ts`
- `apps/main/src/ipc/goals-handlers.ts`
- `packages/shared/src/types/goal.ts`
- `packages/shared/src/schemas/goalPlan.ts`
- + ~7 test files

**Edits:**
- `apps/main/src/db/migrations/index.ts` — register `0012_goals`
- `apps/main/src/system-prompt/composeSystemPrompt.ts` — wire `goalsBlock` for CEO role
- `apps/main/src/mcp/tools/index.ts` — export new tools
- `apps/main/src/index.ts` — register IPCs + call recovery on boot
- `apps/main/src/ipc/preload.ts` — expose 7 new IPC channels
- `packages/shared/src/ipc-channels.ts` — add 7 channel names
- `packages/shared/src/types/activity.ts` — add 6 `goal.*` actions + payloads
- `apps/main/src/activity/schemas.ts` — register 6 payload schemas

### PR-B UI (target volume comparable a M8 PR-B: ~20 commits feature + 25-35 testes)

**Novos:**
- `apps/renderer/src/routes/Goals.tsx` (lazy)
- `apps/renderer/src/routes/GoalNew.tsx` (lazy)
- `apps/renderer/src/routes/GoalDetail.tsx` (lazy)
- `apps/renderer/src/components/GoalsTree.tsx`
- `apps/renderer/src/components/GoalDetailHeader.tsx`
- `apps/renderer/src/components/GoalPlanReview.tsx`
- `apps/renderer/src/components/GoalPlanHistory.tsx`
- `apps/renderer/src/components/GoalPlanRequestChangesModal.tsx`
- `apps/renderer/src/components/GoalRejectModal.tsx`
- `apps/renderer/src/state/goalsStore.ts`
- + test files

**Edits:**
- `apps/renderer/src/router.tsx` — wire 3 lazy routes
- `apps/renderer/src/components/Sidebar.tsx` — Goals nav link
- `apps/renderer/src/components/InboxItem.tsx` — render `goal_*` kinds
- `apps/renderer/src/preload/api.ts` — expose 7 IPC handles
- `apps/renderer/src/locales/pt.ts` + `en.ts` — ~50 keys

---

## 11. Diferimentos pra M8.6

**Não entram em M8.5** (vão pra M8.6 — Live Execution & Kanban Collab):
- ❌ Executor narrated mode (CEO loopa MCP calls em vez de trans atômica)
- ❌ `comment_on_issue` MCP tool — CEO ainda não comenta em issues
- ❌ Topological sequenced activation — M8.5 reusa `notifyAssignee` que acorda todos os assignees imediatamente
- ❌ Kanban card detail com CEO/agent/user comments diferenciados — atual `CommentComposer` é só user
- ❌ Plan inline-edit (texto livre antes de approve) — fica v2

**Justificativa:** M8.5 atomic é a fundação testável. M8.6 é camada aditiva sobre M8.5 sem refactor invasivo.

---

## 12. Riscos + edge cases

| Risco | Mitigação |
|---|---|
| CEO LLM submete plan com Zod inválido | Erro estruturado retorna pro CEO, retry na mesma turn. Logged como `goal.plan_proposed.failed` (não criamos action própria — fica em error log do MCP). |
| CEO em loop infinito de re-submit inválido | Rate limit: máx 3 tentativas de submit_goal_plan por GOAL_PLAN_REQUEST. Após 3, system message "Failed to produce valid plan after 3 attempts. Asking user for clarification." + inbox `goal_error`. |
| User desmarca tudo e clica Approve | Validation UI: se 0 agents e 0 issues selecionados, button disabled. |
| User desmarca agente N mas issue depende dele | Validation UI: highlight issue como "blocked, will exclude" + warning banner. Approve fica enabled mas issue excluded auto. |
| `cost_events` vazio na primeira execução | `get_cost_baseline` fallback table hardcoded (ver §B). Sample count = 0, fallback_used = true. |
| Goal cancelado mid-execution | Não acontece — execution é atomic. Após `in_progress`, goal só vai pra `achieved` (via CEO `update_goal_status`) ou `cancelled` (via user no UI). |
| App crash durante trans do executor | better-sqlite3 WAL + transação garante atomicidade. Crash = rollback automático. Goal volta pra `proposed`. User pode tentar de novo. |
| Sub-goal criada pelo CEO com parent já `achieved` | `record_subgoal` valida parent.status='in_progress'. Erro estruturado. |
| Activity event flood se executor cria 50 issues | OK — 1 evento `goal.plan_approved` consolidado, não 1-por-issue. Atomic = 1 event. |

---

## Apêndice A — State machine de Goals

```
draft ──askCEO──▶ planning ──CEO.submit──▶ proposed ──┬──approve──▶ in_progress ──CEO.update──▶ achieved
                                                       │                          │
                                                       ├──reject ─────────────────┴──CEO.update──▶ cancelled
                                                       │
                                                       └──requestChanges──▶ planning (+ supersede plan)
```

Transições válidas (enforced em `update_goal_status` e via IPCs):
- `draft` → `planning` (via "Ask CEO to plan")
- `planning` → `proposed` (auto, via `submit_goal_plan`)
- `proposed` → `approved` → `in_progress` (auto via executor — combinados em 1 step)
- `proposed` → `planning` (via request-changes, plan superseded)
- `proposed` → `cancelled` (via reject)
- `in_progress` → `achieved` (via CEO `update_goal_status`)
- `in_progress` → `cancelled` (via user UI — fica como botão "Cancel goal" em GoalDetail)
- `draft` → `cancelled` (via user UI)

---

## Apêndice B — Cost baseline fallback table

Hardcoded em `apps/main/src/mcp/tools/cost-baseline.ts` se `cost_events` sample < 5:

```ts
const FALLBACK: Record<string, { input: number; output: number }> = {
  'opus-4': { input: 3000, output: 1500 },
  'sonnet-4': { input: 2500, output: 1200 },
  'haiku-4': { input: 1500, output: 800 },
};
// Default fallback: sonnet-4 numbers
```

Numbers baseados em observed avg per-turn pra issues típicas (5-10k token issues). Atualizar quando M8 acumular dados reais.

---

## Apêndice C — Estimativa final

| Tarefa | Dias |
|---|---|
| PR-A backend | 5-6 |
| └ Schema + migration + types | 1 |
| └ Repos (goals + goal-plans) | 0.5 |
| └ 6 MCP tools + Zod | 1.5 |
| └ System prompt block | 0.5 |
| └ Executor + topo sort + recovery | 1.5 |
| └ 7 IPCs + activity events | 0.5 |
| └ Tests + bug fixes | 0.5 |
| PR-B UI | 4-5 |
| └ Routes + store + sidebar/inbox wire | 1 |
| └ GoalPlanReview (component crítico) | 2 |
| └ Other components (Tree, History, modals) | 1 |
| └ i18n + tests | 1 |
| **Total** | **9-11 dias** |

---

## Pré-reqs cumpridos — checklist

- ✅ M8 fechado (`d264a0a`) → `cost_events` disponível pra `get_cost_baseline`
- ✅ M7.5 (`a633e41` adapter + `baca895` migrations) → `composeSystemPrompt` + `messages.kind`
- ✅ M7.6 (`bc38f4a` + 5 fix commits) → `agents:hire-from-ui` repo path reusado pelo `agentsRepo.createDirectly`
- ✅ M7.7 (`activity_events` foundation) → action slot `goal.*` já reservado em [m7.7 plan](../plans/2026-05-12-m7.7-pr-a-activity-foundation.md)

---

## Próximo passo após este spec

1. **User review** deste doc
2. Invocar `superpowers:writing-plans` skill pra criar:
   - `docs/superpowers/plans/2026-05-12-m8-5-pr-a-goals-backend.md`
   - `docs/superpowers/plans/2026-05-12-m8-5-pr-b-goals-ui.md`
3. Executar PR-A → smoke → PR-B → smoke → roadmap update
4. **Após M8.5 merge:** começar design da M8.6 (Live Execution & Kanban Collab)
