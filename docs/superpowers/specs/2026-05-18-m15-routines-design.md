# M15 — Routines

> **Status:** documento de design (2026-05-18). Base para o milestone **M15**, a ser executado **depois do M14**.
>
> **Fontes:** brainstorm 2026-05-18 · análise de completude da V2 (mesma sessão — "depois do M14 estamos completos?") · [docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md](2026-05-18-m14-vitrine-confianca-design.md) · código atual do Prospero (M1–M12) — em especial `orchestrator/router.ts` e `derivation/dispatcher.ts`.
>
> **Pergunta original:** "depois do M14, conseguimos nos tornar o programa de 1-person business?" — resposta: não sem o motor que faz o trabalho acontecer sozinho. Esse motor é o M15.

---

## TL;DR

A tese V2 é "abre o app uma vez por dia pra olhar **o que rodou enquanto você dormia**". O M14 construiu a **tela** que mostra isso (a Vitrine Matinal). Mas faltava o que faz o trabalho **acontecer** de madrugada: hoje nada começa sem o usuário empurrar. Sem isso, a vitrine do M14 mostra uma noite vazia.

O **M15** entrega esse motor — **Routines**: agentes que acordam sozinhos, por horário ou por evento, e iniciam trabalho.

Uma Routine é deliberadamente simples: **acorda um agente-alvo com uma instrução** (enfileira um turno no router). O agente — guiado pelo charter/Algorithm (M12/M13) — decide o que fazer. Dois tipos de gatilho:

- **Schedule** (cron-like) — "toda segunda 9h". Um tick loop in-process varre routines vencidas.
- **Evento** (smart trigger) — "quando um goal é alcançado". Espelha o `dispatcher.ts` do M11.

**Custo estimado:** ~5-7 dias (~3 PRs). **Pré-requisito:** M14 (a Vitrine mostra os disparos; a Escada de Confiança define se a routine roda livre ou trava no gate). **Posição:** V2, logo após o M14.

---

## 1. O problema — nada acontece sozinho

O Prospero, hoje, é reativo: todo turno de agente começa porque **o usuário** mandou uma mensagem, criou um issue, ou aprovou um plano. O orquestrador (`router.ts`) só dá um turno a um agente quando algo é `enqueue`-ado — e quem `enqueue`-a é sempre uma ação humana.

Isso contradiz a tese V2 frontalmente. "Delegação de outcomes que você só revisa — você abre o app uma vez por dia pra olhar o que rodou enquanto dormia" pressupõe que **algo rodou**. Se o trabalho só começa quando o usuário empurra, não há "enquanto dormia" — há só "enquanto eu estava empurrando".

O M14 entregou a Vitrine Matinal — a superfície que resume a noite. Mas, sem o M15, essa vitrine abre vazia: nenhuma routine, nenhum trabalho autônomo, nada para resumir. **M14 e M15 são par:** o M15 faz o filme, o M14 exibe.

O ROADMAP V2 já listava "Routines — agentes que acordam sozinhos" como aposta Tier 1 ("para 1 pessoa, leverage assíncrono É o produto"). Este documento a desenha.

---

## 2. A fronteira com M11–M14

O M15 é fino — ele **não** cria inteligência nova; ele dá um *gatilho* à inteligência que já existe.

- **Do M11** reusa o padrão do `derivation/dispatcher.ts` — um consumidor de `activity_events` que casa linhas contra condições. O lado de **evento** das Routines é o mesmo padrão, com outro consumidor.
- **Do orquestrador** reusa o `router.ts`: "acordar um agente" já é uma operação existente — `enqueue(agentId, threadId, content, sender)` escreve um turno no stdin da sessão persistente. A Routine só chama isso.
- **Do M8/M12** respeita os budgets: uma routine não dispara num agente budget-paused.
- **Do M14** depende em dois pontos: (a) a **Vitrine** consome os eventos `routine.fired`/`routine.skipped` — é onde o trabalho noturno aparece; (b) a **Escada de Confiança** decide o que acontece quando a routine acorda o agente (§8).

