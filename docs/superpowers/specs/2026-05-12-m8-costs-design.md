# M8 Costs — Design Doc

**Data:** 2026-05-12
**Autor:** Heverson
**Status:** Spec aprovado — pronto pra writing-plans
**Pré-requisitos:** M7 (model selection), M7.5 (adapter pattern), M7.6 (agents.status='paused' + pause_reason), M7.7 (recordActivity)
**Desbloqueia:** M8.5 Goals (estimates reais), M9 Dashboard widget (custos hoje), M10 VPS adapter (filtro por adapter)

> **Não-regressão dura:** spec base §10.3 — multiplicador de tokens ≤1.3x do baseline. M8 ADICIONA tracking, não pode inflar consumo.

## 1. Problema

Hoje o app não rastreia tokens consumidos pelos agentes. A tabela `costs_log` foi declarada no M1 mas nunca foi escrita (zero call sites). O usuário não tem visibilidade de:

- Quanto cada agente está gastando hoje / no mês
- Quanto custou resolver uma issue específica
- Se está perto de estourar o limite do plano Max
- Qual modelo está saindo caro (especialmente Opus vs Sonnet)

Sem isso: (a) M8.5 Goals não consegue estimar custo de plano proposto pelo CEO, (b) M9 Dashboard widget "Custos hoje" fica zerado, (c) agents podem entrar em loop e estourar limite Max sem aviso.

## 2. Solução

Pipeline completo de cost tracking + visualização + enforcement:

1. **Captura** — stream-parser lê `usage` do `result` event do `claude -p`
2. **Persistência** — `costRecorder` grava 1 row por turn-complete em `cost_events`
3. **Estimativa** — pricing table estática em código converte tokens → cents (snapshotted na row)
4. **Enforcement** — soft-stop no turn-complete: se agent estourou daily budget, pausa + Inbox alert
5. **Visualização** — rota `/costs` com gráficos, widget Dashboard, StatsTab real, cost hints no model dropdown
6. **Settings** — 4 budget caps editáveis (daily/agent, per-issue, concurrent, rate-window)

## 3. Restrições e decisões

### 3.1 D1 — Schema novo `cost_events`, drop `costs_log`

`costs_log` (M1) nunca foi escrita. Sem janela de compat (single-user local). Migration 0011 dropa + cria nova. Schema adapter-aware desde o início (prep M10).

### 3.2 D2 — Stream-parser estende `turn-complete` com `usage`

O `result` event do `claude -p` (verified contra 2.1.138) carrega `usage` + `message.model`. Atualizar `ParsedEvent`:

```ts
| { kind: "turn-complete"; usage?: UsageEstimate; model?: string }
```

Helper `safeReadUsage(data)` tolerante (todos os fields opcional, default 0) pra blindar contra variações entre versões da CLI.

### 3.3 D3 — `costRecorder` espelha `activityRecorder`

Módulo novo `apps/main/src/costs/recorder.ts` com:

```ts
type RecordTurnInput = {
  agentId: string;
  companyId: string;
  projectId?: string;
  issueId?: string;
  adapterName: AdapterName;
  model?: string;
  sessionId?: string;
  usage: UsageEstimate;
};

interface CostRecorder {
  recordTurn(input: RecordTurnInput): { eventId: string; costCents: number };
  getAgentDailyTotal(agentId: string, day?: Date): AgentDailyTotal;
  getIssueTotal(issueId: string): IssueTotal;
}
```

Pattern testável igual M7.7 (3 args: db + broadcast + opts).

### 3.4 D4 — Soft-stop at turn-complete

Hook em `apps/main/src/orchestrator/lifecycle.ts` (ou helper module `enforceBudget.ts`):

```
on adapter event { kind: 'turn-complete', usage }:
  if (!usage) return
  result = costRecorder.recordTurn({...})
  daily = costRecorder.getAgentDailyTotal(agent.id)
  if (daily.tokens > budget.maxTokensPerDayPerAgent):
    pauseAgent(agent.id, reason='budget_exceeded')
    notifyUser(kind='security_alert', requires_action=1, payload={agentId, dailyTokens, limit})
    recordActivity({ action: 'agent.paused', payload: { reason: 'budget_exceeded' } })
  if (current_issue_id && getIssueTotal > budget.maxTokensPerIssue):
    same pattern, payload com issueId
```

