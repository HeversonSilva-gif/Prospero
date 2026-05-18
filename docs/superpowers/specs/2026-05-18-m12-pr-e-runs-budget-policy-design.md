# M12 PR-E — Runs · Budget por agente · Run Policy

> **Status:** spec de design (2026-05-18). Implementa a **Peça 4** do M12
> (`docs/m12-agent-org-definition-layer.md` §7, §11, §13, §16).
>
> **Brainstorm:** 2026-05-18 · contexto explorado: recording de `cost_events`
> por turno (`orchestrator-handlers.ts` turn-complete), soft-stop do M8
> (`costs/enforce-budget.ts`), `RunsModal` atual, `build-args.ts` /
> `resolveCapabilityTools`, schema de `agents`.

---

## TL;DR

PR-E entrega a quarta peça do M12 em **três subsistemas**:

1. **Runs** — histórico de execução por agente, como aba do Agent Studio.
2. **Budget por agente** — teto de tokens/USD por agente, estendendo o
   soft-stop do M8.
3. **Run Policy** — consolidação de permissões de execução (`mode`,
   `always_on`, `can_hire`, `can_assign`).

**Decisão de storage (resolve a §16 do design doc):** Runs é **derivado de
`cost_events`** — não há tabela `agent_runs`. O `cost_events` (M8) já grava
exatamente uma linha por turno no `turn-complete`, com `agent_id`, `model`,
`adapter_name`, tokens (in/out/cache), `cost_cents_estimate`, `issue_id`,
`session_id` e `occurred_at`. Uma tabela dedicada duplicaria ~80% disso. A aba
Runs vira um read-model puro sobre `cost_events`.

**Execução:** um único spec, dividido em **duas PRs**:

| PR | Escopo | Migração |
|---|---|---|
| **E1** | Aba Runs (read-model sobre `cost_events`) | nenhuma |
| **E2** | Budget por agente + Run Policy (colunas em `agents`) | `0026` |

E1 é autossuficiente e read-only. E2 agrupa Budget + Run Policy porque ambos
são "colunas novas em `agents` + seção de UI + enforcement" e compartilham a
migração `0026`.

**Não-regressão:** PR-E é **token-neutro** — Runs é read-only, o filtro de
`--allowedTools` só encolhe a lista, o enforcement de budget roda pós-turno.
Nada toca o system prompt.

---

## 1. Subsistema Runs (PR-E1)

### 1.1 Modelo de dados — derivar, não tabular

Um "run" = um turno = uma linha de `cost_events`. **Não há tabela `agent_runs`,
não há migração, não há escrita nova no orquestrador.** O `cost_events` já é
populado uma vez por turno.

Campos disponíveis por run (direto da linha de `cost_events`):

| Campo | Origem |
|---|---|
| id | `cost_events.id` |
| timestamp | `occurred_at` |
| modelo | `model` |
| adapter | `adapter_name` |
| tokens in/out/cache | `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens` |
| custo | `cost_cents_estimate` |
| issue | `issue_id` |
| sessão | `session_id` |

**Trim consciente vs. o design doc:** o doc §7 imaginava colunas `status` e
`trigger` numa tabela `agent_runs`. Derivando, elas caem:
- `status` — erros de turno já aparecem no `activity feed`; um run sem custo
  é uma borda aceitável de não-surfar.
- `trigger` — YAGNI; se necessário no futuro, derivável da primeira mensagem
  da janela do turno.

### 1.2 Read-model

- **`costsRepo.listRunsByAgent(agentId, { limit })`** — novo método na
  `CostsRepository`. Retorna linhas de `cost_events` do agente, `ORDER BY
  occurred_at DESC`, limitadas. Tipo de retorno `AgentRunRow` (ver §1.5).
- **`groupRunsBySession(rows)`** — helper puro no renderer (`lib/`). Agrupa
  runs por `session_id` (igualdade real). Runs com `session_id` nulo formam
  cada um seu próprio grupo. Substitui a heurística de contiguidade do
  `groupBySession` atual do `RunsModal`.
- **Drill-in (atividade do turno)** — expandir um run mostra o breakdown
  completo (tokens, custo, modelo, adapter, issue) **mais** a atividade do
  turno. A atividade vem da janela de tempo entre turnos consecutivos: o
  run *N* do agente *A* cobre `(occurred_at[N-1], occurred_at[N]]`. A query é
  `activity_events WHERE agent_id = A AND created_at > prev AND created_at <=
  this`. Janela bem-definida (turnos consecutivos do mesmo agente),
  totalmente derivável.

### 1.3 IPCs novos

- **`runs:list`** — `{ agentId, limit? }` → `AgentRunRow[]`. Limite default
  100.