**Não-regressão:** o M15 só *adiciona* uma fonte de turnos. Nenhum agente sem routines muda de comportamento. O tick loop, sem routines cadastradas, é um no-op barato.

---

## 3. Visão geral

```
┌─ Engine de schedule ─┐   tick ~30s → routines vencidas ─┐
│  (tick loop)         │                                  │
└──────────────────────┘                                  │
                                                           ├─► fire(routine, reason)
┌─ Engine de evento ───┐   activity_event casa condição ──┘        │
│  (espelha dispatcher)│                                            │
└──────────────────────┘                                            ▼
                                          enqueue turno no router → agente-alvo acorda
                                                  │                  com a instrução
                          ┌───────────────────────┼───────────────────────┐
                  respeita 4 paralelos     budget-paused → pula      emite routine.fired
                  (router já enfileira)    + emite routine.skipped    → Vitrine Matinal (M14)
```

As peças, detalhadas nas seções 4–9.

---

## 4. Modelo de dados

```sql
-- migration M15-01 (numeração relativa: sequencial após as do M14)
PRAGMA defer_foreign_keys = 1;

CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('schedule','event')),
  schedule_spec   TEXT,           -- JSON ScheduleSpec; NULL para event
  next_fire_at    INTEGER,        -- timestamp do próximo disparo; NULL para event
  event_spec      TEXT,           -- JSON EventSpec; NULL para schedule
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  instruction     TEXT NOT NULL,  -- o texto do turno injetado
  last_fired_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_routines_company   ON routines(company_id);
CREATE INDEX idx_routines_next_fire ON routines(next_fire_at);
```

```typescript
// packages/shared/src/types/routine.ts (novo)

export type RoutineTriggerType = "schedule" | "event";

/** Recorrência ESTRUTURADA — não cron string (persona não-técnica). */
export type ScheduleSpec =
  | { freq: "daily";    atMinute: number }                    // minutos desde meia-noite, fuso local
  | { freq: "weekly";   weekday: number; atMinute: number }   // weekday 0-6 (dom-sáb)
  | { freq: "monthly";  day: number; atMinute: number }       // day 1-28
  | { freq: "interval"; everyMinutes: number };

/** Conjunto FIXO de eventos, atrelado a actions reais de activity_events. */
export type RoutineEventType =
  | "goal_achieved"
  | "verification_failed"   // M13
  | "issue_done"
  | "agent_recovered";

export interface EventSpec {
  eventType: RoutineEventType;
}

export interface Routine {
  id: string;
  companyId: string;
  name: string;
  enabled: boolean;
  triggerType: RoutineTriggerType;
  scheduleSpec: ScheduleSpec | null;
  nextFireAt: number | null;
  eventSpec: EventSpec | null;
  targetAgentId: string;
  instruction: string;
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}
```

Zod schemas correspondentes em `apps/main/src/schemas/` (zod **nunca** em `shared` — lição `project_m7_6_lessons`).

---

## 5. Engine de schedule

`apps/main/src/routines/scheduler.ts` — um `setInterval` único (~30 s). 30 s é granularidade de sobra: "acordar um agente" não precisa de precisão de segundos.

```typescript
export type FireReason = "scheduled" | "catchup" | "event" | "manual";

export interface RoutineScheduler {
  start(): void;   // dispara um tick imediato (catch-up) + arranca o setInterval
  stop(): void;
  tick(): void;    // exportado para teste — injeta-se o relógio via deps
}

export function createRoutineScheduler(deps: {
  now: () => number;
  listDueSchedule: (now: number) => Routine[];      // enabled, schedule, next_fire_at <= now
  fire: (routine: Routine, reason: FireReason) => void;
  advanceNextFire: (routine: Routine, now: number) => void;
  tickMs: number;                                    // ~30_000
}): RoutineScheduler {
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    const t = deps.now();
    for (const r of deps.listDueSchedule(t)) {
      const overdue = r.nextFireAt !== null && r.nextFireAt < t - deps.tickMs;
      deps.fire(r, overdue ? "catchup" : "scheduled");
      deps.advanceNextFire(r, t);     // recomputa a partir de `t` — coalesce (§5.1)
    }
  };

  return {
    start() { tick(); handle = setInterval(tick, deps.tickMs); },
    stop()  { if (handle !== null) clearInterval(handle); handle = null; },
    tick,
  };
}
```