Soft-stop é "soft" — turn atual já gastou; bloqueio é nos próximos `enqueueOrPark` (router reusa M7.6 paused-agent backlog parking, zero código novo).

### 3.5 D5 — Pricing table estática

`apps/main/src/costs/pricing.ts`:

```ts
// USD por 1M tokens. Snapshot da Anthropic pricing page em 2026-05-12.
// Re-validar a cada release. Cost cents = ceil(usd_cents).
export const MODEL_PRICING = {
  'claude-opus-4-7':        { in: 1500, out: 7500, cacheCreate: 1875, cacheRead: 150 },
  'claude-sonnet-4-6':      { in:  300, out: 1500, cacheCreate:  375, cacheRead:  30 },
  'claude-haiku-4-5-20251001': { in: 100, out: 500, cacheCreate: 125, cacheRead: 10 },
} as const;

export const estimateCostCents = (model: string | undefined, usage: UsageEstimate): number => {
  const p = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!p) return 0; // unknown model — log warning, don't block
  const usdCentsMicros =
    usage.input * p.in +
    usage.output * p.out +
    usage.cache_creation * p.cacheCreate +
    usage.cache_read * p.cacheRead;
  return Math.ceil(usdCentsMicros / 1_000_000);
};
```

Cost cents snapshotted na row (`cost_cents_estimate`) — futuras mudanças de preço não invalidam histórico.

### 3.6 D6 — `%Max` via rolling window interno (não `rate_limit_event` na v1)

Shape do `rate_limit_event` da CLI não é estável/documentado. v1:

- Setting `budget.rate_limit_window_tokens` (default 1_000_000 — conservador, ajustável)
- Setting `budget.rate_limit_window_hours` (default 5 — janela típica do plano Max)
- Sliding window: tokens nos últimos N horas / window_tokens × 100 = %
- Mostrado em progress bar no header da `/costs` e widget Dashboard

PR-C (v2 ou continuação do M8) pode parsear `rate_limit_event` se shape for confirmado durante implementação.

### 3.7 D7 — Charts via `recharts` lazy-loaded

- Adiciona ~50 kB gzip mas só na rota `/costs` via `React.lazy(() => import('./Costs'))`
- Main bundle delta ≤ +5 kB (gate suave)
- Alternativa SVG handcrafted descartada — gráficos de série temporal + breakdown empilhada + donut justificam a lib

### 3.8 D8 — Budget caps em `settings` table (KV)

```
budget.max_tokens_per_day_per_agent  = 2000000   (2M)
budget.max_tokens_per_issue          = 200000    (200k)
budget.max_concurrent_agents         = 3         (já usado em router? — verificar)
budget.rate_limit_window_tokens      = 1000000   (1M / window)
budget.rate_limit_window_hours       = 5         (horas — Max reset cycle)
```

Tipo number serializado como string. UI em Settings com number inputs + reset-to-default.

Defaults seedados na migration 0011 (INSERT OR IGNORE em `settings`).

### 3.9 D9 — Activity event `cost.day_summary` (1 row/dia/agente)

NUNCA per-turn (volume — 10 agents × 50 turns/dia = 500 rows só de cost). Estratégia "lazy roll-up":

- No primeiro `recordTurn` do dia pra um agent, antes de inserir o event, verifica se já existe `cost.day_summary` activity row pra "dia anterior" desse agent. Se não existe E o agent teve turns ontem, gera summary do dia anterior (agregação `SELECT SUM(...) WHERE agent=X AND DATE(occurred_at)=yesterday`).
- Trade-off: summary do dia atual só aparece amanhã. Aceito — UI lê de `cost_events` direto pra "hoje".

## 4. Arquitetura