- **`runs:turn-activity`** — `{ agentId, fromExclusive, toInclusive }` →
  `ActivityEvent[]` do agente na janela. Chamado on-demand ao expandir um run.

### 1.4 UI

- Nova **aba Runs** no Agent Studio (`/agents/:id`), conforme §11 do design
  doc. Lista de runs agrupados por sessão; cada run expansível para o
  drill-in.
- O **`RunsModal` atual é removido** (`apps/renderer/src/components/agent-panel/
  RunsModal.tsx`) e qualquer ponto que o abre passa a navegar para a aba.

### 1.5 Tipos (shared)

```ts
// packages/shared/src/types/agent-run.ts (novo)
export type AgentRunRow = {
  id: string;
  agentId: string;
  occurredAt: number;
  model: string | null;
  adapterName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costCentsEstimate: number;
  issueId: string | null;
  sessionId: string | null;
};
```

---

## 2. Subsistema Budget por agente (PR-E2)

### 2.1 Colunas novas em `agents`

Migração `0026` — todas `ALTER TABLE agents ADD COLUMN`:

| Coluna | Tipo | Nota |
|---|---|---|
| `budget_tokens_limit` | `INTEGER` nullable | `null` = sem teto por-agente (vale só o global do M8) |
| `budget_usd_limit` | `INTEGER` nullable | em **centavos** (consistente com `cost_cents_estimate`) |
| `budget_period` | `TEXT NOT NULL DEFAULT 'daily'` | `CHECK (budget_period IN ('daily','monthly'))` |
| `budget_warned_period` | `TEXT` nullable | chave do período do último aviso de 80% (dedup); interna ao enforcement |

O teto por-agente é **aditivo** ao global do M8 — o global continua sendo o
piso; o per-agente é um teto adicional mais apertado. Ambos são checados.

### 2.2 Total por período

- **`costsRepo.getAgentPeriodTotal(agentId, period, now)`** — novo método.
  Retorna `CostTotal` (`{ tokens, cents }`) do agente no período corrente.
  - `period = 'daily'` — reusa `utcDayBounds` existente.
  - `period = 'monthly'` — novo `utcMonthBounds(now)`: do dia 1 00:00 UTC do
    mês ao dia 1 do mês seguinte.

### 2.3 Chave de período (dedup do aviso)

- **`periodKey(period, now)`** — helper puro.
  - `daily` → `"YYYY-MM-DD"` (UTC).
  - `monthly` → `"YYYY-MM"` (UTC).
- O aviso de 80% só dispara se `budget_warned_period !== periodKey(...)`. Ao
  avisar, grava `budget_warned_period = periodKey(...)`. O rollover de período
  produz uma chave nova → o aviso volta a poder disparar, sem reset explícito.

### 2.4 Enforcement — estende `checkAndPause`

O `checkAndPause` (`costs/enforce-budget.ts`) hoje checa só os tetos
**globais** (`maxTokensPerDayPerAgent`, `maxTokensPerIssue`) e só **pausa** a
100%. PR-E2 adiciona, **depois** das checagens globais (que ficam intactas):

1. Lê os campos de budget do agente. Se `budget_tokens_limit` e
   `budget_usd_limit` forem ambos `null`, não faz nada.
2. Computa `getAgentPeriodTotal(agentId, agent.budgetPeriod, now)`.
3. **Teto de tokens** (`budget_tokens_limit`, se definido) — universal, vale
   para qualquer adapter:
   - `total.tokens >= limit` → pausa. `PauseReason` novo:
     `budget_exceeded_agent`. Caminho de pausa = o existente
     (`pauseAgent` + `notifySecurityAlert` + `recordPauseActivity`).
   - `total.tokens >= 0.8 * limit` (e não pausou) → aviso de 80% (ver §2.5).
4. **Teto de USD** (`budget_usd_limit`, se definido) — só **enforced** quando
   o adapter tem custo real (`adapter_name` começa com `claude-api-key`).
   Para adapters OAuth (`claude-oauth-local`), o limite USD é **informativo**
   (exibido na UI, não checado). Mesma lógica 80%/100% sobre `total.cents`.
5. **Precedência:** se token *ou* USD atinge 100%, pausa (uma só pausa). O
   aviso de 80% só é considerado quando nenhum teto atingiu 100%.

`checkAndPause` ganha dependências novas em `EnforceBudgetDeps`:
- `getAgent(agentId)` → os campos de budget (ou recebe o `Agent` já no `ctx`).
- `notifyBudgetWarning(input)` — cria o inbox item `budget_warning`.
- `markBudgetWarned(agentId, periodKey)` — grava `budget_warned_period`.

`PauseReason` passa a ser
`"budget_exceeded_daily" | "budget_exceeded_issue" | "budget_exceeded_agent"`.