### 5.1 `computeNextFire` e o catch-up coalescido

`apps/main/src/routines/recurrence.ts`:

```typescript
/** A próxima ocorrência estritamente após `after`, em fuso local. */
export function computeNextFire(spec: ScheduleSpec, after: Date): Date;
```

`advanceNextFire` chama `computeNextFire(spec, new Date(now))` — a partir de **agora**, não do `next_fire_at` velho. Consequência: se o app ficou fechado e 3 disparos foram perdidos, no boot o primeiro `tick()` encontra a routine vencida, **dispara uma vez** (`reason: "catchup"`), e `next_fire_at` salta direto para o próximo slot futuro. Sem "thundering herd" de execuções acumuladas — exatamente o comportamento decidido no brainstorm.

`start()` roda um `tick()` síncrono imediato; é por isso que o catch-up "sai de graça" — nenhum código de boot especial.

---

## 6. Engine de evento

`apps/main/src/routines/event-matcher.ts` — espelha `derivation/dispatcher.ts` (M11): um consumidor das linhas de `activity_events`, plugado no mesmo ponto de escrita que o dispatcher de derivação.

```typescript
import type { ActivityEventRow } from "@prospero/shared";

/** Routines de evento (enabled) cujo eventType casa com esta activity row. */
export const routinesForActivity = (
  row: ActivityEventRow,
  eventRoutines: Routine[],
): Routine[] => eventRoutines.filter((r) => matchesEvent(r.eventSpec, row));

// matchesEvent mapeia RoutineEventType → (action, payload) — espelha jobForActivity:
//   goal_achieved       ⇄ goal.status_changed  + payload.to === 'achieved'
//   verification_failed ⇄ goal.status_changed  + payload.to === 'in_progress' (pós-falha M13)
//                          (ou a action dedicada de verificação, se o M13 emitir uma)
//   issue_done          ⇄ issue.status_changed + payload.to === 'done'
//   agent_recovered     ⇄ agent.recovered
```

Sem agendamento, sem timer — é reativo. O conjunto de `RoutineEventType` é **fixo** nesta versão (sem condições arbitrárias, sem triggers de padrão aprendido por IA — esses ficam fora, §14).

---

## 7. Firing

```typescript
export function fireRoutine(routine: Routine, reason: FireReason, deps: {
  getAgent: (id: string) => Agent | null;
  isBudgetPaused: (agent: Agent) => boolean;
  primaryThreadId: (agentId: string) => string;
  router: Router;
  recordActivity: (e: ActivityInput) => void;
}): void {
  const agent = deps.getAgent(routine.targetAgentId);
  if (agent === null || agent.status === "terminated") {
    deps.recordActivity({ action: "routine.skipped", entityId: routine.id,
                          payload: { reason: "agent_unavailable" } });
    return;
  }
  if (deps.isBudgetPaused(agent)) {
    deps.recordActivity({ action: "routine.skipped", entityId: routine.id,
                          payload: { reason: "budget_paused" } });
    return;     // não despausa o agente — disciplina de custo
  }
  deps.router.enqueue(
    agent.id,
    deps.primaryThreadId(agent.id),
    routine.instruction,
    { kind: "routine", id: routine.id, name: `Routine: ${routine.name}` },
  );
  deps.recordActivity({ action: "routine.fired", entityId: routine.id,
                        payload: { reason } });
}
```

Notas:

- **`Sender` ganha o kind `"routine"`.** Hoje `Sender.kind` é `"user" | "agent"` (`router.ts`). Adicionar `"routine"` é mudança de 1 linha — mas é honesto: a activity atribui o turno à routine, não finge ser o usuário. **Auditar os consumidores de `Sender`** (`formatSender`, atribuição em activity) — lição da família `project_m12_pr_a_lessons` (um eixo novo num union pede auditoria dos consumidores).
- **Thread.** O turno entra na **thread primária usuário↔agente** do agente-alvo — assim a instrução da routine e a resposta do agente ficam visíveis no chat normal, como se você tivesse falado com ele. (Decisão revisitável — §15.)
- **Concorrência.** `fireRoutine` só `enqueue`-a. O limite de 4 agentes paralelos (ToS) e a fila FIFO do `router.ts` já absorvem rajadas — boot catch-up, burst das 9h. Routines **não** têm controle de concorrência próprio.
- **Falha.** Se o turno do agente erra, o error handling do M9 (heartbeat, recovery) age normalmente. A routine **não faz retry** — o próximo disparo é o próximo slot do schedule. Uma falha aparece na Vitrine.

---

## 8. Activity events & interação com a Vitrine (M14)

**Ações novas** em `ActivityAction`: `routine.fired`, `routine.skipped`. `ActivityAction` é um union fechado (lição `project_m12_pr_d2_lessons` — `org.plan_approved` esquecido). Confirmar ao iniciar o PR-A se a coluna `activity_events.action` tem `CHECK` constraint — se tiver, as duas ações entram numa recriação de tabela junto da M15-01.

**Sem tabela `routine_runs`.** Cada disparo é um `activity_event`; o histórico de uma routine e os itens da Vitrine são lidos de lá. Mesma decisão do M12 PR-E1 (a aba Runs derivou de `cost_events`, sem tabela própria).

**O fechamento M14 ↔ M15.** A Vitrine Matinal lê os `routine.fired`/`routine.skipped`:

- Um disparo `reason: "catchup"` → a Vitrine mostra "routine X rodou atrasada".
- Um disparo que gerou trabalho que precisa de você → entra em "Precisa de você".
- Um `routine.skipped` por budget → informativo na Vitrine.

É aqui que a tese vira verdade: **o M15 faz o trabalho acontecer enquanto você dorme; o M14 mostra na manhã seguinte.**

**Interação com a Escada de Confiança (M14).** Quando uma routine acorda o agente:

- Agente `autonomo` → o turno roda sem prompts de aprovação. Trabalho noturno real.
- Agente `confiavel` → roda; ações read-only passam, Write/Bash travam no gate.
- Agente `novato` → acorda, mas trava no primeiro gate sensível e fica esperando → vira item "Precisa de você" na Vitrine.

Isso é **composição esperada**, não bug: Routines rendem mais em agentes que subiram a Escada. Um agente novo com routine só produz "preciso de você" — o que é seguro e honesto.

---

## 9. UI & IPC

**Rota nova `/routines`:**

- **Lista** — cada routine: nome, gatilho (resumido: "Toda segunda 09:00" ou "Quando: goal alcançado"), agente-alvo, toggle `enabled`, último disparo, próximo disparo (para schedule), botão "Rodar agora".
- **Form criar/editar** — nome · tipo de gatilho → *picker de recorrência estruturada* (diário/semanal/mensal/intervalo + hora) **ou** *dropdown de evento* (os 4 `RoutineEventType`) · dropdown de agente-alvo · textarea de instrução.

**IPC:** `routines:list` · `routines:create` · `routines:update` · `routines:delete` · `routines:run-now` (disparo manual — `reason: "manual"`; útil para testar uma routine sem esperar o horário). O teste de contagem de canais IPC é atualizado junto (lição M9 PR-F.1).

**Sem MCP tools novas** — o usuário cria routines pela UI. Agente criar a própria routine fica fora (§14).

IA fina decidida pela skill `frontend-design` na implementação.

---

## 10. Token efficiency

Regra dura (`feedback_token_efficiency`): o uso não pode **inflar**.