```
┌─────────────────────────── Main process ──────────────────────────┐
│                                                                    │
│  adapter.onEvent({ kind: 'turn-complete', usage?, model? })       │
│           │                                                        │
│           ▼                                                        │
│  lifecycle.handleTurnComplete(agent, parsedEvent)                  │
│           │                                                        │
│           ├── costRecorder.recordTurn(...)  ───► cost_events       │
│           │           │                                            │
│           │           └─► pricing.estimateCostCents                │
│           │                                                        │
│           ├── enforceBudget.checkAndPause(agent, daily, issue)    │
│           │           │                                            │
│           │           ├─► repo.pauseAgent (reason='budget_...')   │
│           │           ├─► inbox.create kind='security_alert'      │
│           │           └─► broadcast 'agent:updated'               │
│           │                                                        │
│           └── activityRecorder.recordIfDailyRollup(agent)         │
│                                                                    │
│  IPC handlers:                                                     │
│    costs:query, costs:aggregate-today, costs:get/set-budgets       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                          ▲
                          │ broadcast 'costs:new' (debounced 1s)
                          │
┌─────────────────────── Renderer ───────────────────────────────────┐
│  /costs route (React.lazy)                                         │
│    ├── CostsHeader  — total today + %Max progress                  │
│    ├── CostsFilters — agent / project / adapter / date range       │
│    ├── CostsChartTimeSeries  (recharts AreaChart)                  │
│    ├── CostsChartByAgent      (recharts BarChart stacked)          │
│    ├── CostsChartByProject    (recharts PieChart)                  │
│    └── CostsTableRecent       — últimos N turns                    │
│                                                                    │
│  Dashboard widget "Custos hoje" → costs:aggregate-today            │
│  StatsTab (agent panel)        → costs:query scope='agent'         │
│  Settings → Budgets section    → costs:get/set-budgets             │
│  ModelDropdown (M7a)           → cost hints (real ou simbólico)    │
└────────────────────────────────────────────────────────────────────┘
```

## 5. Schema (migration 0011)

```sql
-- 0011_cost_events.sql
BEGIN;

DROP INDEX IF EXISTS idx_costs_company_date;
DROP TABLE IF EXISTS costs_log;

CREATE TABLE cost_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  adapter_name TEXT NOT NULL,
  model TEXT,
  session_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents_estimate INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_cost_events_company_day ON cost_events(company_id, occurred_at);
CREATE INDEX idx_cost_events_agent_day   ON cost_events(agent_id, occurred_at);
CREATE INDEX idx_cost_events_project     ON cost_events(project_id);
CREATE INDEX idx_cost_events_adapter     ON cost_events(adapter_name, occurred_at);
CREATE INDEX idx_cost_events_issue       ON cost_events(issue_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('budget.max_tokens_per_day_per_agent', '2000000'),
  ('budget.max_tokens_per_issue',         '200000'),
  ('budget.rate_limit_window_tokens',     '1000000'),
  ('budget.rate_limit_window_hours',      '5');

COMMIT;
```

Note: `agents.pause_reason` já existe (M7.6). Reusa com valor `'budget_exceeded'`.

## 6. ParsedEvent extension (shared)

```ts
// packages/shared/src/types/adapter.ts — atualiza turn-complete
export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "assistant-message"; blocks: AssistantContentBlock[] }
  | { kind: "tool-result"; toolUseId: string; content: string; isError: boolean }
  | { kind: "turn-complete"; usage?: UsageEstimate; model?: string }   // ← extended
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "unknown"; raw: unknown };
```

stream-parser.ts parsing addition:

```ts
if (data["type"] === "result") {
  const usage = safeReadUsage(data["usage"]);
  const model =
    typeof data["model"] === "string"
      ? data["model"]
      : isObject(data["message"]) && typeof data["message"]["model"] === "string"
        ? data["message"]["model"]
        : undefined;
  return { kind: "turn-complete", usage, model };
}

const safeReadUsage = (raw: unknown): UsageEstimate | undefined => {
  if (!isObject(raw)) return undefined;
  const n = (v: unknown): number => (typeof v === "number" && v >= 0 ? v : 0);
  const result = {
    input: n(raw["input_tokens"]),
    output: n(raw["output_tokens"]),
    cache_creation: n(raw["cache_creation_input_tokens"]),
    cache_read: n(raw["cache_read_input_tokens"]),
  };
  return result.input + result.output + result.cache_creation + result.cache_read > 0
    ? result
    : undefined;
};
```

## 7. IPC handlers

| Handler | Input | Output | Notes |
|---|---|---|---|
| `costs:query` | `{ companyId, scope: 'company'\|'agent'\|'project'\|'issue', refId?, adapterName?, from, to, bucket: 'day'\|'hour' }` | `{ buckets: CostBucket[], byAgent: AgentTotal[], byProject: ProjectTotal[], total: { tokens, cents } }` | Pure aggregation SQL |
| `costs:aggregate-today` | `{ companyId }` | `{ totalCents, totalTokens, percentMax, byAgent: { id, name, tokens, cents }[] }` | Para widget Dashboard |
| `costs:get-budgets` | `{}` | `{ maxTokensPerDayPerAgent, maxTokensPerIssue, rateLimitWindowTokens, rateLimitWindowHours }` | |
| `costs:set-budgets` | `Partial<Budgets>` | `Budgets` | Valida ranges (min 0, max sensato) |