### 2.5 Aviso de 80% — inbox kind `budget_warning`

- Novo inbox kind **`budget_warning`**. Adicionado ao `CHECK` de
  `inbox_items.kind` na migração `0026` (recriação da tabela com
  `PRAGMA defer_foreign_keys = 1`, padrão das migrações de inbox kind do M11
  — 0019/0020/0021/0022).
- `notifyBudgetWarning` cria um inbox item desse kind com a utilização atual
  (tokens ou USD, qual atingiu 80%) e o limite.
- Dedup por `budget_warned_period` (§2.3): um aviso por período. A 100% o
  caminho é `notifySecurityAlert` (kind `security_alert`, já existente) — uma
  pausa não precisa de dedup porque o agente para de rodar.

### 2.6 UI — seção Budget na aba Stats

Conforme §11 do design doc. A aba **Stats** ganha uma seção **Budget**:
- Barra de utilização de **tokens** (total do período / limite, %).
- Barra de utilização de **USD** (informativa para OAuth, enforced para
  API-key — rotulada conforme o adapter).
- Edição dos três campos: `budget_tokens_limit`, `budget_usd_limit`,
  `budget_period`.
- IPC novo **`agents:set-budget`** — `{ agentId, tokensLimit, usdLimit, period }`.
  Não exige re-spawn (enforcement roda pós-turno, lê o banco a cada turno).
- IPC novo **`costs:get-agent-budget-status`** — `{ agentId }` →
  `{ period, tokenTotal, tokenLimit, usdTotalCents, usdLimitCents,
  adapterIsCostBearing }`, para alimentar as barras.

---

## 3. Subsistema Run Policy (PR-E2)

### 3.1 Colunas novas em `agents`

Mesma migração `0026`:

| Coluna | Tipo | Nota |
|---|---|---|
| `can_hire` | `INTEGER NOT NULL DEFAULT 1` | `CHECK (can_hire IN (0,1))` |
| `can_assign` | `INTEGER NOT NULL DEFAULT 1` | `CHECK (can_assign IN (0,1))` |

Default `1` (permitido) → agentes existentes mantêm o comportamento atual
(back-compat: hoje `delegation`/`issues` capabilities gateiam por inteiro).

### 3.2 Enforcement — filtro em `build-args.ts`

A "gate" real das tools MCP é o `--allowedTools`, montado por
`resolveCapabilityTools(agent.capabilities)` em `build-args.ts`. PR-E2 subtrai
cirurgicamente dessa lista, **depois** de `resolveCapabilityTools`:

- `!agent.canHire` → remove `mcp__dashboard__hire_agent` e
  `mcp__dashboard__fire_agent` (mantém `message_agent`, `list_agents`,
  `read_thread`).
- `!agent.canAssign` → remove `mcp__dashboard__assign_issue`.

`can_hire`/`can_assign` viram um **sub-toggle fino** das capabilities
`delegation`/`issues` — só importam quando o agente já tem a capability (sem
ela, as tools nem entram no `--allowedTools`). **Sem** checagem runtime dentro
das tools (seria inconsistente com o resto do sistema de capabilities),
**sem** mexer no `gate.ts`.

Mudar `can_hire`/`can_assign` exige **re-spawn** — igual a mudar capabilities,
porque afeta `--allowedTools` no spawn. O padrão de re-spawn em mutação de
config já existe em `orchestrator-handlers.ts` (o handler de
`AGENTS_SET_CAPABILITIES`).

### 3.3 UI — seção Run Policy na aba Config

Conforme §11 do design doc. A aba **Config** ganha uma seção **Run Policy**
que **consolida**:
- `mode` (supervised / auto) — controle **migra** de onde está hoje.
- `always_on` — controle **migra** de onde está hoje.
- `can_hire` — toggle novo.
- `can_assign` — toggle novo.

IPC novo **`agents:set-permissions`** — `{ agentId, canHire, canAssign }`.
Dispara re-spawn como o handler de capabilities. Os IPCs de `mode`/`always_on`
já existem e não mudam — só os controles relocam para a seção nova.

---

## 4. Dados, tipos, migração

### 4.1 Migração `0026_m12_agent_budget_policy.sql`

Um único arquivo:
1. 6 `ALTER TABLE agents ADD COLUMN` — `budget_tokens_limit`,
   `budget_usd_limit`, `budget_period`, `budget_warned_period`, `can_hire`,
   `can_assign`.
2. Recriação de `inbox_items` para adicionar `budget_warning` ao `CHECK` de
   `kind` — `PRAGMA defer_foreign_keys = 1`, copiando o padrão das migrações
   de inbox kind do M11.