- O **scheduler** e o **event-matcher** são computação pura — queries SQL + aritmética de data. **Zero IA.** Um tick sem routines vencidas é praticamente grátis.
- Um **disparo** custa o turno do agente — mas isso é **trabalho que você configurou explicitamente** (é a alavanca, é o produto). Não é overhead; é a feature.
- O custo é **limitado por construção**: os budgets por agente (M12) e o teto de 4 agentes paralelos seguram o volume. Uma routine num agente budget-paused **não dispara** (§7).

A distinção importa: o M15 não faz a *mesma* unidade de trabalho custar mais — ele faz *mais trabalho* acontecer, dentro de tetos que você controla. Isso é compatível com a regra. O agente não ganha system prompt novo; não há overhead por-turno.

---

## 11. Segurança

- **A `instruction` é autorada pelo usuário.** Routines são criadas na UI por você. Não há texto de routine gerado por agente — sem vetor de prompt injection pela routine.
- **O agente que acorda ainda passa pelo gate.** Uma routine não contorna a segurança: o agente acordado opera sob seu `trust_tier` (M14) e sob o gate (`request_permission`). Routine num agente de baixa confiança trava no gate — falha segura (§8).
- **Company-scoped.** Uma routine e seu agente-alvo pertencem à mesma empresa; uma routine não acorda agente de outra empresa.
- **Disciplina de custo é segurança operacional.** O skip em agente budget-paused impede uma routine de furar o teto de gasto enquanto você dorme.
- **`SECURITY.md`** — nota nova: "Routines — scheduled unattended turns; instruction authored by the user, agent still gated".

---

## 12. Faseamento (PRs)

| PR | Escopo | Depende de |
|---|---|---|
| **A** | **Engine.** Migração M15-01 · tipos `routine.ts` + zod · repo de `routines` · `computeNextFire` (recorrência) · `createRoutineScheduler` (tick loop + catch-up) · `event-matcher` (consumidor de activity, espelha o dispatcher) · `fireRoutine` (integração com o router, kind `"routine"` no `Sender`) · ações `routine.fired`/`routine.skipped` · IPC `routines:*`. | M14 |
| **B** | **UI.** Rota `/routines` — lista + form criar/editar (picker de recorrência, dropdown de evento, agente-alvo, instrução) · "Rodar agora" · badges de último/próximo disparo. | A |
| **C** | **Consolidação.** Polish (`frontend-design`) · `SECURITY.md` · `ROADMAP.md` + `roadmap.html` · não-regressão completa. | A, B |

**Custo estimado:** ~5-7 dias.

---

## 13. Testes & não-regressão

**Testes:**

- Unit: `computeNextFire` — `daily`/`weekly`/`monthly`/`interval`, viradas de dia/semana/mês, fuso local.
- Unit: `tick()` com relógio injetado — dispara routine vencida, recomputa `next_fire_at`; routine no futuro não dispara; routine `disabled` ignorada.
- Unit: catch-up coalescido — `next_fire_at` muito no passado dispara **uma** vez (`reason: "catchup"`) e salta para o próximo slot futuro.
- Unit: `routinesForActivity` — cada `RoutineEventType` casa a action certa; não-match não dispara.
- Unit: `fireRoutine` — agente terminado/budget-paused → `routine.skipped`; caminho feliz → `enqueue` + `routine.fired`.
- Integration: routine de schedule criada → `tick` dispara → turno chega no router; routine de evento → activity row casa → dispara.
- Integration: `routines:run-now` dispara com `reason: "manual"`.
- E2E: criar routine diária → avançar o relógio → agente acorda com a instrução → `routine.fired` aparece na Vitrine.

**Não-regressão:**

- Sem routines cadastradas, o tick loop é no-op; nenhum agente muda de comportamento.
- `Sender` ganha `"routine"` — auditar todos os consumidores do union (lição `project_m12_pr_a_lessons`).
- M1–M14 intactos; suíte de segurança verde; startup +200 ms máx (o `start()` roda um `tick` síncrono — manter barato).
- Mudança na interface de repos quebra mocks literais em `apps/main/tests/` — auditar.

---

## 14. Out-of-scope do M15