Broadcasts:
- `costs:new` — debounced 1s, `{ agentId, deltaTokens, deltaCents }` — leve reatividade UI
- `agent:updated` — já existe, dispara em pause por budget

## 8. UI

### 8.1 Rota `/costs`

NavLink em `App.tsx` entre **Skills** e **Activity** (alfabético meio que faz sentido); requer `hasToken`.

```
┌─ Custos ─────────────────────────────────────────────────┐
│ R$ 4,72 hoje · 1.234.567 tokens · 78% do limite ▰▰▰▰▰▰▱  │
├──────────────────────────────────────────────────────────┤
│ [Filters: Agent ▼  Project ▼  Adapter ▼  7d ▼]           │
├──────────────────────────────────────────────────────────┤
│ ┌── Tokens / dia ─────────────────────────────────────┐  │
│ │ [Stacked area: input · output · cache_create · cr] │  │
│ └────────────────────────────────────────────────────┘  │
│ ┌── Por agente ──┐ ┌── Por projeto ──┐                  │
│ │ [Bar stacked]  │ │ [Donut]          │                 │
│ └────────────────┘ └──────────────────┘                  │
├──────────────────────────────────────────────────────────┤
│ Últimos turns                                            │
│ [agent · project · model · tokens · cents · time]        │
└──────────────────────────────────────────────────────────┘
```

### 8.2 Dashboard widget "Custos hoje"

Já existe placeholder. Substitui por:
- Total de cents (formatado pt-BR/en-US)
- Total tokens
- Progress bar %Max
- Link "Ver detalhes" → `/costs`

### 8.3 StatsTab (agent right panel)

Hoje tem placeholder "tokens M8". Substitui por:
- Total tokens últimos 7d (linha sparkline)
- Breakdown input/output/cache
- Total cents período
- Botão "Ver no /costs filtered por esse agent"

### 8.4 Settings → Budgets section

4 number inputs com tooltip explicativo. Validação no `costs:set-budgets`. Botão "Reset to defaults".

### 8.5 ModelDropdown (M7a) — cost hints

Hint relativo ao lado de cada opção:
- "$ econômico" / "$$ médio" / "$$$ caro" — sempre presente
- Se >10 turns daquele modelo nos últimos 30d: adiciona "~R$ X / 1K turn" baseado em média histórica

Pure-fn `categorizeCostTier(model, history)` testável.

### 8.6 i18n keys novas

PT-BR e EN-US:
- `nav.costs`
- `costs.title`, `costs.subtitle`
- `costs.filters.agent`, `costs.filters.project`, `costs.filters.adapter`, `costs.filters.range.{7d,30d,custom}`
- `costs.chart.timeSeries`, `costs.chart.byAgent`, `costs.chart.byProject`
- `costs.table.{model,tokens,cost,time}`
- `costs.percentMax`, `costs.percentMax.banner.high`, `costs.percentMax.banner.over`
- `costs.budget.{daily,perIssue,rateWindow,rateHours}`, `costs.budget.resetDefaults`
- `dashboard.costsToday.{title,viewDetails}`
- `agent.stats.tokens.{title,input,output,cache,total7d}`
- `agent.budget_exceeded.{title,body,resume}` (notify_user payload)
- `inbox.security_alert.budget_exceeded`
- `activity.action.cost.day_summary`
- `model.costHint.{cheap,medium,expensive}`, `model.costHint.average`

## 9. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| `result` event sem `usage` | `safeReadUsage` retorna undefined; `recordTurn` skipped silenciosamente; log warning 1x por session-init |
| Modelo desconhecido na pricing | `estimateCostCents` retorna 0; log warning; tokens registrados normalmente, só cents = 0 |
| `cost_events` insert falha | Log error; NÃO bloqueia adapter (next turn segue); UI mostra placeholder com retry |
| Budget setting inválido (negativo, NaN) | `set-budgets` valida e rejeita com erro tipado; UI mostra inline error |
| Agente pausado por budget tenta `enqueue` | M7.6 `enqueueOrPark` já parka; resume manual desbloqueia |
| Migration 0011 falha (FK constraint) | `defer_foreign_keys = 1` na transação (lição M7.6); rollback automático |
| Recharts falha load | Fallback "carregando gráficos..." → erro 5s → mensagem "instale a versão mais recente" + botão reload |