**Sem post-migration** — todos os defaults cobrem agentes existentes
(limites `null` = não configurado, `budget_period = 'daily'`,
`can_hire/can_assign = 1`).

### 4.2 Tipo `Agent` (shared)

`packages/shared/src/types/agent.ts` ganha:

```ts
budgetTokensLimit: number | null;
budgetUsdLimit: number | null;        // centavos
budgetPeriod: "daily" | "monthly";
canHire: boolean;
canAssign: boolean;
```

`budget_warned_period` **não** entra no tipo público `Agent` — é bookkeeping
interno do enforcement; só a `Row` do repo o carrega.

`rowToAgent` em `agents/repository.ts` mapeia os campos novos.
`CreateAgentInput` ganha os campos como opcionais (defaults aplicados no
`INSERT`).

### 4.3 Métodos novos de repositório

- `CostsRepository`: `listRunsByAgent(agentId, { limit })`,
  `getAgentPeriodTotal(agentId, period, now)`.
- `AgentsRepository`: `setBudget(id, { tokensLimit, usdLimit, period })`,
  `setBudgetWarnedPeriod(id, periodKey)`, `setPermissions(id, { canHire,
  canAssign })`.

---

## 5. Testes

**Unit:**
- `groupRunsBySession` — agrupa por `session_id`; `session_id` nulo isola.
- `periodKey` — formato `daily`/`monthly` em UTC.
- `utcMonthBounds` — limites corretos, incluindo virada de ano.
- Filtro de `build-args` — `canHire=false` remove hire/fire e mantém
  `message_agent`; `canAssign=false` remove `assign_issue`; ambos `true` não
  alteram a lista.
- `checkAndPause` per-agente — 100% pausa com `budget_exceeded_agent`; 80%
  avisa **uma vez** (segundo turno no mesmo período não re-avisa); rollover de
  período volta a permitir aviso; teto de tokens enforced em adapter OAuth;
  teto de USD **não** enforced em OAuth e **enforced** em `claude-api-key`;
  checagens globais do M8 seguem intactas.

**Integration:**
- `runs:list` retorna runs derivados de `cost_events` em ordem desc.
- `runs:turn-activity` retorna a atividade da janela do turno.
- `agents:set-budget` round-trip; `costs:get-agent-budget-status` reflete o
  total do período.
- `agents:set-permissions` round-trip + dispara re-spawn.

**Não-regressão:**
- M1–M12 (PR-A..D4) intactos; suíte de segurança verde.
- Token: system prompt inalterado — Runs é read-only, o filtro de
  `--allowedTools` só encolhe, enforcement roda pós-turno. Overhead **zero**.

---

## 6. Segurança

- **Run Policy reduz superfície.** `can_hire`/`can_assign` só *removem* tools
  do `--allowedTools` — nunca adicionam. Default `1` preserva o
  comportamento, mas desligar é estritamente mais restritivo.
- **Budget é defense-in-depth de custo.** O teto por-agente soma-se ao global
  do M8; não o relaxa. A pausa é soft-stop (o turno corrente já aconteceu; o
  próximo `enqueue` é parkado pelo router) — idêntico ao M8.
- **Sem novos vetores de injection.** PR-E não injeta nada no system prompt e
  não executa saída de LLM. Runs é leitura de `cost_events`/`activity_events`.

---

## 7. Fora de escopo

- ❌ Tabela `agent_runs` dedicada — descartada (§16 resolvida: derivar).
- ❌ Campos `status`/`trigger` de run — YAGNI; erros já no activity feed.
- ❌ Drill-in nível tool-call individual — a janela de `activity_events` cobre
  "o que o turno fez"; granularidade por tool-call não agrega o suficiente.
- ❌ Budget global mensal — o global do M8 segue diário; só o per-agente tem
  `period` configurável.
- ❌ Consolidação fina das 6 abas do Agent Studio — é o **PR-F** (§11, §13).

---

## 8. Faseamento

| PR | Entrega | Migração |
|---|---|---|
| **E1** | `costsRepo.listRunsByAgent` + IPCs `runs:*` + helper `groupRunsBySession` + aba Runs + remoção do `RunsModal` + tipo `AgentRunRow` | nenhuma |
| **E2** | Migração `0026` + tipo `Agent` estendido + `getAgentPeriodTotal`/`periodKey`/`utcMonthBounds` + enforcement per-agente em `checkAndPause` + inbox kind `budget_warning` + seção Budget (Stats) + filtro `build-args` + seção Run Policy (Config) + IPCs `agents:set-budget`/`set-permissions`/`costs:get-agent-budget-status` | `0026` |

Próximo passo após aprovação do spec: invocar `writing-plans` para gerar o
plano de implementação (um plano por PR — E1 e E2).