- ❌ **Triggers de padrão aprendido por IA** — o ROADMAP menciona "M11 enriquece com padrões aprendidos para disparar follow-ups inteligentes". V1 das Routines tem um conjunto **fixo** de eventos nomeados. Triggers derivados de padrão ficam para depois.
- ❌ **Condições/filtros arbitrários** no evento (ex.: "goal alcançado **cujo valor > X**"). V1 casa só o tipo de evento.
- ❌ **Agente cria a própria routine** (ou o CEO cria routines no org plan) — fica para Workflow Plays / futuro. V1: routines são criadas pelo usuário na UI.
- ❌ **Routine que cria goal/issue diretamente** — a Routine acorda um agente; o agente decide criar goal/issue. (Abordagens B/C do brainstorm, descartadas.)
- ❌ **Cron string crua** — a recorrência é estruturada (persona não-técnica).
- ❌ **Garantir o processo do app rodando 24/7** (tray/background mode) — é concern de ciclo-de-vida do app, não do motor de Routines. O M15 assume o processo rodando e trata a janela fechada via catch-up. Um modo tray dedicado, se necessário, é milestone à parte.

---

## 15. Decisões em aberto

- **Conjunto de `RoutineEventType`** — os 4 propostos (`goal_achieved`, `verification_failed`, `issue_done`, `agent_recovered`) cobrem o essencial; confirmar/ajustar no PR-A conforme as actions de `activity_events` realmente disponíveis (em especial como o M13 emite a falha de verificação).
- **Thread do turno** — thread primária usuário↔agente (escolhido) vs. uma thread dedicada de routine. Reavaliar no PR-A se a poluição do chat incomodar.
- **`CHECK` em `activity_events.action`** — se existir, as ações novas entram numa recriação de tabela; confirmar no PR-A.
- **Intervalo do tick** — 30 s proposto; reavaliar se o catch-up no boot precisar ser mais imediato (o `tick()` síncrono no `start()` já cobre o boot).

---

## 16. Custo & posição no roadmap

**Custo estimado:** ~5-7 dias (~3 PRs).

**Pré-requisito:** **M14** — a Vitrine Matinal consome os eventos de disparo; a Escada de Confiança determina o comportamento do agente acordado. (Tecnicamente o M15 roda sem o M14, mas sem a Vitrine o trabalho noturno fica invisível e sem a Escada todo agente trava no gate — entregar depois do M14 é o que faz sentido.)

**Posição:** V2, **logo após o M14**. O M15 entrega "agentes acordam e trabalham sozinhos" — o motor que faltava para "rodou enquanto você dormia" ser literal.

**O que ainda falta para a V2 fechar, depois do M15:**

- **Workflow Plays** — mata o cold-start (playbooks pré-prontos que já configuram org + goals + ISAs). Tier 1.
- **Async + Trust governance** — como uma escalada noturna se resolve sem o usuário (timeout + escalação inteligente). É a outra metade do loop assíncrono que o M14 começou; continua mal-tierada no roadmap (Tier 2, deveria vir com o M15).
- A lacuna de **connectors de ramo** (ferramentas do mundo real para negócios não-software) — sem milestone até hoje.

**Próximo passo quando o M15 começar (pós-M14):** invocar a skill `writing-plans` para gerar o plano de implementação detalhado, PR a PR.

---

## 17. Referências

- [docs/superpowers/specs/2026-05-18-m14-vitrine-confianca-design.md](2026-05-18-m14-vitrine-confianca-design.md) — a Vitrine consome os eventos de disparo; a Escada governa o agente acordado.
- [docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md](2026-05-18-m13-outcome-verification-spine-design.md) — `verification_failed` como `RoutineEventType`.
- [ROADMAP.md](../../../ROADMAP.md) — §Visão V2, "Routines" (Tier 1).
- Código atual: `apps/main/src/orchestrator/router.ts` (o `enqueue` que "acorda" um agente) · `apps/main/src/derivation/dispatcher.ts` (o padrão que o event-matcher espelha).