## 10. Testabilidade

### 10.1 Unit (PR-A)

- `stream-parser.parseStreamLine` — `result` event com `usage` completo / parcial / ausente / negativo / sem model
- `pricing.estimateCostCents` — 3 modelos × edge cases (zero, max int, unknown)
- `costRecorder.recordTurn` — insert correto + cost cálculo + return shape
- `costRecorder.getAgentDailyTotal` — UTC vs local TZ, midnight boundary, sem rows
- `enforceBudget.checkAndPause` — dentro/no-limite/acima, pauseAgent called once, notify_user called
- Migration 0011 — `costs_log` dropado, `cost_events` criado, 4 indexes, 4 settings seedados

### 10.2 Integration (PR-A)

- Lifecycle E2E (fake adapter): emit turn-complete com usage → DB persisted + activity rollup + IPC broadcast
- Soft-stop: 3 turns acumulam acima do budget → 3º turn dispara pause + inbox row + activity row

### 10.3 Renderer (PR-B)

- Pure-fn de agregação UI (`bucketByDay`, `topNAgents`, `formatCents`)
- `categorizeCostTier` model dropdown
- i18n: todas as keys presentes em PT e EN
- `useCostsStream` hook (dedupe, debounced refresh)

### 10.4 Não-regressão (gate)

- Spec §10.3: 1 cenário canônico novo "delegate simples com cost tracking" — ratio ≤1.3x do baseline
- Bundle: main delta ≤ +5 kB; `/costs` lazy chunk ~50 kB OK
- Suite total: 472 → 510+ testes esperado

## 11. PR split

### PR-A — Backend foundation (~5-7 dias)

- [ ] Migration 0011 (`cost_events` + drop `costs_log` + 4 budget settings)
- [ ] `packages/shared/src/types/adapter.ts` — extend `turn-complete` com `usage?`, `model?`
- [ ] `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts` — `safeReadUsage` + retorno
- [ ] `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` — atualiza `usage` acumulado (já tem field, só popular)
- [ ] `apps/main/src/costs/pricing.ts` — tabela + `estimateCostCents`
- [ ] `apps/main/src/costs/recorder.ts` — `createCostRecorder` + 3 métodos
- [ ] `apps/main/src/costs/repository.ts` — queries `cost_events` agregadas
- [ ] `apps/main/src/costs/enforce-budget.ts` — `checkAndPause` standalone helper
- [ ] `apps/main/src/orchestrator/lifecycle.ts` — hook em `turn-complete`
- [ ] `apps/main/src/orchestrator/orchestrator-handlers.ts` — 4 IPC handlers
- [ ] Activity action `cost.day_summary` em shared types + i18n PT/EN das 30 actions já existentes vira 31
- [ ] Tests: 25-30 novos
- [ ] Smoke: rodar app, hire agent, mandar 3 mensagens, verificar rows em `cost_events`

### PR-B — UI (~5-7 dias)

- [ ] `apps/renderer/src/routes/Costs.tsx` — page com `React.lazy` import de recharts
- [ ] `apps/renderer/src/components/costs/{CostsHeader, CostsFilters, CostsChartTimeSeries, CostsChartByAgent, CostsChartByProject, CostsTableRecent}.tsx`
- [ ] `apps/renderer/src/hooks/useCostsQuery.ts` + `useCostsToday.ts`
- [ ] `apps/renderer/src/lib/costs/{bucketByDay,topNAgents,formatCents,categorizeCostTier}.ts` (pure fns)
- [ ] `apps/renderer/src/routes/Dashboard.tsx` — substitui placeholder do widget
- [ ] `apps/renderer/src/components/agent-panel/StatsTab.tsx` — substitui placeholder tokens
- [ ] `apps/renderer/src/routes/Settings.tsx` — section Budgets (4 inputs + reset)
- [ ] `apps/renderer/src/components/agent-panel/ModelDropdown.tsx` (ou wherever está) — cost hints
- [ ] `apps/renderer/src/i18n/{pt-BR,en-US}.json` — keys §8.6
- [ ] `apps/renderer/src/App.tsx` — NavLink `/costs` gated `hasToken`
- [ ] Install `recharts` (lockfile bump, justificar dep)
- [ ] Tests: 10-15 renderer (pure fns + i18n coverage)
- [ ] Smoke: navegar `/costs`, filtros funcionam, charts renderizam, Settings salva budget, dashboard widget mostra real value

## 12. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Shape de `usage` no result event varia entre versões CLI | `safeReadUsage` tolerante; teste contra fixture real; log warning silencioso |
| Pricing desatualizada (Anthropic muda preço) | Tabela versionada em código; review pre-release; `cost_cents` snapshotted na row preserva histórico |
| Soft-stop dispara mid-turn longo (cost já gasto) | Aceito — bloqueio é nos próximos `enqueue`. M7.6 backlog parking cobre |
| Recharts ~50 kB inflate bundle | Lazy via `React.lazy(() => import())`. Main bundle delta ≤ +5 kB (gate suave) |
| `rate_limit_event` shape muda → %Max errado | v1 usa rolling window interno; `rate_limit_event` parsing fica como item v2 |
| Activity `cost.day_summary` lazy roll-up: dia atual só aparece amanhã | Aceito — UI lê `cost_events` direto pra hoje; summary é só pra `/activity` histórico |
| 0011 migration cascateia FK como o 0010 fez | Usar `PRAGMA defer_foreign_keys = 1` (lição M7.6 fix `79e618a`) |
| Single user com pricing em USD mas UI em pt-BR | UI mostra "R$ X,XX (~US$ Y.YY)" com câmbio fixo OU só USD com nota. Decisão v1: **só USD com label "US$"** — câmbio dinâmico vira v2 |

## 13. Critérios de sucesso

A v1 do M8 é "pronta" quando:

1. Hire CEO + Frontend Engineer, mandar 3 mensagens cada → `cost_events` tem ≥6 rows com input/output > 0
2. Pricing table cobre opus/sonnet/haiku 4.x → `cost_cents_estimate > 0` em todas
3. Setar `budget.max_tokens_per_day_per_agent = 100` em Settings → próximo turn pausa agent + inbox security_alert + UI mostra status "paused (budget)"
4. `/costs` renderiza 3 gráficos sem erro com dados reais; filtros agent/project/adapter/range funcionam
5. Dashboard widget "Custos hoje" mostra valor real (não zero)
6. StatsTab tem sparkline 7d + breakdown sem placeholder
7. ModelDropdown mostra "$ / $$ / $$$" em todas as opções; modelos com >10 turns mostram média
8. Toggle pt-BR ↔ en-US: zero strings sem tradução em `/costs`
9. Toggle tema claro ↔ escuro: gráficos legíveis em ambos (recharts CSS vars)
10. **Não-regressão §10.3:** suite canônica continua ≤1.3x baseline
11. **Bundle:** main delta ≤ +5 kB; lazy chunk `/costs` ~50 kB
12. **Tests:** 472 → 510+ green

## 14. Não-objetivos (v1)

- Cobrança real / billing / faturamento — single-user, só visibilidade
- Forecast / previsão de gastos — só histórico v1
- Alertas configuráveis (90%/95%/100%) — só hard cap pause
- Multi-currency com câmbio dinâmico — só USD v1
- Export CSV/PDF — v2 (companies.sh do M9 inclui costs export como parte do dump)
- Parsing de `rate_limit_event` real do stream — v2/PR-C se shape confirmar
- Per-company budget — só per-agent + per-issue v1
- Pricing por adapter (claude-oauth-local vs API key) com tiers diferentes — todos usam mesma tabela v1; M10 reavalia

## 15. Pré-requisitos cumpridos

- [x] M7 — model selection (precisa do model na row pra pricing)
- [x] M7.5 PR-A — adapter pattern (`adapterName` column)
- [x] M7.6 — `agents.status='paused'`, `pause_reason`, `enqueueOrPark` (soft-stop reusa)
- [x] M7.7 — `recordActivity` (cost.day_summary action)
- [x] DB user resetado (M7.6 fix) — fresh start, 0011 aplica clean

## 16. Próximos passos pós-M8

- **M8.5 Goals:** CEO planner usa `costs:query` pra estimar custo de plano proposto
- **M9 Dashboard:** widget "Custos hoje" já entregue; M9 adiciona 3 outros widgets (agents/issues/inbox)
- **M10 VPS adapter:** `cost_events.adapter_name` permite filtro local vs remoto sem schema change

---

**Próximo passo:** invocação da skill `writing-plans` pra detalhar PR-A backend.
